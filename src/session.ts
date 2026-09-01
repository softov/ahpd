import { query } from '@anthropic-ai/claude-agent-sdk';
import { Status } from './catalog.js';
import { tail } from './transcript.js';
import type { ActiveTurn, McpServerState } from '@microsoft/agent-host-protocol';
import type { OnWire, WireTurn } from './types/wire.js';
import type { Bag } from './types/common.js';
import type { Session, SessionOptions } from './types/session.js';

/**
 * One agent session, reduced into the state its channels hold.
 *
 * The agent SDK reports what happened as its own message stream; a host has to
 * report the same events as AHP state actions. This module is that
 * translation, and holds the resulting state for a subscription snapshot.
 *
 * Rules the protocol requires of anything emitting chat actions:
 *
 * - A response part must exist before text streams into it: emit
 *   `chat/responsePart` to create it, then `chat/delta` to append. A delta
 *   naming a part that was never opened appends to nothing.
 * - The running turn is `activeTurn` and is not in `turns`. It moves into
 *   `turns` when it completes.
 * - A turn carries both sides: `message.text` is what the person said,
 *   `responseParts` is what the agent answered.
 * - The client starts turns. `chat/turnStarted` arrives from the client; the
 *   host reduces it and runs the agent.
 */

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

interface PendingInput {
  id: string;
  entry: Bag;
  /** `AskUserQuestion` needs its own payload echoed back verbatim. */
  questions?: unknown[];
  /** Question id to the question text the SDK keys answers by. */
  asked: Map<string, string>;
  settle(result: { behavior: 'allow'; updatedInput: Bag } | { behavior: 'deny'; message: string }): void;
}

/**
 * What a tool call is *about*, in one line.
 *
 * The only thing separating twenty identical rows, so it is worth doing per
 * tool: `Bash` is its command, the file tools are their path. A row reading
 * `{"file_path":"/very/long/…","offset":0}` is a row nobody reads.
 */
function summarize(name: string, input: Bag): string | undefined {
  if (name === 'Bash') return str(input.command);
  if (name === 'Read' || name === 'Write' || name === 'Edit') return str(input.file_path);
  if (name === 'Glob' || name === 'Grep') return str(input.pattern);
  if (name === 'Task' || name === 'Agent') return str(input.description);
  return Object.keys(input).length > 0 ? JSON.stringify(input).slice(0, 400) : undefined;
}

function resultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  const parts = list(content).map((block) => str(bag(block).text)).filter((t): t is string => t !== undefined);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * What the session was handed, in the protocol's shape.
 *
 * Eight `CustomizationType`s and one flat list. `disableUserInvocation` is
 * what decides whether a skill or prompt appears after a slash - offering one
 * the host will refuse is worse than not offering it at all.
 *
 * The source is the CLI's *control* protocol, not its message stream:
 * `initializationResult()` and `mcpServerStatus()` answer without a turn
 * having happened. That matters because everything here is what a client
 * needs **before** anybody says anything - the models to pick from, the
 * commands behind a slash. Waiting for the `init` message would mean a
 * composer that can only offer them once the conversation has started, which
 * is exactly too late.
 */
export function customizationsOf(init: Bag, mcp: unknown[], skills: unknown[] = []): Bag[] {
  const out: Bag[] = [];

  /*
   * Which of the commands are skills, and which skills a person can invoke.
   *
   * The CLI hands out two lists that overlap and neither says which is which:
   * `commands` is what a slash offers, `skills` is what was loaded from disk.
   * A command in both is a skill; one in `commands` alone is a built-in
   * prompt. And a skill the CLI did *not* put behind a slash is one it will
   * not let a person invoke - which is the agent-only skill the protocol has
   * `disableUserInvocation` for, read off the CLI's own two answers rather
   * than guessed from a name.
   */
  const offered = new Map(list(init.commands)
    .map((raw) => [str(bag(raw).name) ?? '', bag(raw)] as const)
    .filter(([name]) => name !== ''));
  const loaded = new Map(list(skills)
    .map((raw) => [str(bag(raw).name) ?? '', bag(raw)] as const)
    .filter(([name]) => name !== ''));

  for (const [name, skill] of loaded) {
    const command = offered.get(name);
    const described = str(skill.description) ?? str(bag(command).description);
    const hint = str(skill.argumentHint) ?? str(bag(command).argumentHint);
    out.push({
      type: 'skill',
      id: `skill:${name}`,
      name,
      uri: name,
      enabled: true,
      ...(command ? {} : { disableUserInvocation: true }),
      ...(described ? { description: described } : {}),
      ...(hint ? { argumentHint: hint } : {}),
    });
  }

  for (const [name, command] of offered) {
    if (loaded.has(name)) continue;
    out.push({
      type: 'prompt',
      id: `command:${name}`,
      name,
      uri: name,
      enabled: true,
      ...(str(command.description) ? { description: str(command.description) as string } : {}),
      ...(str(command.argumentHint) ? { argumentHint: str(command.argumentHint) as string } : {}),
    });
  }

  for (const raw of list(init.agents)) {
    const found = bag(raw);
    const name = str(found.name);
    if (!name) continue;
    out.push({
      type: 'agent',
      id: `agent:${name}`,
      name,
      uri: name,
      enabled: true,
      ...(str(found.description) ? { description: str(found.description) as string } : {}),
    });
  }

  for (const raw of mcp) {
    const server = bag(raw);
    const name = str(server.name);
    if (!name) continue;
    const reported = str(server.status);
    const said = str(server.error);
    /*
     * The state, in the shape the kind it claims actually requires.
     *
     * The protocol's words, not the SDK's: the CLI says `connected` and
     * `failed`, a client reads `ready` and `error`. Each kind carries
     * different fields and only `error` carries any - `ready`, `starting` and
     * `stopped` are `{ kind }` and nothing else, and `error` needs a whole
     * `ErrorInfo` rather than the bare `message` this used to send.
     *
     * **A server needing a sign-in is reported as an error, and that is the
     * closest to the specification this host can get.**
     * `McpServerAuthRequiredState` requires two things it cannot produce: a
     * `reason`, and a `resource` whose identifier is the canonical MCP server
     * URI with `authorization_servers` the MCP authorization spec calls
     * REQUIRED. All the SDK reports is a name and `needs-auth`. Emitting the
     * state anyway would be two required fields short - a client told to sign
     * in with nothing to sign into, which is a button that cannot be wired to
     * anything. So the fact goes where a person can still read it, in the
     * message, and the state is one this host can satisfy completely. See
     * A-01-09.
     */
    const state: OnWire<McpServerState> = reported === 'connected' ? { kind: 'ready' }
      : reported === 'disabled' ? { kind: 'stopped' }
        : reported === 'failed'
          ? {
            kind: 'error',
            error: { errorType: 'mcpServerFailed', message: said ?? 'The server did not start.' },
          }
          : reported === 'needs-auth'
            ? {
              kind: 'error',
              error: {
                errorType: 'mcpAuthRequired',
                message: said ?? 'This server needs signing in, and it did not say where.',
              },
            }
            : { kind: 'starting' };
    out.push({
      type: 'mcpServer',
      id: `mcp:${name}`,
      name,
      uri: name,
      // Off the CLI's own word rather than off the kind above, so a server
      // that needs signing in stays switched *on* - it is enabled and
      // unreachable, which is not the same as somebody having turned it off.
      enabled: reported !== 'failed' && reported !== 'disabled',
      state,
    });
  }

  return out;
}

