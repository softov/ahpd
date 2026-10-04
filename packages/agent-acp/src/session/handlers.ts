import { pathToFileURL } from 'node:url';
import type {
  AvailableCommand,
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  PermissionOptionKind,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  SessionUpdate,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type { Bag, OpenedTerminal, Session } from '@ahpd/sdk';
import { confirmationOptions, mapUpdate } from '../mapping.js';
import type { PermissionAnswer } from '../types.js';
import { bag } from './common.js';
import type { SessionContext } from './context.js';

/** Everything the server sends this session: its updates, its requests and the answers to them. */
export interface Handlers {
  receivedUpdate(sessionId: string, update: SessionUpdate): void;
  askPermission(request: RequestPermissionRequest): Promise<PermissionAnswer>;
  readTextFile(request: ReadTextFileRequest): Promise<ReadTextFileResponse>;
  writeTextFile(request: WriteTextFileRequest): Promise<WriteTextFileResponse>;
  openTerminal(request: CreateTerminalRequest): Promise<CreateTerminalResponse>;
  terminalOutput(request: TerminalOutputRequest): Promise<TerminalOutputResponse>;
  waitForTerminalExit(request: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse>;
  killTerminal(request: KillTerminalRequest): Promise<KillTerminalResponse>;
  releaseTerminal(request: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse>;
  settlePermissions(): void;
  confirm: Session['confirm'];
}

export function createHandlers(ctx: SessionContext): Handlers {
  const { emit, provider, start, where, doing, touch, seeds, replay, permissions, terminals } = ctx;

  /**
   * One command the server offers, as the customization a client draws.
   *
   * ACP commands are the slash surface, which is a prompt leaf rather than a
   * file: there is no path behind one, so the URI names the command itself
   * rather than pretending a file exists. The input hint is carried as an
   * argument hint, which is what a composer puts beside the name.
   */
  const commandLeaf = (command: AvailableCommand): Bag => ({
    type: 'prompt',
    id: `command:${command.name}`,
    name: command.name,
    uri: `acp-command:${provider}/${command.name}`,
    enabled: true,
    ...(command.description === '' ? {} : { description: command.description }),
    ...(command.input === null || command.input === undefined ? {} : { argumentHint: command.input.hint }),
  });

  /**
   * One server notification, into the running turn and the session's own state.
   *
   * A connection is per session, so an update for another session id is not
   * this conversation's; it is dropped rather than written into the wrong turn.
   * A mode, a config or a command update moves the session whether or not a
   * turn is running, because the server may say so at any time and a client
   * draws them from the session's state.
   */
  const receivedUpdate = (sessionId: string, update: SessionUpdate): void => {
    if (ctx.closed) return;
    if (ctx.acpSessionId !== undefined && sessionId !== ctx.acpSessionId) return;
    /*
     * When this arrived, which is what a tool call's start and end are: ACP
     * carries no time of its own, so the times are the ones this plugin read
     * the updates at. Taken once, so every use of it is the same moment.
     */
    const at = Date.now();

    if (update.sessionUpdate === 'session_info_update') {
      const said = update.title;
      /*
       * The agent's name for the conversation, which replaces the one derived
       * from the first prompt. Not said twice, and not said at all once a
       * person has named the session themselves: a title a client is told
       * twice is a title it has to reconcile, and a name somebody chose is not
       * the agent's to replace.
       */
      if (typeof said === 'string' && said !== '' && !ctx.renamed && said !== ctx.title) {
        ctx.title = said;
        if (ctx.record !== undefined) ctx.record.title = said;
        emit('session', { type: 'session/titleChanged', title: said });
        touch();
      }
      return;
    }

    if (update.sessionUpdate === 'current_mode_update') {
      if (ctx.modes !== undefined) ctx.modes = { ...ctx.modes, currentModeId: update.currentModeId };
      ctx.configChanged('permissionMode', update.currentModeId);
      touch();
      return;
    }
    if (update.sessionUpdate === 'config_option_update') {
      ctx.offersChanged(update.configOptions);
      ctx.learnOffers(update.configOptions);
      touch();
      return;
    }
    if (update.sessionUpdate === 'available_commands_update') {
      ctx.commands = update.availableCommands.map(commandLeaf);
      emit('session', { type: 'session/customizationsChanged', customizations: [...seeds, ...ctx.commands] });
      return;
    }

    const current = ctx.mapping;
    // A cost reported before the prompt went out - on `session/new` or a
    // `session/load` replay, or between turns - is what the turn counts from,
    // and charged to none.
    if (update.sessionUpdate === 'usage_update' && current?.prompted !== true) {
      if (typeof update.cost?.amount === 'number') {
        ctx.cumulative = update.cost.amount;
        if (current !== undefined) current.costAtStart = ctx.cumulative;
      }
      return;
    }
    /*
     * While the session is opening, everything the server sends is the load's
     * replay.
     *
     * Whatever asked for the server - a turn, a resume, a reopen after a death
     * or a config the person set - those updates replay a conversation that was
     * already had, and belong to no turn this bridge began. Mapping them into
     * whichever turn happens to be running would put a whole conversation's
     * answer inside one turn's row.
     */
    if (ctx.loading) {
      replay.push(update);
      return;
    }
    if (current === undefined) return;
    // Kept before it is mapped, so a transcript rebuilt later sees the same
    // notifications the live client did, in the same order.
    ctx.watchedTurn?.updates.push({ update, at });
    /*
     * A usage is the turn's own total, held on the turn as well as sent, so a
     * client reading the snapshot mid-turn reads the same number the stream
     * last carried.
     */
    for (const action of mapUpdate(current, update, at)) {
      if (action.type === 'chat/usage' && ctx.active !== undefined) ctx.active.usage = bag(action.usage);
      emit('chat', action);
    }
  };

  /**
   * The `file://` URI a path names, which is what the host's store reads.
   *
   * Encoded rather than concatenated, because a path is allowed a space and a
   * store that reads a URI has to be given one it can parse.
   */
  const uriOf = (path: string): string => pathToFileURL(path).href;

  /** A file the agent asked to read, through the host's own store. */
  const readTextFile = async (request: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
    const store = start.resources;
    if (store === undefined) throw new Error(`${provider}: this session has no files to read`);
    const read = await store.read(uriOf(request.path));
    if (read.encoding !== 'utf-8') throw new Error(`${provider}: ${request.path} is not text`);
    // ACP sends `null` for absent as readily as it omits, so both mean the same.
    const line = request.line ?? undefined;
    const limit = request.limit ?? undefined;
    // A whole-file read is the common case and the one a server expects to be
    // exactly the file, so the split only happens when a range was asked for.
    if (line === undefined && limit === undefined) return { content: read.data };
    const lines = read.data.split('\n');
    const from = Math.max(0, (line ?? 1) - 1);
    return { content: lines.slice(from, limit === undefined ? undefined : from + limit).join('\n') };
  };

  /** One the agent asked to write. */
  const writeTextFile = async (request: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
    const store = start.resources;
    if (store?.write === undefined) throw new Error(`${provider}: this session has no files to write`);
    /*
     * Both sides of the write, so the turn's changeset holds what the file was
     * before this agent changed it beside what it is after. A write outside a
     * turn has no turn to attach them to, which is every write a server makes
     * while its session is opening.
     *
     * Both are waited for: the write truncates the file, so a `before` read
     * still in flight would find it already changed, and the turn ends after both.
     */
    const turnId = ctx.mapping?.turnId;
    if (turnId !== undefined) await start.onFileEdit?.(turnId, request.path, 'before');
    await store.write(uriOf(request.path), { data: request.content, encoding: 'utf-8', mode: 'truncate' });
    if (turnId !== undefined) await start.onFileEdit?.(turnId, request.path, 'after');
    return {};
  };

  /** The environment ACP sent, as the host's port takes it. */
  const environmentOf = (request: CreateTerminalRequest): Record<string, string> | undefined => {
    const list = request.env;
    if (list === undefined || list.length === 0) return undefined;
    const env: Record<string, string> = {};
    for (const one of list) env[one.name] = one.value;
    return env;
  };

  /** A shell the agent asked for, opened and listed by the host. */
  const openTerminal = async (request: CreateTerminalRequest): Promise<CreateTerminalResponse> => {
    const shells = start.terminals;
    if (shells === undefined) throw new Error(`${provider}: this session has no shells`);
    const env = environmentOf(request);
    const handle = shells.open({
      cwd: request.cwd ?? where,
      command: request.command,
      ...(request.args !== undefined && request.args.length > 0 ? { args: request.args } : {}),
      ...(env === undefined ? {} : { env }),
    });
    terminals.set(handle.uri, {
      handle,
      ...(typeof request.outputByteLimit === 'number' ? { limit: request.outputByteLimit } : {}),
    });
    return { terminalId: handle.uri };
  };

  /** One by its own id, or a refusal the server reads as a failed request. */
  const terminalOf = (id: string): { handle: OpenedTerminal; limit?: number } => {
    const held = terminals.get(id);
    if (held === undefined) throw new Error(`${provider}: no terminal ${id}`);
    return held;
  };

  /** Everything it has printed, capped to what the request that opened it asked. */
  const terminalOutput = async (request: TerminalOutputRequest): Promise<TerminalOutputResponse> => {
    const held = terminalOf(request.terminalId);
    const said = held.handle.output();
    const limit = held.limit;
    // The protocol truncates from the beginning to stay within the limit,
    // which keeps the tail: what a person watching wants is the end of it.
    const output = limit === undefined || said.output.length <= limit ? said.output : said.output.slice(-limit);
    return {
      output,
      truncated: output.length !== said.output.length,
      ...(said.exitCode === undefined ? {} : { exitStatus: { exitCode: said.exitCode } }),
    };
  };

  /** The wait the server does instead of polling. */
  const waitForTerminalExit = async (request: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> => {
    const done = await terminalOf(request.terminalId).handle.waitForExit();
    return {
      ...(done.exitCode === undefined ? {} : { exitCode: done.exitCode }),
      ...(done.signal === undefined ? {} : { signal: done.signal }),
    };
  };

  const killTerminal = async (request: KillTerminalRequest): Promise<KillTerminalResponse> => {
    terminalOf(request.terminalId).handle.kill();
    return {};
  };

  const releaseTerminal = async (request: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> => {
    terminalOf(request.terminalId).handle.release();
    terminals.delete(request.terminalId);
    return {};
  };

  /**
   * A permission the server is blocked on, put to a person.
   *
   * Every option the server lists is offered on the call, approvals before
   * refusals, and the one the person picks is the one the server is sent. An
   * answer that picked none selects the server's `allow_once` or
   * `reject_once` - never an `always`, which would change this session's
   * policy from a single answer - and a server with no once option of that
   * kind is answered `cancelled`, because selecting an `always` is a decision
   * the person did not make.
   */
  const askPermission = (request: RequestPermissionRequest): Promise<PermissionAnswer> => {
    const option = (kind: PermissionOptionKind): string | undefined =>
      request.options.find((one) => one.kind === kind)?.optionId;
    const allow = option('allow_once');
    const reject = option('reject_once');
    const offered = confirmationOptions(request.options);
    const toolCallId = request.toolCall.toolCallId;
    const requestId = `${toolCallId}:permission`;

    const answered = new Promise<PermissionAnswer>((resolve) => {
      permissions.set(toolCallId, {
        requestId,
        ...(allow === undefined ? {} : { allow }),
        ...(reject === undefined ? {} : { reject }),
        offered,
        settle: resolve,
      });
    });

    /*
     * The row, if the server asked without announcing the call first.
     *
     * Usually the `tool_call` update arrived before this and the part is the
     * one a client already draws, so it is found rather than replaced and only
     * its state moves.
     */
    const turnId = ctx.mapping?.turnId ?? '';
    const existing = ctx.mapping?.parts.find((one) => one.id === toolCallId);
    const call = existing === undefined ? {
      toolCallId,
      toolName: request.toolCall.name ?? request.toolCall.title ?? toolCallId,
      displayName: request.toolCall.title ?? request.toolCall.name ?? toolCallId,
      ...(request.toolCall.rawInput === undefined ? {} : { toolInput: JSON.stringify(request.toolCall.rawInput) }),
    } as Bag : bag(bag(existing).toolCall);
    // The arguments are on the question as well as on the row: a server sends
    // them with the request when the call is still `pending`, which is exactly
    // the call the mapping has written no arguments for.
    if (call.toolInput === undefined && request.toolCall.rawInput !== undefined) {
      call.toolInput = JSON.stringify(request.toolCall.rawInput);
    }
    call.status = 'pending-confirmation';
    call.invocationMessage = request.toolCall.title ?? call.toolName;
    call.confirmationTitle = request.toolCall.title ?? call.displayName;
    if (offered.length > 0) call.options = offered;
    delete call.confirmed;
    if (existing === undefined && ctx.mapping !== undefined) {
      ctx.mapping.parts.push({ id: toolCallId, kind: 'toolCall', toolCall: call });
      emit('chat', {
        type: 'chat/toolCallStart', turnId, toolCallId,
        toolName: call.toolName, displayName: call.displayName,
      });
    }
    /*
     * The call put back to `pending-confirmation`, with the choices on it.
     *
     * Sent even when the call was announced as running: a ready with no
     * `confirmed` is what moves a running call back to a question, and a
     * client that saw only the input-needed entry would draw the row as
     * running while the server waits.
     *
     * From here the mapping's own readiness for this call is this one, because
     * a status that moves while a person is being asked must not send a ready
     * behind this saying nobody is going to be. `asked` is what stops it, for
     * as long as the question stands.
     */
    const mapped = ctx.mapping?.calls.get(toolCallId);
    if (mapped !== undefined) {
      mapped.readied = true;
      mapped.asked = true;
    } else if (ctx.mapping !== undefined) {
      /*
       * The call the mapping will find on a later update, so one that arrives
       * now moves this call rather than opening a second row for it.
       */
      ctx.mapping.calls.set(toolCallId, {
        toolCallId,
        toolName: String(call.toolName),
        displayName: String(call.displayName),
        readied: true,
        asked: true,
      });
    }
    emit('chat', {
      type: 'chat/toolCallReady', turnId, toolCallId,
      invocationMessage: call.invocationMessage,
      ...(call.toolInput === undefined ? {} : { toolInput: call.toolInput }),
      confirmationTitle: call.confirmationTitle,
      ...(offered.length > 0 ? { options: offered } : {}),
    });
    emit('session', {
      type: 'session/inputNeededSet',
      request: { id: requestId, chat: start.chatUri, kind: 'toolConfirmation', turnId, toolCall: call },
    });
    doing('Waiting on you');
    touch();
    return answered;
  };

  /**
   * Every permission nobody will answer now, settled `cancelled`.
   *
   * The protocol asks a client that stops a turn to answer what its server is
   * still blocked on, so the server is not left waiting on a person who has
   * already said stop. Each entry takes its input-needed row with it: the
   * question was asked and has now been answered, and a client still drawing it
   * is offering a decision nobody can make.
   *
   * The settle is what a close does here, which is why both go through this.
   */
  const settlePermissions = (): void => {
    for (const held of permissions.values()) {
      emit('session', { type: 'session/inputNeededRemoved', id: held.requestId });
      held.settle('cancelled');
    }
    permissions.clear();
  };

  /**
   * A person's answer to the permission the server is waiting on.
   *
   * Found by the tool call the entry names rather than assumed to be the one
   * held, because two calls can be waiting at once and answering the wrong
   * one is worse than answering none. The option picked is sent when the
   * server offered it and it is of the answer's kind; otherwise the once
   * option of that kind, and with none the request is refused instead, with
   * the person's answer standing as the reason.
   */
  const confirm: Session['confirm'] = (toolCallId, approved, optionId) => {
    const held = permissions.get(toolCallId);
    if (held === undefined) return;
    permissions.delete(toolCallId);
    emit('session', { type: 'session/inputNeededRemoved', id: held.requestId });
    const picked = held.offered.find((one) => one.id === optionId && one.kind === (approved ? 'approve' : 'deny'));
    const part = ctx.mapping?.parts.find((one) => one.id === toolCallId);
    if (part !== undefined) {
      const call = bag(bag(part).toolCall);
      call.status = approved ? 'running' : 'cancelled';
      if (approved) call.confirmed = 'user-action';
      delete call.options;
      delete call.confirmationTitle;
      if (picked !== undefined) call.selectedOption = picked;
    }
    emit('chat', {
      type: 'chat/toolCallConfirmed',
      turnId: ctx.mapping?.turnId,
      toolCallId,
      approved,
      ...(approved ? { confirmed: 'user-action' } : {}),
      ...(picked === undefined ? {} : { selectedOptionId: picked.id }),
    });
    const chosen = picked?.id ?? (approved ? held.allow : held.reject);
    held.settle(chosen === undefined ? 'cancelled' : { optionId: chosen });
    doing(approved ? 'Running' : 'Thinking');
    touch();
  };

  return {
    receivedUpdate,
    askPermission,
    readTextFile,
    writeTextFile,
    openTerminal,
    terminalOutput,
    waitForTerminalExit,
    killTerminal,
    releaseTerminal,
    settlePermissions,
    confirm,
  };
}