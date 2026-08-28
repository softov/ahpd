import { query } from '@anthropic-ai/claude-agent-sdk';
import { Status } from './catalog.js';
import { tail } from './transcript.js';
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
export function customizationsOf(init: Bag, mcp: unknown[]): Bag[] {
  const out: Bag[] = [];

  for (const raw of list(init.commands)) {
    const command = bag(raw);
    const name = str(command.name);
    if (!name) continue;
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
    // The protocol's words, not the SDK's: the CLI says `connected` and
    // `failed`, a client reads `ready` and `error`.
    const kind = reported === 'connected' ? 'ready'
      : reported === 'failed' ? 'error'
        : reported === 'needs-auth' ? 'authRequired'
          : reported === 'disabled' ? 'stopped' : 'starting';
    out.push({
      type: 'mcpServer',
      id: `mcp:${name}`,
      name,
      uri: name,
      enabled: kind !== 'error' && kind !== 'stopped',
      state: {
        kind,
        ...(str(server.error) ? { message: str(server.error) as string } : {}),
      },
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
    active = { id: `turn-${Date.now()}`, startedAt: new Date().toISOString(), message: { text: '' }, responseParts: [] };
    startedAt = Date.now();
    emit('chat', {
      type: 'chat/turnStarted',
      turnId: active.id,
      startedAt: active.startedAt,
      message: { text: '' },
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
      emit('chat', { type: 'chat/delta', turnId: active?.id, partId: part.id, content: text });
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
      const text = resultText(block.content);
      if (text !== undefined) call.content = [{ text }];
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
   * Ask the CLI what it can do, without asking it to do anything.
   *
   * Fired as soon as the query exists. Best effort: a CLI that will not answer
   * yet leaves the lists empty, which is a real answer - the same one a host
   * gives for a harness nobody has signed into - rather than a session that
   * refuses to open.
   */
  const describe = async (): Promise<void> => {
    const [init, mcp] = await Promise.all([
      handle.initializationResult().then((r) => bag(r as unknown)).catch(() => ({} as Bag)),
      handle.mcpServerStatus().then((r) => (Array.isArray(r) ? r : [])).catch(() => [] as unknown[]),
    ]);
    offered = list(init.models)
      .map((raw) => {
        const model = bag(raw);
        // `value`, not `id`. Reading the wrong name costs every model there
        // is and leaves a picker that offers nothing.
        return { id: str(model.value) ?? '', name: str(model.displayName) ?? str(model.value) ?? '' };
      })
      .filter((model) => model.id !== '');
    customizations = customizationsOf(init, mcp);
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

        if (type === 'stream_event') { streamed(bag(message.event)); continue; }
        if (type === 'assistant') { assistant(bag(message.message)); continue; }
        if (type === 'user') { results(bag(message.message)); continue; }

        if (type === 'result') {
          const turn = active;
          if (turn) {
            if (str(message.subtype) !== 'success') turn.state = 'error';
            turn.duration = typeof message.duration_ms === 'number' ? message.duration_ms : Date.now() - startedAt;
            turns.push(turn);
            active = undefined;
            parts.clear();
            streaming = undefined;
            emit('chat', { type: 'chat/turnComplete', turnId: turn.id, duration: turn.duration });
          }
          if (message.is_error === true) {
            failed = list(message.errors).map(String).join('\n') || 'The turn failed';
            emit('chat', { type: 'chat/error', message: failed });
          }
          touch();
        }
      }
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
      const turn = active;
      if (turn) {
        turn.state = 'error';
        turn.duration = Date.now() - startedAt;
        turns.push(turn);
        active = undefined;
        emit('chat', { type: 'chat/turnComplete', turnId: turn.id, duration: turn.duration });
      }
      emit('chat', { type: 'chat/error', message: failed });
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
    title: () => title,
    modifiedAt: () => modified,

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
      queuedMessages: [],
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

    settings: () => ({ ...settings, ...(chosen ? { model: chosen } : {}) }),

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
    begin: (turnId, text, model) => {
      if (model && model !== chosen) {
        chosen = model;
        void handle.setModel(model === 'default' ? undefined : model).catch(() => {});
      }
      active = {
        id: turnId,
        startedAt: new Date().toISOString(),
        message: { text, ...(chosen ? { model: { id: chosen } } : {}) },
        responseParts: [],
      };
      startedAt = Date.now();
      if (title === 'New session' && text) title = text.slice(0, 60);
      // Said back, including to the client that started it. A host that only
      // reduced this privately would go on to emit `chat/responsePart` for a
      // turn no client has - so the parts land nowhere and the conversation
      // appears only when somebody reopens it and gets a fresh snapshot.
      emit('chat', {
        type: 'chat/turnStarted',
        turnId: active.id,
        startedAt: active.startedAt,
        message: active.message,
      });
      waiting.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
      wake?.();
      wake = undefined;
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
      touch();
    },

    confirm: (toolCallId, approved) => {
      if (!pending || pending.entry.kind !== 'toolConfirmation') return;
      if (str(bag(pending.entry.toolCall).toolCallId) !== toolCallId) return;
      const settle = pending.settle;
      pending = undefined;
      inputNeededRemoved();
      const part = parts.get(toolCallId);
      if (part) bag(part.toolCall).status = approved ? 'running' : 'cancelled';
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
