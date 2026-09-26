/**
 * One pi conversation, seen through the AHP `Session` contract.
 *
 * The host owns the channels and the sequence numbers; this owns the state
 * they carry, one embedded `AgentSession` behind a turn, and the lifecycle
 * around the translation in `mapping.ts`.
 *
 * What pi gives this bridge for free, and what it does not:
 *
 * - **Steering** is pi's own `steer()`, so a message mid-turn is the thing it
 *   says it is rather than a queued message pretending.
 * - **Truncation** is `navigateTree`: pi's sessions are append-only trees, the
 *   leaf moves, and the abandoned path stops being context. That is exactly
 *   what `chat/truncated` asks for, so `rewindAt` is honest here.
 * - **Confirmation** is not. pi has no built-in permission policy: a tool runs
 *   when the model calls it. So `confirm` has nothing to answer and no tool
 *   call is ever reported `pending-confirmation`.
 * - **A fork** is not, yet. pi can branch from an entry, but naming the entry a
 *   *turn* began at means recording it as the turn runs, and this bridge does
 *   not - so `forkPoint` is left out and the host advertises no fork rather
 *   than offering a control that fails.
 */

import { Status } from '@ahpd/sdk';
import type { Bag, Chosen, MessageFrom, Ran, Session, Start } from '@ahpd/sdk';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { openPi } from './backend.js';
import type { BackendOptions, PiBackend } from './backend.js';
import { watch } from './catalog.js';
import { activityOf, mapEvent } from './mapping.js';
import { idOf, offered } from './models.js';
import type { PiOptions, PiTurn, WatchedSession, WatchedTurn } from './types.js';

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});

/**
 * How pi is opened, so a session can be driven without a model provider.
 *
 * Not an option a person sets: it is a parameter with a default, and the
 * default is the real thing. A test hands a backend of its own and gets the
 * whole turn lifecycle without credentials, a network or a session file.
 */
export type OpenPi = (options: BackendOptions) => Promise<PiBackend>;

/** The title a conversation carries until something better is known. */
const UNTITLED = 'pi session';

/** The first line of what was said, as a title for a session nobody named. */
const titleFrom = (text: string): string => {
  const line = text.split('\n').map((one) => one.trim()).find((one) => one !== '') ?? '';
  return line === '' ? UNTITLED : line.slice(0, 80);
};

/**
 * One conversation over one embedded pi.
 *
 * pi is opened lazily, on the first turn, so a session somebody made and never
 * used costs no model runtime and reads no project resources.
 */
