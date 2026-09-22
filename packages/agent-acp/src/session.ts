/**
 * One ACP session, seen through the AHP `Session` contract.
 *
 * The host owns the channels and the sequence numbers; this owns the state
 * they carry, one spawned ACP server behind a turn, and the translation of
 * that server's notifications into the `chat/*` actions a client already
 * knows. The update-to-action decisions themselves live in `mapping.ts`; this
 * file is the lifecycle around them, and the connection in `connection.ts`.
 *
 * Rules the protocol requires of anything emitting chat actions, kept here the
 * way the other backends keep them:
 *
 * - `chat/turnStarted` comes first, then a response part is opened, and only
 *   then may a delta stream into it.
 * - The running turn is `active` and is not in `turns`; it moves there when it
 *   completes.
 * - A turn carries both sides: `message.text` is what was said and
 *   `responseParts` is what the agent answered.
 *
 * A member this task cannot honestly support - a fork, a rewind, a live config
 * swap, a permission question - is left out or answered with the empty answer
 * the interface documents. Nothing throws over a capability this bridge does
 * not have yet.
 */

import type {
  AvailableCommand,
  SessionConfigOption,
  SessionModeState,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
import { Status } from '@ahpd/sdk';
import type { Bag, Chosen, MessageFrom, Session, Start } from '@ahpd/sdk';
import { watchSession } from './catalog.js';
import { connectAcp } from './connection.js';
import { mapUpdate } from './mapping.js';
import type { AcpConnection, AcpOptions, AcpTurn, WatchedSession, WatchedTurn } from './types.js';

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});

/** The title a session carries until somebody says something. */
const UNTITLED = 'ACP session';

/**
 * One conversation over one ACP server.
 *
 * `options` is the backend's identity and wiring; `start` is what this
 * particular session was told. The server is spawned lazily, on the first
 * turn, so a session somebody opened and never used costs no subprocess.
 */