export function createSession(options: SessionOptions): Session {
  const { uri, chatUri, cwd, emit } = options;

  const turns: Bag[] = [...(options.seed ?? [])];
  let active: Bag | undefined;
  let pending: PendingInput | undefined;
  let title = str(bag(bag((options.seed ?? [])[0]).message).text)?.slice(0, 60) || 'New session';
  let modified = new Date().toISOString();
  let failed: string | undefined;
  let startedAt = 0;
  let handshake: Bag | undefined;
  /**
   * The id the agent gave this session, which is not the URI it is served at.
   *
   * The client picks the URI before anything exists; the CLI picks its own id
   * when it starts and writes the transcript under that. Both name the same
   * conversation, so the catalogue has to know they do - otherwise the row on
   * disk and the row in memory are two sessions saying the same thing.
   */
  let agentId: string | undefined = options.resume;
  /** What the session is doing, in one line, or nothing when it is idle. */
  let activity: string | undefined;
  /**
   * Messages waiting for the running turn to end.
   *
   * The host's, not a client's. A client that held them would be the only
   * thing that could ever send them, and would not - nothing in a client is
   * watching for a turn to end - and a second client watching the same chat
   * would not see them at all.
   */
  const queued: Bag[] = [];
  /**
   * What somebody is part-way through typing.
   *
   * Held here so two people on one session see each other's, which is the
   * only reason a draft is on the wire at all - a client that kept its own
   * would need nothing from a host for it.
   */
  let draft = '';
  let customizations: Bag[] = [...(options.seedCustomizations ?? [])];
  let offered: { id: string; name: string }[] = [];
  /** What the client picked. Absent means whatever the CLI defaults to. */
  let chosen: string | undefined;
  /** The config in force, by key. What `session/configChanged` merges into. */
  const settings: Record<string, string> = { permissionMode: 'default', ...options.settings };

  /** Open parts, keyed by message and index; tool calls by their own id. */
  const parts = new Map<string, Bag>();
  let streaming: string | undefined;

  // The input stream. A query with a live stream stays open between turns,
  // which is what makes a session a session rather than a series of them.
  const waiting: { type: 'user'; message: { role: 'user'; content: string }; parent_tool_use_id: null }[] = [];
  let wake: (() => void) | undefined;
  let closed = false;

  async function* input(): AsyncGenerator<(typeof waiting)[number]> {
    for (;;) {
      while (waiting.length > 0) yield waiting.shift() as (typeof waiting)[number];
      if (closed) return;
      await new Promise<void>((resolve) => { wake = resolve; });
    }
  }

  const touch = (): void => { modified = new Date().toISOString(); };

  /**
   * Say what it is doing now, if that has changed.
   *
   * On both channels: the chat is where the work happens, and the protocol
   * says a session mirrors its default chat's activity - which is the one a
   * catalogue row and a detail pane read.
   */
  const doing = (said: string | undefined): void => {
    if (activity === said)
      return;
    activity = said;
    emit('chat', { type: 'chat/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
    emit('session', { type: 'session/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
  };

  /** One line for a tool that is running. The name alone says too little. */
  /**
   * The file a tool is about to change, if it is one of the tools that do.
   *
   * Named tools rather than a guess at the input: a tool called `Bash` may
   * write a file too, and there is nothing in `rm -rf` that says which. What
   * this misses is honest - a changeset that claimed a file it could not name
   * would be worse than one that says nothing about it.
   */
  const edits = (name: string, input: Bag): string | undefined => {
    const known = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
    if (!known.includes(name)) return undefined;
    const path = str(input.file_path) ?? str(input.notebook_path);
    return path === '' ? undefined : path;
  };

  const busyWith = (name: string, input: Bag): string => {
    const what = summarize(name, input);
    return (what ? `${name} ${what}` : name).replace(/\s+/g, ' ').slice(0, 80);
  };

  /** Retitle, and say so: a client that opened the session holds the old one. */
  const retitle = (said: string): void => {
    if (said === '' || said === title)
      return;
    title = said;
    emit('session', { type: 'session/titleChanged', title });
  };

  /**
   * The SDK's token counts, in the protocol's spelling.
   *
   * Every field is optional on both sides, so anything missing is left out
   * rather than reported as zero - a nought is a measurement and an absence
   * is not.
   */
  const usageOf = (raw: unknown): Bag | undefined => {
    const found = bag(raw);
    const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
    const info: Bag = {
      ...(num(found.input_tokens) !== undefined ? { inputTokens: num(found.input_tokens) } : {}),
      ...(num(found.output_tokens) !== undefined ? { outputTokens: num(found.output_tokens) } : {}),
      ...(num(found.cache_read_input_tokens) !== undefined ? { cacheReadTokens: num(found.cache_read_input_tokens) } : {}),
    };
    return Object.keys(info).length > 0 ? info : undefined;
  };

  const status = (): number => (pending ? Status.InputNeeded
    : active ? Status.InProgress
      : failed ? Status.Error
        : Status.Idle);

  /** The session-level summary of what is wanted. Set with the tool call, cleared with it. */
  const inputNeededSet = (entry: Bag): void => {
    emit('session', { type: 'session/inputNeededSet', inputNeeded: [entry] });
  };
  const inputNeededRemoved = (): void => {
    emit('session', { type: 'session/inputNeededRemoved' });
  };

  // ------------------------------------------------------------- translation

  const openTurn = (): Bag => {
    if (active) return active;
    // A turn the client did not begin: the agent spoke first, which happens on
    // a resumed session. Better an id of our own than a turn with none.
    // `usage` is required on an `ActiveTurn` and means "not measured yet".
    // Leaving the key off put a turn on the wire that did not satisfy its own
    // type, which nothing here would have noticed.
    active = {
      id: `turn-${Date.now()}`,
      startedAt: new Date().toISOString(),
      // The agent spoke first, so the message in front of this turn is its
      // own. `Message.origin` is required and used to be left off entirely.
      message: { text: '', origin: { kind: 'agent' } },
      responseParts: [],
      usage: undefined,
    } satisfies WireTurn<ActiveTurn> as Bag;
    startedAt = Date.now();
    emit('chat', {
      type: 'chat/turnStarted',
      turnId: active.id,
      startedAt: active.startedAt,
      message: { text: '', origin: { kind: 'agent' } },
    });
    return active;
  };

  /** Prose: the part is announced, then filled by deltas. */
  const addPart = (turn: Bag, part: Bag): void => {
    (turn.responseParts as Bag[]).push(part);
    emit('chat', { type: 'chat/responsePart', turnId: turn.id, part });
  };

  /**
   * A tool call: held for the snapshot, and announced by `chat/toolCallStart`.
   *
   * That action *creates* the response part on the client side, so sending
   * `chat/responsePart` for one as well puts the same call in the transcript
   * twice - once as this host's part and once as the reducer's own.
   */
  const holdPart = (turn: Bag, part: Bag): void => {
    (turn.responseParts as Bag[]).push(part);
  };

  /**
   * Why a turn stopped, as a part of it.
   *
   * 0.9.0 took `error` off `Turn` and gave the reason a response part instead,
   * which is the better home for it: what the agent said before it failed
   * still stands, and the failure belongs after those three things rather than
   * beside them. Without this the state says `error` and nothing anywhere says
   * what went wrong.
   *
   * No `resumable`. It is only ever `true` to offer a resume, and this host
   * cannot resume a turn - saying so with a `false` it never varies would be
   * answering a question nobody asked.
   */
  const addFailure = (turn: Bag, why: string): void => {
    addPart(turn, {
      kind: 'error',
      id: `${str(turn.id) ?? 'turn'}:error`,
      error: { errorType: 'turnFailed', message: why },
    });
  };

  const streamed = (event: Bag): void => {
    const type = str(event.type);

    if (type === 'message_start') {
      streaming = str(bag(event.message).id) ?? 'm';
      openTurn();
      return;
    }

    const of = streaming ?? 'm';
    const key = `#${of}:${String(event.index)}`;

    if (type === 'content_block_start') {
      const turn = openTurn();
      const kind = str(bag(event.content_block).type);
      // Only prose streams into a part. A tool call's arguments stream as
      // json, and a row redrawing per keystroke of a json blob says nothing
      // until it is complete.
      if (kind !== 'text' && kind !== 'thinking') return;
      if (parts.has(key)) return;
      const part: Bag = {
        id: `${of}:${String(event.index)}`,
        kind: kind === 'text' ? 'markdown' : 'reasoning',
        content: '',
      };
      parts.set(key, part);
      // The part first, always. A delta naming a part nobody opened is text
      // the client has nowhere to put.
      addPart(turn, part);
      return;
    }

    if (type === 'content_block_delta') {
      const part = parts.get(key);
      if (!part) return;
      const text = str(bag(event.delta).text) ?? str(bag(event.delta).thinking);
      if (text === undefined) return;
      part.content = `${String(part.content ?? '')}${text}`;
      /*
       * The append action follows the part it appends to.
       *
       * `chat/delta` is defined against a *markdown* part and `chat/reasoning`
       * against a *reasoning* one, and the canonical reducer enforces the
       * pairing rather than being lenient about it - a delta naming a
       * reasoning part is returned unchanged. Sending thinking as a delta
       * therefore opens the part and never fills it, which draws a thinking
       * header with nothing under it for as long as the model thinks.
       */
      const append = part.kind === 'reasoning' ? 'chat/reasoning' : 'chat/delta';
      emit('chat', { type: append, turnId: active?.id, partId: part.id, content: text });
    }
  };

  const assistant = (message: Bag): void => {
    const turn = openTurn();
    const of = str(message.id) ?? 'm';
    const blocks = list(message.content);

    for (let index = 0; index < blocks.length; index++) {
      const block = bag(blocks[index]);
      const kind = str(block.type);

      if (kind === 'text' || kind === 'thinking') {
        // Already opened and already filled by the deltas. Writing the complete
        // block on top of it prints the whole answer twice.
        if (parts.has(`#${of}:${index}`)) continue;
        const part: Bag = {
          id: `${of}:${index}`,
          kind: kind === 'text' ? 'markdown' : 'reasoning',
          content: str(block.text) ?? str(block.thinking) ?? '',
        };
        parts.set(`#${of}:${index}`, part);
        addPart(turn, part);
        continue;
      }

      if (kind === 'tool_use') {
        const id = str(block.id) ?? `${of}:${index}`;
        // Already open: the same assistant message can arrive more than once
        // while it streams, and the permission callback opens the call under
        // this very id when one is asked about. Either way it is one call, and
        // a second part for it is the same row drawn twice.
        if (parts.has(id)) continue;
        const name = str(block.name) ?? 'tool';
        const command = summarize(name, bag(block.input));
        const call: Bag = {
          toolCallId: id,
          toolName: name,
          displayName: name,
          status: 'running',
          ...(command ? { toolInput: command } : {}),
        };
        const part: Bag = { id, kind: 'toolCall', toolCall: call };
        parts.set(id, part);
        holdPart(turn, part);
        doing(busyWith(name, bag(block.input)));
        /*
         * The file as it is *now*, before the tool has run.
         *
         * Announced and executed are concurrent - the SDK yields this block
         * and runs the tool - so this is a race the tool's own disk I/O
         * usually loses. Best effort, and the reference host relies on the
         * same headroom.
         */
        const changing = edits(name, bag(block.input));
        if (changing !== undefined) {
          editing.set(id, changing);
          options.onFileEdit?.(str(turn.id) ?? '', changing, 'before');
        }
        emit('chat', { type: 'chat/toolCallStart', turnId: turn.id, toolCallId: id, toolName: name, displayName: name });
        emit('chat', {
          type: 'chat/toolCallReady',
          turnId: turn.id,
          toolCallId: id,
          // The tool's name, never its input. A client draws the intention
          // above the input, so the same string in both is the command
          // printed twice on every row.
          invocationMessage: name,
          // Nothing is being asked here - `canUseTool` is what asks. Without
          // this the reducer moves every tool call in the transcript into
          // `pending-confirmation` and draws it as a question nobody put.
          confirmed: 'not-needed',
          ...(command ? { toolInput: command } : {}),
        });
      }
    }
  };

  const results = (message: Bag): void => {
    for (const raw of list(message.content)) {
      const block = bag(raw);
      if (str(block.type) !== 'tool_result') continue;
      const id = str(block.tool_use_id);
      const part = id ? parts.get(id) : undefined;
      if (!part) continue;
      const call = bag(part.toolCall);
      call.status = block.is_error === true ? 'failed' : 'completed';
      // Back to thinking. Leaving the last tool's name up makes a session look
      // busy with something that finished.
      doing('Thinking');
      const text = resultText(block.content);
      if (text !== undefined) call.content = [{ text }];
      // And as it is now the tool has run. Paired with the `before` above by
      // the call's own id, which is the only thing that survives the gap.
      const changed = id === undefined ? undefined : editing.get(id);
      if (id !== undefined && changed !== undefined) {
        editing.delete(id);
        options.onFileEdit?.(str(active?.id) ?? '', changed, 'after');
      }
      emit('chat', {
        type: 'chat/toolCallComplete',
        turnId: active?.id,
        toolCallId: id,
        status: call.status,
        ...(text !== undefined ? { content: [{ text }] } : {}),
      });
    }
  };

  // ------------------------------------------------------ asking a person

  const canUseTool = async (toolName: string, raw: Bag, asked?: Bag): Promise<unknown> =>
    new Promise((settle) => {
      const turn = openTurn();
      const about = bag(asked);
      /*
       * The agent's own id for this call.
       *
       * Not one of this host's making. The assistant message opens the call
       * under this id, and a confirmation that invented its own put a second
       * row beside it for the same command - and answered under a name the
       * client had never been given, so approving did nothing.
       */
      const id = str(about.toolUseID) ?? `req-${Date.now()}`;

      if (toolName === 'AskUserQuestion') {
        const asked = new Map<string, string>();
        const questions = list(raw.questions).map((entry, index) => {
          const question = bag(entry);
          const key = `q${index + 1}`;
          asked.set(key, str(question.question) ?? '');
          return {
            id: key,
            kind: question.multiSelect === true ? 'multi-select' : 'single-select',
            message: str(question.question) ?? '',
            required: true,
            // The label is the id, because the label is what the SDK wants
            // back: answers are valued by the option's own label, not by an id.
            options: list(question.options).map((option) => ({
              id: str(bag(option).label) ?? '',
              label: str(bag(option).label) ?? '',
            })),
            allowFreeformInput: true,
          };
        });
        const request = { id, message: str(raw.header) ?? 'The agent has a question', questions };
        const entry: Bag = { id, kind: 'chatInput', request };
        pending = { id, entry, questions: list(raw.questions), asked, settle };
        emit('chat', { type: 'chat/inputRequested', turnId: turn.id, request });
        inputNeededSet(entry);
        touch();
        return;
      }

      const command = summarize(toolName, raw);
      const displayName = str(about.displayName) ?? toolName;
      /*
       * The sentence a person reads, which is not the input.
       *
       * The CLI renders one - "Claude wants to run …" - and it is better than
       * anything rebuilt here. Its subtitle is sometimes the input itself
       * though, and a client draws the intention *above* the input, so a
       * sentence that is the input is the command printed twice.
       */
      const said = str(about.title) ?? str(about.description);
      const invocationMessage = said !== undefined && said !== command ? said : displayName;
      const confirmationTitle = str(about.title) ?? `Run ${displayName}?`;

      // The call the assistant message opened, if it arrived first. Which of
      // the two comes first is the CLI's business; either order is one call.
      const held = parts.get(id);
      const call = held ? bag(held.toolCall) : {
        toolCallId: id,
        toolName,
        displayName,
        ...(command ? { toolInput: command } : {}),
      } as Bag;
      call.status = 'pending-confirmation';
      call.confirmationTitle = confirmationTitle;
      if (!held) {
        const part: Bag = { id, kind: 'toolCall', toolCall: call };
        parts.set(id, part);
        holdPart(turn, part);
        emit('chat', { type: 'chat/toolCallStart', turnId: turn.id, toolCallId: id, toolName, displayName });
      }
      emit('chat', {
        type: 'chat/toolCallReady',
        turnId: turn.id,
        toolCallId: id,
        invocationMessage,
        confirmationTitle,
        ...(command ? { toolInput: command } : {}),
      });

      doing(`Waiting on you: ${displayName}`);
      const entry: Bag = { id, kind: 'toolConfirmation', toolCall: call };
      pending = {
        id,
        entry,
        asked: new Map(),
        settle: (result) => settle(result.behavior === 'allow'
          ? { behavior: 'allow', updatedInput: raw }
          : result),
      };
      inputNeededSet(entry);
      touch();
    });

  // ------------------------------------------------------------------ the run

  const handle = query({
    prompt: input(),
    options: {
      cwd,
      includePartialMessages: true,
      /*
       * Over the daemon's own environment, never instead of it.
       *
       * The SDK's `env` *replaces* the subprocess environment rather than
       * merging with it, so handing it a lone credential is a subprocess with
       * no `PATH` and no `HOME` - which fails as something that has nothing to
       * do with authentication. Absent when nobody pushed a token, and then
       * the subprocess simply inherits, which is how every session worked
       * before this and how an automation's still does.
       */
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
      // From the settings, which is where it lives: it is a config key like
      // the others, and a second way in was a second thing to keep in step.
      ...(settings.permissionMode ? { permissionMode: settings.permissionMode } : {}),
      // Resumed, not replayed: the agent picks up the context it built - the
      // files it read, the decisions it made - rather than being handed a
      // transcript of them and asked to infer the rest.
      ...(options.resume ? { resume: options.resume } : {}),
      // Set once, at creation, and that is why the schema marks it immutable:
      // the CLI takes `thinking` when the query is built and has nowhere to
      // put a later change, so offering it as a live control would be a
      // switch that flips back.
      ...(settings.thinking === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
      ...(settings.thinking === 'adaptive' ? { thinking: { type: 'adaptive' } } : {}),
      canUseTool,
    },
  } as Parameters<typeof query>[0]);

  /**
   * Start a turn, whoever asked for it.
   *
   * `queuedMessageId` names the waiting message this turn came from, and the
   * client's reducer takes it out of the queue on that word - which is what
   * makes the queue empty as its turns start rather than needing a second
   * action to say so.
   */
  const beginTurn = (turnId: string, text: string, model?: string, queuedMessageId?: string): void => {
    if (model && model !== chosen) {
      chosen = model;
      void handle.setModel(model === 'default' ? undefined : model).catch(() => {});
    }
    active = {
      id: turnId,
      startedAt: new Date().toISOString(),
      message: { text, origin: { kind: 'user' }, ...(chosen ? { model: { id: chosen } } : {}) },
      responseParts: [],
      usage: undefined,
    } satisfies WireTurn<ActiveTurn> as Bag;
    startedAt = Date.now();
    // Said back, including to the client that started it. A host that only
    // reduced this privately would go on to emit `chat/responsePart` for a
    // turn no client has - so the parts land nowhere and the conversation
    // appears only when somebody reopens it and gets a fresh snapshot.
    emit('chat', {
      type: 'chat/turnStarted',
      turnId: active.id,
      startedAt: active.startedAt,
      message: active.message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    if (title === 'New session' && text) retitle(text.slice(0, 60));
    doing('Thinking');
    waiting.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
    wake?.();
    wake = undefined;
    touch();
  };

  /**
   * The head of the queue, once there is nothing running.
   *
   * Called wherever a turn ends, which is the only place it can be: a queue
   * that waited for a client to notice would be a list, and every client
   * watching this chat would have to agree about which of them sends it.
   */
  const startNext = (): void => {
    if (active || closed)
      return;
    const next = queued.shift();
    if (!next)
      return;
    const message = bag(next.message);
    beginTurn(crypto.randomUUID(), str(message.text) ?? '', str(bag(message.model).id), str(next.id));
  };

  /**
   * Ask the CLI what it can do, without asking it to do anything.
   *
   * Fired as soon as the query exists. Best effort: a CLI that will not answer
   * yet leaves the lists empty, which is a real answer - the same one a host
   * gives for a harness nobody has signed into - rather than a session that
   * refuses to open.
   */
  /**
   * Re-read the MCP servers and say what changed.
   *
   * Asked of the CLI rather than assumed from what was just requested: a
   * server told to start can come back `ready`, still `authRequired`, or
   * `error`, and reporting the state that was *asked for* would show a green
   * row against a server nobody has signed into.
   */
  const refreshMcp = async (): Promise<void> => {
    const found = await handle.mcpServerStatus().then((r) => (Array.isArray(r) ? r : [])).catch(() => [] as unknown[]);
    for (const raw of found) {
      const server = bag(raw);
      const name = str(server.name);
      if (!name) continue;
      const id = `mcp:${name}`;
      const held = customizations.find((entry) => str(entry.id) === id);
      const fresh = bag(customizationsOf({}, [server], [])[0]);
      if (!held) {
        customizations.push(fresh);
        emit('session', { type: 'session/customizationUpdated', customization: fresh });
        continue;
      }
      const moved = JSON.stringify(held.state) !== JSON.stringify(fresh.state);
      const switched = held.enabled !== fresh.enabled;
      if (!moved && !switched)
        continue;
      held.state = fresh.state;
      held.enabled = fresh.enabled;
      // `mcpServerStateChanged` carries the state and nothing else, so a
      // server that came back on would arrive `ready` with the switch still
      // drawn off. The whole row when both moved, the narrow action when only
      // the state did.
      if (switched)
        emit('session', { type: 'session/customizationUpdated', customization: { ...held } });
      else
        emit('session', { type: 'session/mcpServerStateChanged', id, state: fresh.state });
    }
  };

  /*
   * Output styles this CLI has, learned at the handshake.
   *
   * Empty until then, which is why `setOutputStyle` does not refuse on an
   * empty list: not knowing the styles and knowing there are none are
   * different answers and only one of them is a reason to say no.
   */
  let styles: string[] = [];

  /** Which file each running edit tool is changing, by its call id. */
  const editing = new Map<string, string>();

  /** The server name behind an `mcp:` customization id, if it is one. */
  const serverNamed = (id: string): string | undefined =>
    (id.startsWith('mcp:') ? id.slice(4) : undefined);

  const describe = async (): Promise<void> => {
    const [init, mcp, skills] = await Promise.all([
      handle.initializationResult().then((r) => bag(r as unknown)).catch(() => ({} as Bag)),
      handle.mcpServerStatus().then((r) => (Array.isArray(r) ? r : [])).catch(() => [] as unknown[]),
      // The only way to know which commands are skills. It re-reads them from
      // disk, which at the start of a session is what one wants anyway.
      handle.reloadSkills().then((r) => list(bag(r as unknown).skills)).catch(() => [] as unknown[]),
    ]);
    offered = list(init.models)
      .map((raw) => {
        const model = bag(raw);
        // `value`, not `id`. Reading the wrong name costs every model there
        // is and leaves a picker that offers nothing.
        return { id: str(model.value) ?? '', name: str(model.displayName) ?? str(model.value) ?? '' };
      })
      .filter((model) => model.id !== '');
    styles = list(init.available_output_styles).filter((s): s is string => typeof s === 'string');
    /*
     * The style, settled both ways.
     *
     * A style chosen at creation is only a *setting* until the CLI is told,
     * and the CLI is not there to be told until now. One that was not chosen
     * is whatever the CLI already runs on, and reporting anything else would
     * draw a control sitting on a value that is not in force.
     */
    const asked = settings.outputStyle;
    const running = str(init.output_style);
    if (asked !== undefined && asked !== running) {
      await handle.applyFlagSettings({ outputStyle: asked }).catch(() => {});
    }
    else if (asked === undefined && running !== undefined) {
      settings.outputStyle = running;
    }
    customizations = customizationsOf(init, mcp, skills);
    if (customizations.length > 0) {
      emit('session', { type: 'session/customizationsChanged', customizations });
    }
    options.onHandshake?.();
  };
  void describe().catch(() => {});

  void (async () => {
    try {
      for await (const raw of handle) {
        const message = bag(raw as unknown);
        const type = str(message.type);
        // Every message carries it, so this needs no particular one to arrive.
        const said = str(message.session_id);
        if (said) agentId = said;

        // The message stream's own init. Capabilities come from the control
        // protocol instead (see `describe`), because those are needed before
        // a turn; what this adds is the model the turn actually ran on.
        if (type === 'system' && str(message.subtype) === 'init') { handshake = message; continue; }

        /*
         * The harness compacted its context.
         *
         * Deliberately *not* `chat/truncated`: that means "drop the turns
         * before this one", and every one of them is still in the transcript
         * and still readable. What was compacted is the model's context, not
         * the conversation, and a host that conflated the two would delete
         * from every client's screen a history it can still serve.
         *
         * Said as a notice in the running turn instead, because somebody
         * watching an answer change character halfway through deserves to
         * know why.
         */
        if (type === 'system' && str(message.subtype) === 'compact_boundary') {
          const turn = active;
          if (turn) {
            const about = bag(message.compact_metadata);
            const was = typeof about.pre_tokens === 'number' ? about.pre_tokens : undefined;
            const now = typeof about.post_tokens === 'number' ? about.post_tokens : undefined;
            const how = str(about.trigger) === 'manual' ? 'Context compacted' : 'Context compacted automatically';
            addPart(turn, {
              id: `${String(turn.id)}:compact:${String(turns.length)}`,
              kind: 'systemNotification',
              content: was !== undefined && now !== undefined
                ? `${how}: ${String(was)} tokens to ${String(now)}.`
                : `${how}.`,
            });
          }
          continue;
        }

        if (type === 'stream_event') { streamed(bag(message.event)); continue; }
        if (type === 'assistant') { assistant(bag(message.message)); continue; }
        if (type === 'user') { results(bag(message.message)); continue; }

        if (type === 'result') {
          const turn = active;
          /*
           * Read before the turn is pushed, because the reason goes inside it.
           * `is_error` carries the words; a subtype that is not `success` is a
           * turn that ended badly with none, and saying which is better than
           * an error part that says only that there was one.
           */
          const wrong = message.is_error === true
            ? (list(message.errors).map(String).join('\n') || 'The turn failed')
            : str(message.subtype) !== 'success'
              ? `The turn ended ${str(message.subtype) ?? 'without succeeding'}`
              : undefined;
          if (turn) {
            /*
             * Every turn that ends says how it ended.
             *
             * `Turn.state` is required and this only ever set it when
             * something went wrong, so a turn that simply worked went into
             * the history with no state at all. A client driven by actions
             * never saw it - its reducer fills the state in on
             * `chat/turnComplete` - but a client that subscribes afterwards
             * reads the snapshot, and the snapshot is this.
             */
            turn.state = str(message.subtype) !== 'success' ? 'error' : 'complete';
            turn.duration = typeof message.duration_ms === 'number' ? message.duration_ms : Date.now() - startedAt;
            // Before the turn completes, not after: the reducer hangs usage on
            // `activeTurn`, and `chat/turnComplete` is what moves that into
            // `turns` - so the other order reports it about nothing.
            const used = usageOf(message.usage);
            if (used) {
              turn.usage = used;
              emit('chat', { type: 'chat/usage', turnId: turn.id, usage: used });
            }
            if (wrong !== undefined) addFailure(turn, wrong);
            turns.push(turn);
            active = undefined;
            parts.clear();
            streaming = undefined;
            emit('chat', { type: 'chat/turnComplete', turnId: turn.id, duration: turn.duration });
          }
          if (message.is_error === true) {
            failed = wrong ?? 'The turn failed';
            emit('chat', { type: 'chat/error', message: failed });
          }
          doing(undefined);
          touch();
          startNext();
        }
      }
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
      const turn = active;
      if (turn) {
        turn.state = 'error';
        turn.duration = Date.now() - startedAt;
        addFailure(turn, failed);
        turns.push(turn);
        active = undefined;
        emit('chat', { type: 'chat/turnComplete', turnId: turn.id, duration: turn.duration });
      }
      emit('chat', { type: 'chat/error', message: failed });
      doing(undefined);
      touch();
    }
  })();

  return {
    uri,
    chatUri,
    status,

    models: () => offered,
    agentId: () => agentId,

    customizations: () => customizations,
    allTurns: () => turns,
    activity: () => activity,
    title: () => title,
    modifiedAt: () => modified,
    workingDirectories: () => [`file://${cwd}`],

    sessionState: () => ({
      resource: uri,
      provider: 'claude',
      title,
      status: status(),
      lifecycle: 'ready',
      defaultChat: chatUri,
      chats: [{ resource: chatUri, title }],
      workingDirectories: [`file://${cwd}`],
      customizations,
      // What it is doing, only while it is doing something. The protocol has
      // a session mirror its default chat's, which is where this is set.
      ...(activity !== undefined ? { activity } : {}),
      /*
       * The schema *and* what is in force.
       *
       * A client reads `config.schema.properties` to know which controls to
       * draw and `config.values` to know where each one sits - so a session
       * without this has no permission control, no model picker and no
       * effort control, which is what it had.
       */
      config: {
        schema: options.schema?.() ?? { properties: {} },
        values: { ...settings, ...(chosen ? { model: chosen } : {}) },
      },
      ...(chosen ?? str(bag(handshake).model)
        ? { model: (chosen ?? str(bag(handshake).model)) as string }
        : {}),
      // Set only while something is wanted. A key that is always present and
      // sometimes empty is a client that has to guess which it is.
      ...(pending ? { inputNeeded: [pending.entry] } : {}),
      ...(failed ? { error: failed } : {}),
    }),

    chatState: () => ({
      resource: chatUri,
      title,
      status: status(),
      modifiedAt: modified,
      // The newest page. A resumed session can be seeded with hundreds of
      // turns, and the snapshot is what a client waits on before it draws.
      ...tail(turns),
      ...(active ? { activeTurn: active } : {}),
      ...(activity !== undefined ? { activity } : {}),
      ...(draft !== '' ? { draft } : {}),
      queuedMessages: [...queued],
    }),

    /**
     * The client said the turn has begun, so reduce it and get to work.
     *
     * Write-ahead: the turn is real the moment the client says so, and the
     * host's job is to make it true rather than to decide whether it may.
     */
    /**
     * Validated, not forwarded.
     *
     * The CLI takes a fixed set, and a mode it does not know is a mistake
     * worth refusing here rather than a rejected promise nobody reads - and
     * `bypassPermissions` arriving as `bypass` is the kind of near-miss a
     * client makes.
     */
    setPermissionMode: (mode) => {
      const known = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk', 'auto'] as const;
      const found = known.find((value) => value === mode);
      if (!found) return false;
      settings.permissionMode = found;
      void handle.setPermissionMode(found).catch(() => {});
      return true;
    },

    /**
     * Effort, which is the thinking control that can actually be changed.
     *
     * `thinking` itself is fixed when the query is built; the level it runs at
     * is a flag setting the CLI takes at any time. Conflating the two would
     * offer one live control that is really two, and half of it would not work.
     */
    setEffort: (level) => {
      const known = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
      const found = known.find((value) => value === level);
      if (!found) return false;
      settings.effortLevel = found;
      void handle.applyFlagSettings({ effortLevel: found }).catch(() => {});
      return true;
    },

    /**
     * The voice it answers in.
     *
     * Validated against what the CLI said it has, once it has said so. Before
     * then the list is not known and refusing would refuse every style there
     * is, so an unvalidated one is taken and the CLI is left to disagree - the
     * only wrong answer here is a control that reports success and changes
     * nothing.
     */
    setOutputStyle: (name) => {
      if (styles.length > 0 && !styles.includes(name)) return false;
      settings.outputStyle = name;
      void handle.applyFlagSettings({ outputStyle: name }).catch(() => {});
      return true;
    },

    settings: () => ({ ...settings, ...(chosen ? { model: chosen } : {}) }),

    /**
     * Turn one on or off.
     *
     * Only MCP servers: the CLI has `toggleMcpServer` and nothing equivalent
     * for a skill, a prompt or a subagent. Those are refused rather than
     * accepted and dropped - a switch that reports success and changes
     * nothing is worse than one that says it cannot.
     */
    setCustomizationEnabled: async (id, enabled) => {
      const server = serverNamed(id);
      if (!server)
        return false;
      const held = customizations.find((entry) => str(entry.id) === id);
      const was = str(bag(held?.state).kind);
      try {
        if (!enabled) {
          await handle.toggleMcpServer(server, false);
        }
        /*
         * Switching on a server that is not ready is how somebody signs into
         * one.
         *
         * `toggleMcpServer` only lifts the disabled flag - a server that was
         * off *because* nobody had signed in comes straight back needing a
         * sign-in, which reads as a switch that flips itself off.
         * `reconnectMcpServer` is the one that makes the CLI run its own
         * sign-in.
         */
        else if (was === 'ready') {
          await handle.toggleMcpServer(server, true);
        }
        else {
          await handle.toggleMcpServer(server, true).catch(() => {});
          emit('session', { type: 'session/mcpServerStartRequested', id });
          await handle.reconnectMcpServer(server);
        }
      }
      catch {
        // What it actually is now, which after a failed sign-in is still the
        // CLI's own `needs-auth` rather than anything this host invented.
        await refreshMcp();
        return true;
      }
      await refreshMcp();
      return true;
    },

    /**
     * Start one, which is also how a server that needs signing into is signed
     * into.
     *
     * `reconnectMcpServer` makes the CLI run its own sign-in, on the machine
     * the CLI is on. AHP's `authenticate` is the other model - the client
     * fetches a token and pushes it - and the SDK has nowhere to put one, so
     * this host serves the gesture and not the token.
     */
    startMcpServer: async (id) => {
      const server = serverNamed(id);
      if (!server)
        return false;
      emit('session', { type: 'session/mcpServerStartRequested', id });
      try {
        await handle.reconnectMcpServer(server);
      }
      catch {
        await refreshMcp();
        return false;
      }
      await refreshMcp();
      return true;
    },

    stopMcpServer: async (id) => {
      const server = serverNamed(id);
      if (!server)
        return false;
      emit('session', { type: 'session/mcpServerStopRequested', id });
      try {
        await handle.toggleMcpServer(server, false);
      }
      catch {
        await refreshMcp();
        return false;
      }
      await refreshMcp();
      return true;
    },

    setModel: async (model) => {
      try {
        await handle.setModel(model === 'default' ? undefined : model);
        chosen = model;
        settings.model = model;
        return true;
      } catch { return false; }
    },

    /**
     * A model named on the turn takes effect and **stays** in effect.
     *
     * The SDK has no per-turn model, so honouring `message.model` means
     * `setModel` before the prompt - and setting it back afterwards would
     * race the next turn onto whichever call landed last. Leaving it is the
     * behaviour that can be explained; silently ignoring the field is the one
     * that cannot, because the transcript would then credit a turn to a model
     * that never ran it.
     */
    begin: (turnId, text, model) => beginTurn(turnId, text, model),

    /**
     * Wait, then be the next turn.
     *
     * Idle *now* means this is not a queue at all, and the protocol says the
     * host starts the head as soon as it can - so it is announced and then
     * immediately started, which is a queue entry a client sees appear and
     * leave rather than one that was never there.
     */
    queue: (id, text, model) => {
      const entry: Bag = { id, message: { text, origin: { kind: 'user' }, ...(model ? { model: { id: model } } : {}) } };
      const at = queued.findIndex((held) => str(held.id) === id);
      // The same id again edits what is waiting; a fresh one appends. That is
      // the client's spelling for "change my mind" and it costs nothing here.
      if (at >= 0) queued[at] = entry;
      else queued.push(entry);
      emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message: entry.message });
      touch();
      startNext();
    },

    setDraft: (text) => {
      if (text === draft)
        return;
      draft = text;
      // Not `touch()`: typing is not a change to the conversation, and a
      // catalogue that reordered itself on every keystroke would be unusable.
      emit('chat', { type: 'chat/draftChanged', draft: text });
    },

    unqueue: (id) => {
      const at = queued.findIndex((held) => str(held.id) === id);
      if (at < 0) return;
      queued.splice(at, 1);
      emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
      touch();
    },

    reorder: (order) => {
      const byId = new Map(queued.map((held) => [str(held.id) ?? '', held]));
      const moved: Bag[] = [];
      const seen = new Set<string>();
      for (const id of order) {
        const held = byId.get(id);
        if (!held || seen.has(id)) continue;
        seen.add(id);
        moved.push(held);
      }
      // Anything the order did not mention keeps its place behind what did,
      // rather than being dropped for not having been named.
      for (const held of queued) {
        if (!seen.has(str(held.id) ?? '')) moved.push(held);
      }
      queued.length = 0;
      queued.push(...moved);
      emit('chat', { type: 'chat/queuedMessagesReordered', order: moved.map((held) => str(held.id) ?? '') });
      touch();
    },

    cancel: (turnId) => {
      // A turn blocked on a person is stopped by answering no, not by leaving
      // a promise nobody will settle - the subprocess would sit there for ever.
      pending?.settle({ behavior: 'deny', message: 'The turn was stopped' });
      if (pending) { pending = undefined; inputNeededRemoved(); }
      void handle.interrupt().catch(() => {});
      const turn = active;
      if (turn) {
        turn.state = 'cancelled';
        turn.duration = Date.now() - startedAt;
        turns.push(turn);
        active = undefined;
        emit('chat', { type: 'chat/turnCancelled', turnId: turnId || turn.id, duration: turn.duration });
      }
      doing(undefined);
      touch();
      // Deliberately not `startNext`: somebody stopping a turn is stopping
      // this conversation, and starting the one behind it is the opposite of
      // what they asked for.
    },

    confirm: (toolCallId, approved) => {
      if (!pending || pending.entry.kind !== 'toolConfirmation') return;
      if (str(bag(pending.entry.toolCall).toolCallId) !== toolCallId) return;
      const settle = pending.settle;
      pending = undefined;
      inputNeededRemoved();
      const part = parts.get(toolCallId);
      if (part) bag(part.toolCall).status = approved ? 'running' : 'cancelled';
      doing(approved ? busyWith(str(bag(part?.toolCall).toolName) ?? 'tool', {}) : 'Thinking');
      // Said back, like every other action a client originates. Nothing in a
      // client applies its own dispatch, so a row approved here stayed
      // `pending-confirmation` on every screen watching it - including the
      // one that had just answered it.
      emit('chat', {
        type: 'chat/toolCallConfirmed',
        turnId: active?.id,
        toolCallId,
        approved,
        ...(approved ? { confirmed: 'user-action' } : {}),
      });
      settle(approved
        ? { behavior: 'allow', updatedInput: {} }
        : { behavior: 'deny', message: 'The person declined this action' });
      touch();
    },

    /**
     * Answer the question, in the shape the tool wants it back.
     *
     * Keyed by each question's own *text* and valued by the option's own
     * label - not by any id. Sending ids, or dropping `questions`, is a call
     * the tool cannot process and a turn that stalls rather than errors.
     */
    answer: (requestId, accepted, answers) => {
      if (!pending || pending.id !== requestId) return;
      const held = pending;
      pending = undefined;
      inputNeededRemoved();

      if (!accepted) {
        held.settle({ behavior: 'deny', message: 'The person declined to answer' });
        touch();
        return;
      }
      const said: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(answers)) {
        const question = held.asked.get(key);
        if (!question) continue;
        const answer = bag(value);
        // Freeform is the person's own words as the value, not the word they
        // typed it under - the tool reads the value as the answer itself.
        said[question] = answer.value ?? value;
      }
      held.settle({ behavior: 'allow', updatedInput: { questions: held.questions ?? [], answers: said } });
      touch();
    },

    close: () => {
      closed = true;
      wake?.();
      pending?.settle({ behavior: 'deny', message: 'The session was disposed' });
      handle.close();
    },
  };
}
