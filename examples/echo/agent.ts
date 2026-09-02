import type { Agent, Bag, Listed, Session, Start } from '../../src/index.js';

/**
 * A backend that answers by saying it back, and nothing else.
 *
 * There is no model here and no subprocess - which is the point: it is the
 * whole of `Agent` and `Session` with none of a real harness in the way, so
 * what is left is exactly what the host asks a backend for.
 *
 * Reading order:
 *
 * 1. `echo()` at the bottom is the `Agent`: what it is called, what it can be
 *    configured with, what sessions it already has, and how to start one.
 * 2. `converse()` is the `Session`: the state its two channels hold, and the
 *    actions it emits as things happen.
 *
 * Everything a real backend does differently is in `converse`. `echo` would
 * look much the same wrapping a language model, a shell, or a queue.
 */

/** What the schema offers, and what a turn does with it. */
type Voice = 'plain' | 'shouty' | 'backwards';

const speak = (voice: string, text: string): string => {
  if (voice === 'shouty') return text.toUpperCase();
  if (voice === 'backwards') return [...text].reverse().join('');
  return text;
};

/**
 * A session that has finished, kept so the catalogue has something in it.
 *
 * A real backend reads these from wherever its harness writes them. Holding
 * them in memory is what makes this example runnable with nothing installed,
 * and is also why restarting the host empties the list.
 */
interface Kept {
  id: string;
  title: string;
  createdAt: string;
  modifiedAt: string;
  turns: Bag[];
}

/** How to build the echo backend. */
export interface EchoOptions {
  /** The directory sessions report as their workspace. */
  path: string;
  /** Milliseconds between streamed words. `0` answers all at once. */
  pace?: number;
}