export function acpSession(options: AcpOptions, start: Start): Session {
  const provider = options.provider ?? 'acp';
  const emit = start.emit;
  /*
   * The directory the server works in.
   *
   * The client's choice wins, then the package's, then the daemon's own: a
   * session resumed or continued in another directory is where the client said
   * it is, and a server that was pointed somewhere says so on `session/new`.
   */
  const where = start.workingDirectory ?? options.cwd ?? process.cwd();

  /** The config in force, by key. `session/configChanged` merges into this. */
  const settings: Record<string, unknown> = { ...start.settings };
  /** Finished turns. The running one is `active` and is deliberately not here. */
  const turns: Bag[] = [...(start.seed ?? [])];
  /** What the host offered until the server reports its own. */
  const seeds: Bag[] = [...(start.seedCustomizations ?? [])];
  /** The commands the server last advertised, as customizations. */
  let commands: Bag[] = [];
  /**
   * The modes the server named, once it has.
   *
   * ACP only names them on `session/new` and `session/load`, so a session that
   * has not opened yet cannot honestly report an enum for them; the agent's
   * own schema carries the property without one.
   */
  let modes: SessionModeState | undefined;
  /**
   * The session config options the server named, once it has.
   *
   * This is where a model choice lives in ACP: the option whose category is
   * `model`, with the values the server serves. The bridge does not invent one,
   * so a session that has not opened answers no models.
   */
  let offers: SessionConfigOption[] = [];
  let active: Bag | undefined;
  /** The running turn's mapping, so an update knows what it belongs to. */
  let mapping: AcpTurn | undefined;
  /** The connection this session spawned, once it has one. */
  let live: AcpConnection | undefined;
  /** The server's own id for this conversation, once `session/new` answered. */
  let acpSessionId: string | undefined;
  /** The one opening, shared by every caller, so one server is spawned. */
  let opening: Promise<{ connection: AcpConnection; sessionId: string }> | undefined;
  /** Whether a client asked to stop, read when the prompt settles. */
  let cancelRequested = false;
  let closed = false;
  /** Why the last turn failed, or nothing. Cleared when a turn starts. */
  let failed: string | undefined;
  /** What it is doing, or nothing while it is idle. */
  let activity: string | undefined;
  let title = UNTITLED;
  let modified = new Date().toISOString();
  /** Messages waiting for the running turn to end. The host's, not a client's. */
  const queued: Bag[] = [];
  /** What somebody is part-way through typing. */
  let draft: Bag | undefined;
  /** The catalogue's record of this session, once the server has named it. */
  let record: WatchedSession | undefined;
  /** The turn being watched, while one runs. Kept for the transcript. */
  let watchedTurn: WatchedTurn | undefined;

  const messageOf = (why: unknown): string => (why instanceof Error ? why.message : String(why));

  const touch = (): void => {
    modified = new Date().toISOString();
    if (record !== undefined) record.modifiedAt = modified;
  };

  /** Say what it is doing, on both channels, the way a session mirrors its chat. */
  const doing = (said: string | undefined): void => {
    if (activity === said) return;
    activity = said;
    emit('chat', { type: 'chat/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
    emit('session', { type: 'session/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
  };

  /** `SessionStatus`: 8 is in progress and 1 is idle. Nothing here waits on a person. */
  const status = (): number => (active !== undefined ? Status.InProgress
    : failed !== undefined ? Status.Error
      : Status.Idle);

  /** Remember the modes the server named, and where it currently sits. */
  const learnModes = (state: SessionModeState | null | undefined): void => {
    if (state === null || state === undefined) return;
    modes = { ...state };
    settings.permissionMode = state.currentModeId;
  };

  /** Remember the session config options the server named. */
  const learnOffers = (list: SessionConfigOption[] | null | undefined): void => {
    if (list === null || list === undefined) return;
    offers = [...list];
  };

  /** The option a model choice is set through, when the server named one. */
  const modelOption = (): (SessionConfigOption & { type: 'select' }) | undefined =>
    offers.find((one): one is SessionConfigOption & { type: 'select' } => one.type === 'select' && one.category === 'model');

  /** A select's values, flattening any groups into the flat list a picker draws. */
  const choicesOf = (option: SessionConfigOption & { type: 'select' }): { value: string; name: string }[] => {
    const choices: { value: string; name: string }[] = [];
    for (const entry of option.options) {
      if ('group' in entry) {
        for (const leaf of entry.options) choices.push({ value: leaf.value, name: leaf.name });
      }
      else choices.push({ value: entry.value, name: entry.name });
    }
    return choices;
  };

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
   * The schema this session reports, with the modes the server named.
   *
   * The agent's own schema carries `permissionMode` without an `enum`, because
   * no server has been asked yet. A session that has asked overrides it with
   * the server's own ids and names, which is the only place an enum can come
   * from.
   */
  const schemaOf = (): Bag => {
    const base = bag(start.schema());
    if (modes === undefined) return base;
    const properties = bag(base.properties);
    return {
      ...base,
      properties: {
        ...properties,
        permissionMode: {
          ...bag(properties.permissionMode),
          enum: modes.availableModes.map((mode) => mode.id),
          enumLabels: modes.availableModes.map((mode) => mode.name),
          default: modes.currentModeId,
        },
      },
    };
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
    if (closed) return;
    if (acpSessionId !== undefined && sessionId !== acpSessionId) return;

    if (update.sessionUpdate === 'current_mode_update') {
      if (modes !== undefined) modes = { ...modes, currentModeId: update.currentModeId };
      settings.permissionMode = update.currentModeId;
      touch();
      return;
    }
    if (update.sessionUpdate === 'config_option_update') {
      learnOffers(update.configOptions);
      touch();
      return;
    }
    if (update.sessionUpdate === 'available_commands_update') {
      commands = update.availableCommands.map(commandLeaf);
      emit('session', { type: 'session/customizationsChanged', customizations: [...seeds, ...commands] });
      return;
    }

    const current = mapping;
    if (current === undefined) return;
    // Kept before it is mapped, so a transcript rebuilt later sees the same
    // notifications the live client did, in the same order.
    watchedTurn?.updates.push(update);
    for (const action of mapUpdate(current, update)) emit('chat', action);
  };

  /**
   * Spawn the server, hand it a client, and open the one session on it.
   *
   * One promise for the whole of it, so a second turn that arrives while the
   * first is still shaking hands waits on the same server rather than spawning
   * another. A failure clears it, so the next turn tries again.
   *
   * A resume is a `session/load` rather than a `session/new`, and only a server
   * that advertised it can be asked: silently starting a new conversation
   * instead would be a resumed session that had lost everything it was resumed
   * for, with nothing on screen saying so.
   */
  const open = (): Promise<{ connection: AcpConnection; sessionId: string }> => {
    if (opening !== undefined) return opening;
    const pending = (async () => {
      const connection = connectAcp({
        command: options.command,
        ...(options.args === undefined ? {} : { args: options.args }),
        ...(options.env === undefined ? {} : { env: options.env }),
        cwd: where,
        handlers: { update: receivedUpdate },
      });
      live = connection;
      const handshake = await connection.initialize();
      const extra = start.additional !== undefined && start.additional.length > 0
        ? { additionalDirectories: start.additional }
        : {};
      if (start.resume !== undefined) {
        if (handshake.agentCapabilities?.loadSession !== true) {
          throw new Error(`${provider}: this ACP server cannot load a session, so "${start.resume}" cannot be resumed`);
        }
        const loaded = await connection.loadSession({
          sessionId: start.resume,
          cwd: where,
          // No MCP servers yet: task 03 is what offers the host's tools to the
          // server, and an empty list is the honest answer until then.
          mcpServers: [],
          ...extra,
        });
        acpSessionId = start.resume;
        learnModes(loaded.modes);
        learnOffers(loaded.configOptions);
      }
      else {
        const created = await connection.newSession({
          cwd: where,
          mcpServers: [],
          ...extra,
        });
        acpSessionId = created.sessionId;
        learnModes(created.modes);
        learnOffers(created.configOptions);
      }
      /*
       * The catalogue's record starts here, where the server has named the
       * session and what it said is known. The turn already running is attached
       * because `begin` opens it before the server does, and a transcript that
       * dropped the first turn would be a conversation missing its question.
       */
      record = watchSession({
        provider,
        id: acpSessionId,
        cwd: where,
        additional: start.additional ?? [],
        title,
      });
      if (watchedTurn !== undefined && !record.turns.includes(watchedTurn)) record.turns.push(watchedTurn);
      return { connection, sessionId: acpSessionId };
    })();
    opening = pending;
    return pending;
  };

  /** Open a turn on the wire, before the prompt is sent. */
  const openTurn = (
    turnId: string,
    text: string,
    from: MessageFrom | undefined,
    queuedMessageId: string | undefined,
  ): void => {
    /*
     * The markdown part is opened now rather than at the first delta: a client
     * that subscribes between two updates still sees the part the text is
     * arriving in, and `chat/delta` has somewhere to go.
     */
    const part: Bag = { id: `${turnId}:text`, kind: 'markdown', content: '' };
    active = {
      id: turnId,
      startedAt: new Date().toISOString(),
      message: {
        text,
        ...(from?.origin !== undefined ? { origin: from.origin } : {}),
        ...(from?._meta !== undefined ? { _meta: from._meta } : {}),
      },
      responseParts: [part],
    };
    mapping = {
      turnId,
      textPartId: String(part.id),
      parts: active.responseParts as Bag[],
      calls: new Map(),
    };
    watchedTurn = {
      turnId,
      startedAt: String(active.startedAt),
      message: {
        text,
        ...(from?.origin !== undefined ? { origin: from.origin } : {}),
      },
      state: 'complete',
      updates: [],
    };
    emit('chat', {
      type: 'chat/turnStarted',
      turnId,
      startedAt: active.startedAt,
      message: active.message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    emit('chat', { type: 'chat/responsePart', turnId, part });
    doing('Thinking');
  };

  /**
   * End the running turn, whoever ended it.
   *
   * The stop reason is the server's, not this bridge's: a prompt that came
   * back `cancelled` ends as a cancelled turn, and anything else the server
   * called a stop ends the turn complete. A connection that failed before a
   * stop reason arrived is an error, with the reason on the turn.
   */
  const finish = (turnId: string, ending: 'complete' | 'cancelled' | 'error', why?: string): void => {
    const turn = active;
    if (turn === undefined || String(turn.id) !== turnId) return;
    doing(undefined);
    const duration = Date.now() - Date.parse(String(turn.startedAt));
    if (ending === 'complete') emit('chat', { type: 'chat/turnComplete', turnId, duration });
    else if (ending === 'cancelled') emit('chat', { type: 'chat/turnCancelled', turnId, duration });
    else {
      const message = why === undefined || why === '' ? 'The ACP server did not answer' : why;
      failed = message;
      emit('chat', {
        type: 'chat/error',
        turnId,
        duration,
        part: { kind: 'error', error: { errorType: 'turnFailed', message } },
      });
    }
    turn.state = ending;
    turn.duration = duration;
    turns.push(turn);
    // The watched turn is sealed here, which is what makes a transcript a
    // record of turns rather than of one long stream of updates.
    if (watchedTurn !== undefined && watchedTurn.turnId === turnId) {
      watchedTurn.state = ending;
      watchedTurn.duration = Number.isFinite(duration) ? duration : 0;
      watchedTurn = undefined;
    }
    active = undefined;
    mapping = undefined;
    cancelRequested = false;
    touch();
    // Somebody stopping a turn is stopping this conversation; a queued message
    // behind it is the opposite of what they asked for.
    if (ending !== 'cancelled') startNext();
  };

  /**
   * Point the server at the model the turn asked for, before the prompt.
   *
   * ACP carries the model as a session config option, so the choice is one
   * `session/set_config_option` when the server's current value differs. A
   * failure here fails the turn rather than prompting with the wrong model: an
   * answer from a model nobody selected is worse than an error saying so.
   */
  const chooseModel = async (
    held: { connection: AcpConnection; sessionId: string },
    chosen: Chosen | undefined,
  ): Promise<void> => {
    if (chosen === undefined) return;
    const option = modelOption();
    // A choice the server cannot take is a turn that would run on the wrong
    // model, so it fails rather than prompts.
    if (option === undefined) {
      throw new Error(`${provider}: this ACP server names no model option, so "${chosen.id}" cannot be chosen`);
    }
    if (option.currentValue === chosen.id) return;
    const answer = await held.connection.setSessionConfigOption({
      sessionId: held.sessionId,
      configId: option.id,
      value: chosen.id,
    });
    learnOffers(answer.configOptions);
  };

  /**
   * One turn: the prompt is sent, and what comes back ends it.
   *
   * A cancel that arrived while the server was still being opened ends the
   * turn without a prompt at all, because there is nothing running to stop.
   */
  const run = async (turnId: string, text: string, chosen: Chosen | undefined): Promise<void> => {
    try {
      const held = await open();
      if (closed || active === undefined || String(active.id) !== turnId) return;
      if (cancelRequested) {
        finish(turnId, 'cancelled');
        return;
      }
      await chooseModel(held, chosen);
      const response = await held.connection.prompt(held.sessionId, text);
      finish(turnId, response.stopReason === 'cancelled' ? 'cancelled' : 'complete');
    }
    catch (why: unknown) {
      // The opening is cleared so the next turn spawns a server again rather
      // than awaiting a promise that will never resolve, and the connection is
      // closed so the failed attempt does not leave a subprocess behind.
      opening = undefined;
      const connection = live;
      live = undefined;
      connection?.close();
      finish(turnId, 'error', messageOf(why));
    }
  };

  /** Begin a turn, once the session is free. */
  const begin = (
    turnId: string,
    text: string,
    model: Chosen | undefined,
    from: MessageFrom | undefined,
    queuedMessageId?: string,
  ): void => {
    if (closed || active !== undefined) return;
    cancelRequested = false;
    failed = undefined;
    if (title === UNTITLED && text !== '') {
      title = text.slice(0, 60);
      if (record !== undefined) record.title = title;
      // Said, because a client that opened the session holds the old one.
      emit('session', { type: 'session/titleChanged', title });
    }
    openTurn(turnId, text, from, queuedMessageId);
    void run(turnId, text, model);
  };

  /** The head of the queue, once there is nothing running. */
  const startNext = (): void => {
    if (active !== undefined || closed) return;
    const next = queued.shift();
    if (next === undefined) return;
    const message = bag(next.message);
    begin(
      crypto.randomUUID(),
      String(message.text ?? ''),
      next.model as Chosen | undefined,
      next.from as MessageFrom | undefined,
      String(next.id),
    );
  };

  return {
    uri: start.uri,
    chatUri: start.chatUri,

    /**
     * The models this session can run a turn on.
     *
     * Read from the server's own model option, because only it knows what it
     * serves. Before the session has opened there is no honest answer but an
     * empty list: the agent's `probe` cannot know either, ACP advertising
     * models on `session/new` rather than on `initialize`.
     */
    models: () => {
      const option = modelOption();
      return option === undefined ? [] : choicesOf(option).map((choice) => ({ id: choice.value, name: choice.name }));
    },
    agentId: () => acpSessionId,
    customizations: () => [...seeds, ...commands],
    allTurns: () => turns,
    status,
    activity: () => activity,
    title: () => title,
    modifiedAt: () => modified,
    workingDirectories: () => [`file://${where}`],

    sessionState: () => ({
      resource: start.uri,
      provider,
      title,
      status: status(),
      lifecycle: 'ready',
      defaultChat: start.chatUri,
      chats: [{ resource: start.chatUri, title }],
      workingDirectories: [`file://${where}`],
      customizations: [...seeds, ...commands],
      ...(activity !== undefined ? { activity } : {}),
      // The schema *and* what is in force: a client reads
      // `config.schema.properties` for the controls and `config.values` for
      // where each one sits. The schema carries the server's modes once they
      // are known, so `permissionMode` has an enum exactly when it can have one.
      config: { schema: schemaOf(), values: { ...settings } },
    }),

    chatState: () => ({
      resource: start.chatUri,
      title,
      status: status(),
      modifiedAt: modified,
      turns,
      ...(active !== undefined ? { activeTurn: active } : {}),
      ...(activity !== undefined ? { activity } : {}),
      ...(draft !== undefined ? { draft } : {}),
      queuedMessages: queued.map((held) => ({ id: held.id, message: held.message })),
    }),

    begin: (turnId, text, model, from) => begin(turnId, text, model, from),

    /**
     * Stop the running turn.
     *
     * The ACP cancel notification is what a server stops on, and the `cancelled`
     * stop reason it answers the prompt with is what emits `chat/turnCancelled`
     * exactly once. This must not send one of its own, or a client sees two.
     */
    cancel: (turnId) => {
      const turn = active;
      if (turn === undefined || String(turn.id) !== turnId) return;
      cancelRequested = true;
      doing('Cancelling');
      const connection = live;
      if (connection !== undefined && acpSessionId !== undefined) {
        // Fire and forget: the prompt's own resolution is what ends the turn.
        void connection.cancel(acpSessionId).catch(() => {});
      }
    },

    queue: (id, text, model, from) => {
      const entry: Bag = {
        id,
        message: { text },
        ...(model !== undefined ? { model } : {}),
        ...(from !== undefined ? { from } : {}),
      };
      const at = queued.findIndex((held) => held.id === id);
      if (at >= 0) queued[at] = entry;
      else queued.push(entry);
      emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message: entry.message });
      touch();
      startNext();
    },

    unqueue: (id) => {
      const at = queued.findIndex((held) => held.id === id);
      if (at < 0) return;
      queued.splice(at, 1);
      emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
      touch();
    },

    reorder: (order) => {
      const byId = new Map(queued.map((held) => [String(held.id), held]));
      const seen = new Set<string>();
      const moved: Bag[] = [];
      for (const id of order) {
        const held = byId.get(id);
        if (held === undefined || seen.has(id)) continue;
        seen.add(id);
        moved.push(held);
      }
      // Anything the order did not name keeps its place behind what it did.
      for (const held of queued) if (!seen.has(String(held.id))) moved.push(held);
      queued.length = 0;
      queued.push(...moved);
      emit('chat', { type: 'chat/queuedMessagesReordered', order: moved.map((held) => String(held.id)) });
      touch();
    },

    // Held by the session, so two people on one chat see each other's.
    setDraft: (next) => {
      if (JSON.stringify(next) === JSON.stringify(draft)) return;
      draft = next;
      emit('chat', { type: 'chat/draftChanged', ...(next !== undefined ? { draft: next } : {}) });
    },

    /*
     * Nothing here is waiting on a person.
     *
     * `requestPermission` answers the server with `cancelled` rather than
     * putting a question to a client, so there is no tool call a decision
     * could belong to. Task 03 is what turns it into a form and gives these
     * two something to settle.
     */
    confirm: () => {},
    answer: () => {},

    /**
     * Take a config value, in the server's own terms.
     *
     * Two keys are this backend's: `permissionMode` is the server's mode, and
     * `model` is its model option. `model` is set here even though it is not a
     * schema property, because a model belongs to the turn rather than to the
     * conversation and a client may still send one. Anything else is refused
     * naming the key, because only this backend knows what it serves.
     */
    setConfig: async (key, value): Promise<true | string> => {
      if (key === 'permissionMode') {
        if (typeof value !== 'string') return `${provider}: permissionMode takes a string`;
        try {
          const held = await open();
          await held.connection.setSessionMode({ sessionId: held.sessionId, modeId: value });
          settings.permissionMode = value;
          if (modes !== undefined) modes = { ...modes, currentModeId: value };
          touch();
          return true;
        }
        catch (why: unknown) {
          return `${provider}: permissionMode was not set: ${messageOf(why)}`;
        }
      }
      if (key === 'model') {
        if (typeof value !== 'string') return `${provider}: model takes a string`;
        try {
          // Opened before the option is looked for: the server names its model
          // option on `session/new`, so a session that has not opened has not
          // been told what a model may be set to.
          const held = await open();
          const option = modelOption();
          if (option === undefined) {
            return `${provider}: this ACP server names no model option, so model cannot be set`;
          }
          const answer = await held.connection.setSessionConfigOption({
            sessionId: held.sessionId,
            configId: option.id,
            value,
          });
          learnOffers(answer.configOptions);
          settings.model = value;
          touch();
          return true;
        }
        catch (why: unknown) {
          return `${provider}: model was not set: ${messageOf(why)}`;
        }
      }
      return `${provider}: ${key} is not a config key this backend serves`;
    },

    // Nothing here has a runtime switch and there are no MCP servers, so all
    // three refuse. False is a real answer: a control that reported success
    // and changed nothing would be worse than one that says no.
    setCustomizationEnabled: async () => false,
    startMcpServer: async () => false,
    stopMcpServer: async () => false,

    settings: () => ({ ...settings }),

    close: () => {
      closed = true;
      const connection = live;
      live = undefined;
      connection?.close();
      // The catalogue's record is deliberately kept: the server still holds the
      // conversation and the transcript a row opens onto is this process's own
      // record of it. Only the live connection goes.
      // A turn still open has nobody left to answer it.
      if (active !== undefined) finish(String(active.id), 'cancelled');
    },
  };
}
