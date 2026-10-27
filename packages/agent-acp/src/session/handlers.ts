import { normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  AvailableCommand,
  CompleteElicitationNotification,
  CreateElicitationRequest,
  CreateElicitationResponse,
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  PermissionOption,
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
import { hostPathOf, str } from '@ahpd/sdk';
import type { Bag, BackgroundTask, BoundTool, OpenTerminal, Session } from '@ahpd/sdk';
import { callPartOf, confirmationOptions, contentOf, mapUpdate, questionsFor, typedOf } from '../mapping.js';
import type { PermissionAnswer } from '../types.js';
import { bag } from './common.js';
import { HOST_TOOLS, machineIdOf } from './opening.js';
import type { HeldTerminal, SessionContext } from './context.js';

/** Everything the server sends this session: its updates, its requests and the answers to them. */
export interface Handlers {
  receivedUpdate(sessionId: string, update: SessionUpdate): void;
  askPermission(request: RequestPermissionRequest): Promise<PermissionAnswer>;
  /**
   * Whether a tool the host serves may run, asked before the tools server runs
   * it.
   *
   * The agent calls that server directly, so this is the one place a question
   * about such a call can be put before the tool has already done its work.
   */
  askTool(tool: BoundTool, input: Record<string, unknown>): Promise<boolean>;
  askElicitation(request: CreateElicitationRequest, signal?: AbortSignal): Promise<CreateElicitationResponse>;
  heardElicitationComplete(notification: CompleteElicitationNotification): void;
  answerElicitation(requestId: string, accepted: boolean, answers: Bag, response?: 'accept' | 'decline' | 'cancel'): boolean;
  settleElicitations(): void;
  readTextFile(request: ReadTextFileRequest): Promise<ReadTextFileResponse>;
  writeTextFile(request: WriteTextFileRequest): Promise<WriteTextFileResponse>;
  openTerminal(request: CreateTerminalRequest): Promise<CreateTerminalResponse>;
  terminalOutput(request: TerminalOutputRequest): Promise<TerminalOutputResponse>;
  waitForTerminalExit(request: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse>;
  killTerminal(request: KillTerminalRequest): Promise<KillTerminalResponse>;
  releaseTerminal(request: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse>;
  /**
   * The turn's end: the terminals its closing actions named, and every other
   * one still running.
   *
   * A terminal is background work once the call that made it has ended, and a
   * turn ending is the last moment a call can name one. What no call named is
   * still a shell the agent left running.
   */
  settleTerminals(closing: Bag[]): void;
  settlePermissions(): void;
  confirm: Session['confirm'];
}

/**
 * The name the operator's rule matches a tool call by.
 *
 * A tool of an MCP server is `mcp__<server>__<tool>` on the wire, and a rule
 * names it `<server>/<tool>`, as VS Code does. Everything else is its own name.
 */
const referenceName = (toolName: string): string => {
  const named = /^mcp__(.+?)__(.+)$/.exec(toolName);
  return named === null ? toolName : `${named[1]}/${named[2]}`;
};

/**
 * A permission request's options less the ones that would keep an answer.
 *
 * A rule that makes a tool ask every time leaves a person nothing to keep, so
 * the "always" choices a server offered are left out of what the card draws. A
 * server offering no once option of a kind then leaves that answer `cancelled`,
 * which is the rule's own answer rather than an "always" the person never gave.
 */
const onlyOnce = (options: readonly PermissionOption[]): PermissionOption[] =>
  options.filter((one) => one.kind === 'allow_once' || one.kind === 'reject_once');

export function createHandlers(ctx: SessionContext): Handlers {
  const { emit, provider, start, where, doing, touch, seeds, replay, permissions, terminals, elicitations } = ctx;

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

  /*
   * The server's commands, as the protocol holds prompts: the children of a
   * container, never customizations of their own. They are the server's and
   * no folder a client could write into, so one read-only directory holds
   * them, under the URI their own `acp-command:` URIs extend.
   */
  const commandsIn = (leaves: Bag[]): Bag[] => (leaves.length === 0 ? [] : [{
    type: 'directory',
    id: 'directory:commands',
    uri: `acp-command:${provider}`,
    name: 'commands',
    contents: 'prompt',
    enabled: true,
    writable: false,
    children: leaves,
  }]);

  /*
   * A terminal the server opened, as background work once its call has ended.
   *
   * ACP says nothing about a shell outliving the call that started it, so the
   * bridge reads it off the call's result: a terminal block whose process is
   * still alive is work in the background, while one that has exited is a call
   * that finished with its output. The row is the host's to draw, so nothing
   * here knows what a client sees.
   */

  /** The terminals a stop has already killed, so a second press answers false. */
  const stopping = new Set<string>();

  const stopHeld = async (held: HeldTerminal): Promise<boolean> => {
    const uri = held.handle.uri;
    if (held.exited === true || stopping.has(uri)) return false;
    stopping.add(uri);
    held.handle.kill();
    return true;
  };

  /** One terminal's row, labelled with what a call called it or its own line. */
  const workOf = (held: HeldTerminal, label: string): BackgroundTask => {
    const id = held.handle.uri;
    return {
      id,
      kind: 'shell',
      label,
      startedAt: held.openedAt,
      command: held.command,
      terminal: id,
      stop: () => stopHeld(held),
    };
  };

  /** Report one running terminal, once: a second set would be the same row. */
  const listHeld = (held: HeldTerminal, label: string): void => {
    const tasks = start.backgroundTasks;
    if (tasks === undefined || held.listed !== undefined || held.exited === true) return;
    held.listed = held.handle.uri;
    tasks.set(start.chatUri, workOf(held, label));
  };

  /** Take a listed terminal's row down, once, whichever end comes first. */
  const unlistHeld = (held: HeldTerminal): void => {
    const listed = held.listed;
    if (listed === undefined) return;
    delete held.listed;
    start.backgroundTasks?.remove(start.chatUri, listed);
  };

  /**
   * The terminals a completion names, listed when their process still runs.
   *
   * The content is where ACP says a call was about a terminal, and the id it
   * carries is the host's own URI because the bridge opened the shell. The
   * call's title labels the row: it is what the agent called the work.
   */
  const noteCall = (action: Bag): void => {
    if (action.type !== 'chat/toolCallComplete') return;
    const result = bag(action.result);
    if (!Array.isArray(result.content)) return;
    const label = typeof result.pastTenseMessage === 'string' ? result.pastTenseMessage : '';
    for (const block of result.content as Bag[]) {
      if (block.type !== 'terminal') continue;
      const held = terminals.get(String(block.resource));
      if (held !== undefined) listHeld(held, label === '' ? held.command : label);
    }
  };

  const settleTerminals = (closing: Bag[]): void => {
    for (const action of closing) noteCall(bag(action));
    // A terminal no call named is still work: the agent opened a shell and the
    // turn is over, and the process it started is not. The command line is the
    // only label there is, because no call carried a title for it.
    for (const held of terminals.values()) listHeld(held, held.command);
  };

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
      ctx.commands = commandsIn(update.availableCommands.map(commandLeaf));
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
    for (const action of mapUpdate(current, update, at, start.planUpdate)) {
      if (action.type === 'chat/usage' && ctx.active !== undefined) ctx.active.usage = bag(action.usage);
      // Before it goes out: a call that ends with a terminal still running is
      // the moment the host is told the shell is background work.
      noteCall(bag(action));
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
    // A path an agent in a machine names is its machine path; the store reads the host's.
    const read = await store.read(uriOf(hostPathOf(request.path)));
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
    // In the system's own spelling, as every other row of the changeset is: a
    // server on Windows may join a path with `/`, and one file named two ways
    // is two rows. A path an agent in a machine names is its machine path, and
    // the host's is the one it names.
    const path = normalize(hostPathOf(request.path));
    if (turnId !== undefined) await start.onFileEdit?.(turnId, path, 'before');
    await store.write(uriOf(path), { data: request.content, encoding: 'utf-8', mode: 'truncate' });
    if (turnId !== undefined) await start.onFileEdit?.(turnId, path, 'after');
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

  /**
   * A shell the agent asked for, opened and listed by the host.
   *
   * In a session placed in a machine the command runs there: the port is asked
   * how to reach the machine with this command, and the host's terminal runs
   * that descriptor. The terminal is still the host's to list and watch, and
   * only the process moves. On Linux and macOS the machine's path is the host's,
   * so a spawn here would succeed either way - what places the command is
   * `how`, not the path.
   *
   * The request's `cwd` is a machine path, so the port is given it in the host's
   * spelling. No `cwd` at all is sent when the request names none, so the port
   * uses the machine's own working directory, as the server's own spawn does.
   */
  const openTerminal = async (request: CreateTerminalRequest): Promise<CreateTerminalResponse> => {
    const shells = start.terminals;
    if (shells === undefined) throw new Error(`${provider}: this session has no shells`);
    const env = environmentOf(request);
    const id = machineIdOf(start);
    let run: OpenTerminal;
    if (id === undefined) {
      run = {
        cwd: request.cwd ?? where,
        command: request.command,
        ...(request.args !== undefined && request.args.length > 0 ? { args: request.args } : {}),
        ...(env === undefined ? {} : { env }),
      };
    }
    else {
      // Said again so the type knows what `machineIdOf` has already guaranteed:
      // a session with no computers port was refused there and never reaches this.
      const computers = start.computers;
      if (computers === undefined) {
        throw new Error(`This session asked to run in ${id}, and this host has no computer plugin to run it in`);
      }
      const how = await computers.how(id, {
        command: request.command,
        ...(request.args !== undefined && request.args.length > 0 ? { args: request.args } : {}),
        ...(env === undefined ? {} : { env }),
        ...(request.cwd === undefined || request.cwd === null ? {} : { cwd: hostPathOf(request.cwd) }),
      });
      if (how === undefined) throw new Error(`There is no computer called ${id}`);
      // The host's own folder is where the descriptor's program starts; the
      // directory the command itself works in is the machine's, in the argv
      // `how` answered.
      run = {
        cwd: where,
        command: how.command,
        ...(how.args === undefined ? {} : { args: how.args }),
        ...(how.env === undefined ? {} : { env: how.env }),
      };
    }
    const handle = shells.open(run);
    const held: HeldTerminal = {
      handle,
      openedAt: new Date().toISOString(),
      command: [request.command, ...(request.args ?? [])].join(' '),
      ...(typeof request.outputByteLimit === 'number' ? { limit: request.outputByteLimit } : {}),
    };
    terminals.set(handle.uri, held);
    const gone = (): void => {
      held.exited = true;
      // The process a row described has ended, so the row ends with it.
      unlistHeld(held);
    };
    void handle.waitForExit().then(gone, gone);
    return { terminalId: handle.uri };
  };

  /** One by its own id, or a refusal the server reads as a failed request. */
  const terminalOf = (id: string): HeldTerminal => {
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
    // The one path a client's stop takes too, so a terminal the agent kills
    // answers a stop that arrives after it with `false`.
    await stopHeld(terminalOf(request.terminalId));
    return {};
  };

  const releaseTerminal = async (request: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> => {
    const held = terminalOf(request.terminalId);
    // Before the terminal goes: the row lasts as long as the process does, and
    // a release is the agent saying it is done with it. The exit a release
    // causes behind this finds nothing left to remove.
    unlistHeld(held);
    held.handle.release();
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
   *
   * A tool the operator's rule names is the exception: its question offers the
   * once options alone, so the card has nothing on it that would keep an
   * answer.
   */
  const askPermission = async (request: RequestPermissionRequest): Promise<PermissionAnswer> => {
    const option = (kind: PermissionOptionKind): string | undefined =>
      request.options.find((one) => one.kind === kind)?.optionId;
    const allow = option('allow_once');
    const reject = option('reject_once');
    /*
     * The rule, read before the server's own options.
     *
     * A tool the rule names is one a person answers on every call, so the
     * "always" choices the server offered are not put to them and a remembered
     * one never applies. Read without an await, because the question has to be
     * on the session before an update that arrives behind this request can
     * ready the call itself.
     */
    const called = request.toolCall.name ?? request.toolCall.title ?? request.toolCall.toolCallId;
    const matched = start.getAutoApproval?.('tool', referenceName(called)) === 'ask';
    /*
     * A shell command the owner's rules already allow.
     *
     * An ACP server asks about a command as a call of kind `execute`, and
     * codex-acp 1.13.1 sends the line as `rawInput.command` beside its folder.
     * The host answers from the rules the window that started this session
     * pushed, and only an approval reaches here: a rule that denied it and a
     * line no rule could read both answer nothing, and the question is put as
     * it always was. The server's `allow_once` is selected rather than an
     * "always", which would change this session's policy from one command;
     * a server offering no `allow_once` is not answered by the check at all.
     *
     * A call the rule names is not the shell check's: the rule wins over every
     * terminal allow, so its question is put anyway.
     */
    if (!matched && request.toolCall.kind === 'execute') {
      const command = str(bag(request.toolCall.rawInput).command);
      if (command !== undefined && (await start.getAutoApproval?.('shell', command, 'bash')) === 'not-needed') {
        if (allow !== undefined) return { optionId: allow };
      }
    }
    const offered = confirmationOptions(matched ? onlyOnce(request.options) : request.options);
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
    // Which client's tool the question is about, read the way the mapping reads
    // a reported call: the name it gave, and the title only when it named none.
    const owner = ctx.ownerOf(request.toolCall.name ?? undefined, request.toolCall.title ?? toolCallId);
    const contributor: Bag = owner === undefined ? {} : { contributor: { kind: 'client', clientId: owner } };
    const existing = ctx.mapping === undefined ? undefined : callPartOf(ctx.mapping, toolCallId);
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
      Object.assign(call, contributor);
      ctx.mapping.parts.push({ kind: 'toolCall', toolCall: call });
      emit('chat', {
        type: 'chat/toolCallStart', turnId, toolCallId,
        toolName: call.toolName, displayName: call.displayName,
        ...contributor,
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
        ...(owner === undefined ? {} : { owner }),
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

  /** How many questions this bridge has raised about a tool it serves. */
  let questioned = 0;

  /**
   * Whether a tool the host serves may run, asked by the tools server first.
   *
   * The agent calls the host's tools over the MCP server this session handed
   * it, so the call never passes through this bridge and the server has to be
   * the one that asks. A tool the rule does not name answers at once, which is
   * every call in a session with no rule. A tool it names is put to a person
   * with one approval and one refusal and nothing to keep, named as the agent
   * spells that server's tools, and the person's answer is the server's.
   */
  const askTool = async (tool: BoundTool, input: Record<string, unknown>): Promise<boolean> => {
    const name = tool.definition.name;
    if (start.getAutoApproval?.('tool', `${HOST_TOOLS}/${name}`) !== 'ask') return true;
    questioned += 1;
    const answered = await askPermission({
      sessionId: ctx.acpSessionId ?? '',
      toolCall: {
        toolCallId: `mcp-question-${questioned}`,
        title: tool.definition.title ?? name,
        name: `mcp__${HOST_TOOLS}__${name}`,
        kind: 'other',
        status: 'pending',
        rawInput: input,
      },
      options: [
        { optionId: 'approve', name: 'Approve', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
      ],
    });
    return answered !== 'cancelled' && answered.optionId === 'approve';
  };

  /** How many forms this session has asked for, for the ones with no name of their own. */
  let elicited = 0;

  /**
   * The page a URL elicitation asks a person to open, and the id it is known by.
   *
   * ACP writes an elicitation as a form or as a page, and only the page carries
   * an id of its own - the same id the server names in `elicitation/complete`
   * when its own flow is over, which is why a page is held under it.
   */
  const pageOf = (request: CreateElicitationRequest): { id: string; url: string } | undefined => {
    const held = bag(request);
    const id = str(held.elicitationId);
    const url = str(held.url);
    return request.mode === 'url' && id !== undefined && url !== undefined ? { id, url } : undefined;
  };

  /**
   * What one elicitation is called on the chat.
   *
   * The server's own id for a page, because that is the name a completion comes
   * back under. A form carries no id: one asked about a tool call is named for
   * that call, exactly as the permission for the same call is, and one asked
   * about nothing in particular is counted.
   */
  const nameOf = (request: CreateElicitationRequest, call: string | undefined): string => {
    const page = pageOf(request);
    if (page !== undefined) return page.id;
    return call === undefined ? `elicitation:${++elicited}` : `${call}:elicitation`;
  };

  /**
   * A question the server is blocked on, put to the person on the chat.
   *
   * The second thing an ACP server can stop on and wait, beside a permission,
   * and it is asked the same way: the request goes on the chat, the session
   * says somebody is needed, and the answer comes back through `answer`. What
   * differs is only what is asked - a form to fill in, or a page to open.
   *
   * The ACP request is left open for as long as the question stands, so the
   * server is blocked on the person rather than on the client.
   *
   * `signal` is the request's own, and a server that withdraws the question
   * aborts it. A question nobody is being asked any more is taken off the chat
   * and answered `cancel`, which is the same ending a stop gives it: the
   * asking stopped, so the server is told a cancel rather than left holding an
   * answer that is never coming. A signal that arrived already aborted is a
   * question asked after the answer stopped mattering, and it is settled
   * without ever being put on the chat.
   */
  const askElicitation = (
    request: CreateElicitationRequest,
    signal?: AbortSignal,
  ): Promise<CreateElicitationResponse> => {
    if (signal?.aborted === true) return Promise.resolve({ action: 'cancel' });
    const held = bag(request);
    const page = pageOf(request);
    const questions = page === undefined ? questionsFor(held.requestedSchema) : [];
    const id = nameOf(request, str(held.toolCallId));
    const message = str(held.message);
    const asking: Bag = {
      id,
      ...(message === undefined ? {} : { message }),
      ...(page === undefined ? {} : { url: page.url }),
      ...(questions.length === 0 ? {} : { questions }),
    };
    const answered = new Promise<CreateElicitationResponse>((resolve) => {
      elicitations.set(id, {
        fields: new Set(questions.map((one) => String(one.id))),
        typed: typedOf(held.requestedSchema),
        settle: resolve,
      });
    });
    emit('chat', { type: 'chat/inputRequested', request: asking });
    // The chat input entry, which is the one kind of input request that names
    // no turn: a question stands on the chat rather than in the turn that
    // happened to be running when the server asked it.
    emit('session', {
      type: 'session/inputNeededSet',
      request: { id, chat: start.chatUri, kind: 'chatInput', request: asking },
    });
    /*
     * The question the server takes back, off the chat.
     *
     * Nothing happens if the question is no longer open: a person's answer, a
     * stop, or the server's own completion has already ended it, and a second
     * ending would be a second settle of a promise already settled. The entry
     * goes the way an answer takes it, and the chat is told the request is over
     * the way a completion tells it, because no client is going to send that
     * `chat/inputCompleted` for a question it was never asked to answer.
     */
    signal?.addEventListener('abort', () => {
      const open = elicitations.get(id);
      if (open === undefined) return;
      elicitations.delete(id);
      emit('session', { type: 'session/inputNeededRemoved', id });
      emit('chat', { type: 'chat/inputCompleted', requestId: id, response: 'cancel' });
      open.settle({ action: 'cancel' });
      doing('Thinking');
      touch();
    }, { once: true });
    doing('Waiting on you');
    touch();
    return answered;
  };

  /**
   * A person's answer to the question the server is waiting on.
   *
   * Found by the id the request was raised under rather than assumed to be the
   * one held, because two questions can be open at once and answering the wrong
   * one is worse than answering none. What the server is handed is the answer's
   * own content, keyed by the fields the form asked for, and a form nobody
   * filled in carries none - which is what an accept of an empty form is.
   *
   * False when nothing here is waiting on that id, which the host reads as an
   * answer to something this session never asked.
   *
   * `response` is the kind the client sent, where it sent one: a cancel is
   * answered `cancel`, and every other refusal is a decline. The two are not
   * the same thing to say to a server - a decline is somebody saying no, a
   * cancel is nobody having been asked - and a client that named no kind is
   * answered by the boolean it did send.
   */
  const answerElicitation = (
    requestId: string,
    accepted: boolean,
    answers: Bag,
    response?: 'accept' | 'decline' | 'cancel',
  ): boolean => {
    const open = elicitations.get(requestId);
    if (open === undefined) return false;
    elicitations.delete(requestId);
    emit('session', { type: 'session/inputNeededRemoved', id: requestId });
    const content = contentOf(answers, open.fields, open.typed);
    open.settle(accepted
      ? { action: 'accept', ...(Object.keys(content).length === 0 ? {} : { content }) }
      : { action: response === 'cancel' ? 'cancel' : 'decline' });
    doing('Thinking');
    touch();
    return true;
  };

  /**
   * The server saying its own piece is over.
   *
   * A page is the one elicitation nobody answers here: the person opens what
   * the server sent them to, and what happens on it is the server's business.
   * So the completion is the server's, and it ends the question the same way a
   * person's answer would have - the chat is told the request was accepted, and
   * the server is told nothing more, because this is its own word arriving.
   *
   * A completion for a request that is not open is nothing to do: either it was
   * never asked here, or somebody answered it while the person was away.
   */
  const heardElicitationComplete = (notification: CompleteElicitationNotification): void => {
    const id = notification.elicitationId;
    const open = elicitations.get(id);
    if (open === undefined) return;
    elicitations.delete(id);
    emit('chat', { type: 'chat/inputCompleted', requestId: id, response: 'accept' });
    emit('session', { type: 'session/inputNeededRemoved', id });
    open.settle({ action: 'accept' });
  };

  /**
   * Every question nobody will answer now, answered `cancel`.
   *
   * The protocol asks a client that stops a turn to answer what its server is
   * still blocked on, and an elicitation is one of those: a server left waiting
   * on a person who has already said stop is a turn that never ends. `cancel`
   * rather than a decline, because nobody said no - the question stopped being
   * asked, and an answer that said no would be one the person never gave.
   *
   * The chat is told as well, for the same reason a withdrawal tells it: this
   * is an ending nobody sent a `chat/inputCompleted` for, and a client left
   * drawing the question would go on offering an answer no server is waiting
   * on.
   */
  const settleElicitations = (): void => {
    for (const [id, open] of elicitations) {
      emit('session', { type: 'session/inputNeededRemoved', id });
      emit('chat', { type: 'chat/inputCompleted', requestId: id, response: 'cancel' });
      open.settle({ action: 'cancel' });
    }
    elicitations.clear();
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
    const part = ctx.mapping === undefined ? undefined : callPartOf(ctx.mapping, toolCallId);
    if (part !== undefined) {
      const call = bag(bag(part).toolCall);
      call.status = approved ? 'running' : 'cancelled';
      if (approved) call.confirmed = 'user-action';
      delete call.options;
      delete call.confirmationTitle;
      if (picked !== undefined) call.selectedOption = picked;
    }
    /*
     * An allowed call is one that runs, so this is where a client that owns it
     * is asked to run it.
     *
     * The mapping's own readiness never comes for a call a question has stood
     * on - `asked` is what stopped it - so without this a client would never be
     * told about a call the person has just allowed. Before the action that
     * says the call is running, because the entry exists before the chat does.
     */
    const allowed = ctx.mapping?.calls.get(toolCallId);
    if (approved && allowed !== undefined && ctx.mapping !== undefined) {
      ctx.openCall(allowed, ctx.mapping.turnId);
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
    askTool,
    readTextFile,
    writeTextFile,
    openTerminal,
    terminalOutput,
    waitForTerminalExit,
    killTerminal,
    releaseTerminal,
    settleTerminals,
    askElicitation,
    heardElicitationComplete,
    answerElicitation,
    settlePermissions,
    settleElicitations,
    confirm,
  };
}