export function echo(options: EchoOptions): Agent {
  const dir = options.path;
  const pace = options.pace ?? 60;
  /** Everything this backend has ever finished, by its own id. */
  const kept = new Map<string, Kept>();

  const schema = (): Bag => ({
    properties: {
      voice: {
        type: 'string',
        title: 'Voice',
        description: 'What it does to what you said.',
        enum: ['plain', 'shouty', 'backwards'],
        enumLabels: ['Plain', 'Shouty', 'Backwards'],
        enumDescriptions: [
          'Says it back as it arrived',
          'SAYS IT BACK LIKE THIS',
          'kcab ti syaS',
        ],
        default: 'plain',
        // Changeable on a running session. A key left without this is one a
        // client will only offer before the session exists, which is the
        // right default for anything fixed when the session is built.
        sessionMutable: true,
      },
    },
  });

  const defaults = (): Record<string, string> => ({ voice: 'plain' });

  /**
   * One conversation.
   *
   * The host owns the channels and the sequence numbers; this owns the state
   * they carry and says what changed. `emit('chat', …)` goes to the chat
   * channel and `emit('session', …)` to the session channel - the host routes
   * them and no session needs to know either URI to do it.
   */
  function converse(start: Start): Session {
    const settings = { ...start.settings };
    /** Finished turns. The running one is `active` and is deliberately not here. */
    const turns: Bag[] = [...(start.seed ?? [])];
    let active: Bag | undefined;
    let title = 'Echo session';
    let modified = new Date().toISOString();
    let closed = false;
    /** What it is doing, or nothing while it is idle. */
    let activity: string | undefined;
    /** Messages waiting for the running turn to end. The host's, not a client's. */
    const queued: Bag[] = [];
    /** What somebody is part-way through typing. */
    let draft = '';
    /** The backend's own id, which is not the URI the client chose. */
    const id = start.resume ?? start.uri.replace(/^ahp-session:\//, '');

    // A resumed session opens on what it said before, so a title from the
    // seed is better than one invented now.
    // Where this session works. Named by the client or the backend's own,
    // and reported rather than assumed - the host does not know which.
    const where = start.workingDirectory ?? dir;

    const said = start.seed?.[0];
    if (said) title = String((said.message as Bag | undefined)?.text ?? title).slice(0, 60);

    const touch = (): void => { modified = new Date().toISOString(); };

    /**
     * Say what it is doing, on both channels.
     *
     * The chat is where the work happens; the protocol has a session mirror
     * its default chat's activity, and the session is the one a catalogue row
     * and a detail pane read.
     */
    const doing = (said: string | undefined): void => {
      if (activity === said) return;
      activity = said;
      start.emit('chat', { type: 'chat/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
      start.emit('session', { type: 'session/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
    };
    /** `SessionStatus`: 8 is in progress, 1 is idle. */
    const status = (): number => (active ? 8 : 1);

    const remember = (): void => {
      kept.set(id, { id, title, createdAt: modified, modifiedAt: modified, turns: [...turns] });
    };

    /**
     * Start a turn, whoever asked for it.
     *
     * `queuedMessageId` names the waiting message it came from; a client's
     * reducer takes it out of the queue on that word, which is what empties
     * the queue as its turns start.
     */
    const beginTurn = (turnId: string, text: string, queuedMessageId?: string): void => {
      if (title === 'Echo session' && text) {
        title = text.slice(0, 60);
        // Said, because a client that opened the session holds the old one.
        start.emit('session', { type: 'session/titleChanged', title });
      }
      const startedAt = new Date().toISOString();
      active = { id: turnId, startedAt, message: { text }, responseParts: [] };
      start.emit('chat', {
        type: 'chat/turnStarted',
        turnId,
        startedAt,
        message: { text },
        ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
      });
      doing('Echoing');

      const part: Bag = { id: `${turnId}:0`, kind: 'markdown', content: '' };
      (active.responseParts as Bag[]).push(part);
      start.emit('chat', { type: 'chat/responsePart', turnId, part });

      const words = speak(settings.voice ?? 'plain', text).split(/\s+/).filter((word) => word !== '');
      const began = Date.now();
      void (async () => {
        for (const word of words) {
          if (closed) return;
          if (pace > 0) await new Promise((wake) => { setTimeout(wake, pace); });
          const chunk = part.content === '' ? word : ` ${word}`;
          part.content = `${String(part.content)}${chunk}`;
          start.emit('chat', { type: 'chat/delta', turnId, partId: part.id, content: chunk });
        }
        if (closed || !active) return;
        const done = active;
        done.duration = Date.now() - began;
        turns.push(done);
        active = undefined;
        doing(undefined);
        touch();
        remember();
        start.emit('chat', { type: 'chat/turnComplete', turnId, duration: done.duration });
        startNext();
      })();
      touch();
    };

    /** The head of the queue, once there is nothing running. */
    const startNext = (): void => {
      if (active || closed) return;
      const next = queued.shift();
      if (!next) return;
      const message = (next.message ?? {}) as Bag;
      beginTurn(crypto.randomUUID(), String(message.text ?? ''), String(next.id));
    };

    return {
      uri: start.uri,
      chatUri: start.chatUri,

      // No models, no id of its own beyond the one above, and nothing handed
      // to it but what the host seeded. Empty lists are real answers.
      models: () => [],
      agentId: () => id,
      customizations: () => start.seedCustomizations ?? [],

      allTurns: () => turns,
      activity: () => activity,
      status,
      title: () => title,
      modifiedAt: () => modified,
      workingDirectories: () => [`file://${where}`],

      sessionState: () => ({
        resource: start.uri,
        provider: 'echo',
        title,
        status: status(),
        lifecycle: 'ready',
        defaultChat: start.chatUri,
        chats: [{ resource: start.chatUri, title }],
        workingDirectories: [`file://${where}`],
        customizations: start.seedCustomizations ?? [],
        ...(activity !== undefined ? { activity } : {}),
        // The schema *and* what is in force. A client reads
        // `config.schema.properties` to know which controls to draw and
        // `config.values` to know where each one sits.
        config: { schema: start.schema(), values: { ...settings } },
      }),

      chatState: () => ({
        resource: start.chatUri,
        title,
        status: status(),
        modifiedAt: modified,
        turns,
        ...(active ? { activeTurn: active } : {}),
        ...(activity !== undefined ? { activity } : {}),
        ...(draft !== '' ? { draft } : {}),
        queuedMessages: [...queued],
      }),

      /**
       * The client says a turn has begun; making it true is this method.
       *
       * Note the order every backend has to keep: the turn is said back first,
       * then a part is opened, and only then does text stream into it. A
       * `chat/delta` naming a part nobody opened appends to nothing, and a
       * part naming a turn no client has is dropped.
       */
      begin: (turnId, text) => beginTurn(turnId, text),

      /**
       * Wait, then be the next turn.
       *
       * Idle now means this is not a queue at all: it is announced and then
       * started at once, which a client sees as an entry that appears and
       * leaves rather than one that was never there.
       */
      queue: (id, text) => {
        const entry: Bag = { id, message: { text } };
        const at = queued.findIndex((held) => held.id === id);
        if (at >= 0) queued[at] = entry;
        else queued.push(entry);
        start.emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message: entry.message });
        touch();
        startNext();
      },

      // Held by the session, so two people on one chat see each other's.
      setDraft: (text) => {
        if (text === draft) return;
        draft = text;
        start.emit('chat', { type: 'chat/draftChanged', draft: text });
      },

      unqueue: (id) => {
        const at = queued.findIndex((held) => held.id === id);
        if (at < 0) return;
        queued.splice(at, 1);
        start.emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
        touch();
      },

      reorder: (order) => {
        const byId = new Map(queued.map((held) => [String(held.id), held]));
        const seen = new Set<string>();
        const moved: Bag[] = [];
        for (const id of order) {
          const held = byId.get(id);
          if (!held || seen.has(id)) continue;
          seen.add(id);
          moved.push(held);
        }
        // Anything the order did not name keeps its place behind what it did.
        for (const held of queued) if (!seen.has(String(held.id))) moved.push(held);
        queued.length = 0;
        queued.push(...moved);
        start.emit('chat', { type: 'chat/queuedMessagesReordered', order: moved.map((held) => String(held.id)) });
        touch();
      },

      cancel: (turnId) => {
        const turn = active;
        if (!turn) return;
        turn.state = 'cancelled';
        /*
         * `duration` is required, and required in earnest.
         *
         * A client's reducer clamps it with `Math.max(0, duration)` and then
         * adds it to the turn's start - so an absent one is `NaN` rather than
         * a missing number, and the reducer throws building a timestamp out of
         * it. Which stops that client reading the channel at all, over a turn
         * somebody merely cancelled.
         */
        turn.duration = Date.now() - Date.parse(String(turn.startedAt));
        turns.push(turn);
        active = undefined;
        doing(undefined);
        touch();
        remember();
        start.emit('chat', {
          type: 'chat/turnCancelled',
          turnId: turnId || String(turn.id),
          duration: turn.duration,
        });
      },

      // Nothing here ever asks, so there is never anything to answer. A
      // backend that does settles the promise it parked in `canUseTool` or
      // its equivalent - see `src/session.ts` for one that does.
      confirm: () => {},
      answer: () => {},

      // Nothing here has a runtime switch and there are no MCP servers, so
      // all three refuse. False is a real answer: a control that reported
      // success and changed nothing would be worse than one that says no.
      setCustomizationEnabled: async () => false,
      startMcpServer: async () => false,
      stopMcpServer: async () => false,

      // No models to choose between, and saying so is better than accepting a
      // choice and ignoring it.
      setModel: async () => false,
      setPermissionMode: () => false,
      setEffort: () => false,
      setOutputStyle: () => false,

      settings: () => ({ ...settings }),
      close: () => { closed = true; },
    };
  }

  return {
    provider: 'echo',
    displayName: 'Echo',
    description: `Says back what you said, from ${dir}`,
    schema,
    defaults,

    /**
     * What this backend offers before any session exists.
     *
     * A client asks for this to draw its composer - the models to pick from,
     * the commands behind a slash - so answering it late means offering them
     * only once the conversation has started. `customizations` is the flat
     * list a client shows in a panel; `commands` is what a slash completes.
     */
    probe: async () => ({
      models: [],
      commands: [{ name: 'shout', description: 'Say the rest of this line loudly' }],
      customizations: [{
        type: 'prompt',
        id: 'command:shout',
        name: 'shout',
        uri: 'shout',
        enabled: true,
        description: 'Say the rest of this line loudly',
      }],
    }),

    directories: () => [dir],

    /** Sessions somebody can browse. Ordering is the host's business. */
    list: async (): Promise<Listed[]> => [...kept.values()].map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      modifiedAt: session.modifiedAt,
      workingDirectories: [`file://${dir}`],
    })),

    /**
     * A past session's turns, read without starting anything.
     *
     * What makes a catalogue row openable. The host serves the row from here
     * and calls `create` with `resume` only when somebody actually says
     * something to it.
     */
    transcript: async (id) => kept.get(id)?.turns,

    create: converse,
  };
}