export function piSession(options: PiOptions, start: Start, open: OpenPi = openPi): Session {
  const provider = options.provider ?? 'pi';
  const emit = start.emit;
  const where = start.workingDirectory ?? process.cwd();

  const settings: Record<string, unknown> = { ...start.settings };
  /** Finished turns. The running one is `active` and is deliberately not here. */
  const turns: Bag[] = [...(start.seed ?? [])];
  const seeds: Bag[] = [...(start.seedCustomizations ?? [])];
  let active: Bag | undefined;
  /** The running turn's mapping, so an event knows what it belongs to. */
  let mapping: PiTurn | undefined;
  let live: PiBackend | undefined;
  /** The one opening, shared by every caller, so one pi is built. */
  let opening: Promise<PiBackend> | undefined;
  let unsubscribe: (() => void) | undefined;
  let closed = false;
  let cancelled = false;
  let activity: string | undefined;
  let title = UNTITLED;
  let modified = new Date().toISOString();
  /** What a turn failed with, or nothing. Cleared when a turn starts. */
  let failed: string | undefined;
  /** Messages waiting for the running turn to end. The host's, not a client's. */
  const queued: Bag[] = [];
  let draft: Bag | undefined;
  /** The models pi reported, once it has been asked. */
  let models: { id: string; name: string }[] = [];
  /**
   * The turns this process watched, kept by reference.
   *
   * The array exists before the record does, because the first turn starts
   * before pi has opened: `begin` returns as soon as the turn is announced and
   * pi is built inside it. A record created later and given a fresh array
   * would be a session whose first turn is missing from its own transcript.
   */
  const watchedTurns: WatchedTurn[] = [];
  /** The catalogue's record, so a transcript can be read back after the turn. */
  let record: WatchedSession | undefined;
  let watched: WatchedTurn | undefined;

  const touch = (): void => { modified = new Date().toISOString(); };

  const doing = (said: string | undefined): void => {
    if (activity === said) return;
    activity = said;
    emit('chat', { type: 'chat/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
    emit('session', { type: 'session/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
  };

  /*
   * One state, not a set of bits.
   *
   * A running turn is what the session is doing, whatever it failed with
   * last; `InputNeeded` is never reached, because pi asks nobody anything.
   */
  const status = (): number => (active !== undefined ? Status.InProgress
    : failed !== undefined ? Status.Error
      : Status.Idle);

  const schemaOf = (): Bag => ({
    type: 'object',
    properties: {
      projectTrust: {
        scope: 'session',
        type: 'string',
        title: 'Project resources',
        description: "Whether this project's own pi extensions, skills and prompts are loaded.",
        enum: ['trust', 'deny'],
        // Not while it runs: the resources are read when pi opens, and a value
        // taken after that would say something the session is not doing.
        sessionMutable: false,
      },
    },
  });

  /** Seal the turn being watched, which is what makes a transcript turns. */
  const seal = (state: WatchedTurn['state'], duration: number): void => {
    if (watched === undefined) return;
    watched.state = state;
    watched.duration = Number.isFinite(duration) ? duration : 0;
    watched = undefined;
  };

  /**
   * End the running turn, whoever ended it.
   *
   * pi says a run is over twice - `agent_end` and then `agent_settled` - and
   * only the second means nothing more is coming, so the turn is closed on
   * the settle and this is called once.
   */
  const finish = (ending: 'complete' | 'cancelled' | 'error', why?: string): void => {
    const turn = active;
    if (turn === undefined) return;
    const turnId = String(turn.id);
    doing(undefined);
    const duration = Date.now() - Date.parse(String(turn.startedAt));
    if (ending === 'complete') emit('chat', { type: 'chat/turnComplete', turnId, duration });
    else if (ending === 'cancelled') emit('chat', { type: 'chat/turnCancelled', turnId, duration });
    else {
      const message = why === undefined || why === '' ? 'pi did not answer' : why;
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
    seal(ending, duration);
    active = undefined;
    mapping = undefined;
    cancelled = false;
    touch();
    emit('session', { type: 'session/statusChanged', status: status() });
    startNext();
  };

  /** Everything pi says while a turn runs, turned into what a client reads. */
  const heard = (event: AgentSessionEvent): void => {
    const said = activityOf(event);
    if (said !== false) doing(said);

    if (mapping !== undefined) {
      for (const action of mapEvent(mapping, event)) emit('chat', action);
    }

    switch (event.type) {
      /*
       * pi's own name for the conversation, which a person may have set from
       * its terminal. It is the session's title here, and the host decides
       * whether that goes out as the session's or a peer chat's.
       */
      case 'session_info_changed': {
        const named = event.name;
        if (named === undefined || named === '' || named === title) return;
        title = named;
        if (record !== undefined) record.title = named;
        emit('session', { type: 'session/titleChanged', title });
        touch();
        return;
      }

      /*
       * The level moved, which is a value in force rather than a turn part:
       * pi can change it itself, and a client that drew the form should see
       * where it actually sits.
       */
      case 'thinking_level_changed': {
        settings.thinkingLevel = event.level;
        emit('session', { type: 'session/configChanged', values: { ...settings } });
        return;
      }

      /*
       * A run that pi will retry itself is not a turn that ended. `willRetry`
       * is exactly that case, and closing the turn on it would draw a finished
       * answer that is about to be replaced.
       */
      case 'agent_end': {
        if (event.willRetry) doing('Retrying');
        return;
      }

      /** Nothing more is coming. This is where a turn actually ends. */
      case 'agent_settled': {
        finish(cancelled ? 'cancelled' : 'complete');
        return;
      }

      default:
        return;
    }
  };

  /** Open pi, once, however many callers arrive at the same moment. */
  const opened = async (): Promise<PiBackend> => {
    if (opening === undefined) {
      opening = (async () => {
        const trust = settings.projectTrust ?? options.projectTrust ?? 'trust';
        const backend = await open({
          cwd: where,
          ...(start.resume !== undefined ? { resume: start.resume } : {}),
          ...(options.sessionDir !== undefined ? { sessionDir: options.sessionDir } : {}),
          trustProject: trust !== 'deny',
        });
        live = backend;
        unsubscribe = backend.subscribe(heard);
        record = watch(provider, {
          id: backend.id,
          title,
          createdAt: modified,
          modifiedAt: modified,
          directory: where,
          turns: watchedTurns,
        });
        // The model list is a client's to draw and pi only knows it once its
        // runtime exists, so it is read here and announced rather than waited
        // for on a screen that has already drawn an empty picker.
        const available = await backend.models();
        models = available.map((model) => ({ id: idOf(model), name: model.name ?? model.id }));
        emit('session', {
          type: 'session/modelsChanged',
          models: available.map((model) => offered(model, backend.levels(model))),
        });
        // `rewindAt` is the host asking for a truncation on a resumed session.
        if (start.rewindAt !== undefined) await backend.rewind(start.rewindAt);
        return backend;
      })();
    }
    return opening;
  };

  /** Start a turn, once there is nothing else running. */
  const begin = (turnId: string, text: string, model?: Chosen, from?: MessageFrom, queuedMessageId?: string): void => {
    failed = undefined;
    cancelled = false;
    const startedAt = new Date().toISOString();
    const message: Bag = {
      text,
      ...(from?.origin !== undefined ? { origin: from.origin } : { origin: { kind: 'user' } }),
      ...(from?._meta !== undefined ? { _meta: from._meta } : {}),
    };
    const part: Bag = { id: `${turnId}:text`, kind: 'markdown', content: '' };
    active = {
      id: turnId,
      startedAt,
      message,
      responseParts: [part],
      state: 'running',
    };
    mapping = { turnId, textPartId: String(part.id), parts: active.responseParts as Bag[], calls: new Map() };
    watched = { turnId, startedAt, message, parts: active.responseParts as Bag[], state: 'complete' };
    watchedTurns.push(watched);

    if (title === UNTITLED) {
      title = titleFrom(text);
      if (record !== undefined) record.title = title;
      emit('session', { type: 'session/titleChanged', title });
    }

    emit('chat', {
      type: 'chat/turnStarted',
      turnId,
      startedAt,
      message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    emit('chat', { type: 'chat/responsePart', turnId, part });
    emit('session', { type: 'session/statusChanged', status: status() });
    doing('Thinking');
    touch();

    void (async () => {
      try {
        const backend = await opened();
        if (model !== undefined) await backend.choose(model.id, model.config);
        await backend.prompt(text);
        /*
         * `prompt` settling is not the turn ending: pi raises `agent_settled`
         * for that, and the two are not the same moment when it retries. So
         * nothing is closed here, and a turn that settled already has been.
         */
      }
      catch (error) {
        finish('error', error instanceof Error ? error.message : String(error));
      }
    })();
  };

  /** Whatever was waiting, once the turn in front of it is done. */
  const startNext = (): void => {
    if (closed || active !== undefined) return;
    const next = queued.shift();
    if (next === undefined) return;
    const id = String(next.id);
    emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
    const command = bag(next.command);
    if (typeof command.text === 'string') {
      // A `!command` that waited. What waited is the command, not its text, so
      // it is run rather than asked about.
      runCommand(id, String(command.text), command.run as (toolCallId: string) => Promise<Ran>);
      return;
    }
    begin(id, String(bag(next.message).text ?? ''), next.model as Chosen | undefined, undefined, id);
  };

  /**
   * A person's `!command`, run by the host in one of its own shells.
   *
   * pi has a shell of its own, but this turn is not pi's: the person asked the
   * host to run something, and the host owns the terminal a client watches.
   */
  const runCommand = (turnId: string, command: string, run: (toolCallId: string) => Promise<Ran>): void => {
    const startedAt = new Date().toISOString();
    const toolCallId = `${turnId}:shell`;
    const message: Bag = { text: `!${command}`, origin: { kind: 'user' } };
    const part: Bag = {
      id: toolCallId,
      kind: 'toolCall',
      toolCall: { toolCallId, toolName: 'shell', displayName: command, status: 'running' },
    };
    active = { id: turnId, startedAt, message, responseParts: [part], state: 'running' };
    mapping = undefined;
    emit('chat', { type: 'chat/turnStarted', turnId, startedAt, message });
    emit('chat', {
      type: 'chat/toolCallStart', turnId, toolCallId, toolName: 'shell', displayName: command,
    });
    emit('chat', {
      type: 'chat/toolCallReady',
      turnId,
      toolCallId,
      invocationMessage: command,
      confirmed: 'not-needed',
      toolInput: JSON.stringify({ command }),
    });
    doing(`Running ${command}`);

    void run(toolCallId).then((ran) => {
      const held = bag(part.toolCall);
      held.status = 'completed';
      held.success = ran.success;
      held.pastTenseMessage = ran.said;
      emit('chat', {
        type: 'chat/toolCallComplete',
        turnId,
        toolCallId,
        result: {
          success: ran.success,
          pastTenseMessage: ran.said,
          ...(ran.output === '' ? {} : { content: [{ type: 'text', text: ran.output }] }),
          ...(ran.success
            ? {}
            : { error: { message: ran.code === undefined ? ran.said : `Exited ${ran.code}` } }),
        },
      });
      finish('complete');
    }).catch((error: unknown) => {
      finish('error', error instanceof Error ? error.message : String(error));
    });
  };

  return {
    uri: start.uri,
    chatUri: start.chatUri,

    models: () => models,
    agentId: () => live?.id,
    customizations: () => [...seeds],
    allTurns: () => turns,

    status,
    activity: () => activity,
    title: () => title,
    setTitle: (next) => {
      title = next;
      if (record !== undefined) record.title = next;
      // pi keeps a name of its own, so the title survives outside this host -
      // a session renamed here is renamed in `pi` too.
      live?.rename(next);
      touch();
    },
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
      customizations: [...seeds],
      ...(activity !== undefined ? { activity } : {}),
      /*
       * The host's schema when it gave one, which is the same one every other
       * backend publishes.
       *
       * This used to be `schemaOf()` alone, so a key a plugin contributed -
       * the computer a session runs in - never reached a pi session and the
       * window drew no control for it. `start.schema()` is the host's
       * `sessionSchema`, which already carries `projectTrust` from `agent.ts`
       * and a contributed key beside it; `schemaOf()` is the fallback for a
       * session started without one.
       */
      config: { schema: start.schema?.() ?? schemaOf(), values: { ...settings } },
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

    begin: (turnId, text, model, from) => {
      if (active !== undefined) {
        const message: Bag = { text, origin: from?.origin ?? { kind: 'user' } };
        queued.push({ id: turnId, message, ...(model !== undefined ? { model } : {}) });
        emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id: turnId, message });
        touch();
        return;
      }
      begin(turnId, text, model, from);
    },

    ran: (turnId, command, run) => {
      if (active !== undefined) {
        const message: Bag = { text: `!${command}`, origin: { kind: 'user' } };
        queued.push({ id: turnId, command: { text: command, run }, message });
        emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id: turnId, message });
        touch();
        return;
      }
      runCommand(turnId, command, run);
    },

    /**
     * A message into the turn that is already running.
     *
     * pi's own `steer`, so this is the thing the protocol means rather than a
     * queued message dressed as one. False when there is nothing to steer,
     * which the host turns into a refusal rather than an ordinary message.
     */
    steer: (id, text) => {
      void id;
      if (active === undefined || live === undefined) return false;
      void live.steer(text).catch((error: unknown) => {
        emit('chat', {
          type: 'chat/error',
          turnId: String(bag(active).id ?? ''),
          part: {
            kind: 'error',
            error: { errorType: 'turnFailed', message: error instanceof Error ? error.message : String(error) },
          },
        });
      });
      touch();
      return true;
    },

    cancel: (turnId) => {
      if (active === undefined || String(bag(active).id) !== turnId) return;
      cancelled = true;
      doing('Stopping');
      // The turn is closed on pi's settle rather than here, so what it had
      // already said stays in the transcript.
      void live?.abort().catch(() => { finish('cancelled'); });
    },

    queue: (id, text, model, from) => {
      const message: Bag = { text, origin: from?.origin ?? { kind: 'user' } };
      const at = queued.findIndex((held) => String(held.id) === id);
      const entry: Bag = { id, message, ...(model !== undefined ? { model } : {}) };
      if (at >= 0) queued[at] = entry; else queued.push(entry);
      emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message });
      touch();
    },

    unqueue: (id) => {
      const at = queued.findIndex((held) => String(held.id) === id);
      if (at < 0) return;
      queued.splice(at, 1);
      emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
      touch();
    },

    setDraft: (next) => {
      draft = next;
      emit('chat', { type: 'chat/draftChanged', ...(next !== undefined ? { draft: next } : {}) });
    },

    reorder: (order) => {
      const moved: Bag[] = [];
      for (const id of order) {
        const at = queued.findIndex((held) => String(held.id) === id);
        if (at >= 0) moved.push(...queued.splice(at, 1));
      }
      queued.unshift(...moved);
      emit('chat', { type: 'chat/queuedMessagesReordered', order: queued.map((held) => String(held.id)) });
    },

    /*
     * Nothing to answer. pi has no built-in permission policy - a tool runs
     * when the model calls it - so no call of this backend's is ever reported
     * waiting on a person, and nothing here is ever the answer to one.
     */
    confirm: () => {},
    answer: () => {},

    setConfig: async (key, value) => {
      if (key !== 'projectTrust') return `pi sessions have no "${key}" setting`;
      if (value !== 'trust' && value !== 'deny') return 'projectTrust is "trust" or "deny"';
      settings[key] = value;
      return true;
    },
    settings: () => ({ ...settings }),

    /*
     * pi's extensions and skills are loaded when it opens and have no runtime
     * switch, and its MCP servers are an extension's business rather than
     * pi's. False and false are the real answers, and a control that reported
     * success and changed nothing would be worse.
     */
    setCustomizationEnabled: async () => false,
    startMcpServer: async () => false,
    stopMcpServer: async () => false,

    close: () => {
      closed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      live?.close();
      live = undefined;
      opening = undefined;
    },
  };
}
