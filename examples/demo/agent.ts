import { idOf } from '@ahpd/sdk';
import type { Agent, Bag, Session, Start } from '@ahpd/sdk';
import { notes } from '../notes/agent.js';
import type { NotesOptions } from '../notes/agent.js';

/**
 * The `notes` backend, with something on every screen a client draws.
 *
 * `examples/notes` teaches the session contract and stays small for that.
 * This one is for looking at: a client pointed at it finds models and
 * customizations to pick from, a turn that runs for a minute, and a turn that
 * fails, with no model behind any of it. ahpc draws its docs pictures from it.
 *
 * Every line is passed to the `notes` session as it is, except two:
 *
 * - `slow` streams one line a second for a minute, so a session is running.
 * - `fail` ends its turn with an error, so a session is in error.
 */

/** The models the pickers list. No turn runs on any of them. */
const MODELS = [
  { id: 'demo-fast', name: 'Demo Fast' },
  { id: 'demo-large', name: 'Demo Large', maxContextWindow: 200000 },
  { id: 'demo-small', name: 'Demo Small' },
];

/** The customizations a session reports, as top-level leaves. */
const CUSTOMIZATIONS: Bag[] = [
  {
    type: 'skill',
    id: 'skill:summarize',
    name: 'summarize',
    uri: 'demo://skill/summarize',
    enabled: true,
    description: 'Sums up a note in three lines',
  },
  {
    type: 'prompt',
    id: 'command:tidy',
    name: 'tidy',
    uri: 'demo://command/tidy',
    enabled: true,
    description: 'Sorts the notes by name',
  },
];

/** How many lines `slow` streams, one a second. */
const SLOW_LINES = 60;

/** How to build the demo backend: the `notes` options, and how fast `slow` goes. */
/**
 * The platform's `mode` key, as VS Code's agent host declares it.
 *
 * A real host offers it, so a client draws it on a new session here too. A
 * demo turn reads nothing from it.
 */
const MODE: Bag = {
  type: 'string',
  title: 'Agent Mode',
  description: 'How the agent should approach this turn',
  enum: ['interactive', 'plan', 'autopilot'],
  enumLabels: ['Interactive', 'Plan', 'Autopilot'],
  enumDescriptions: [
    'Step-by-step collaboration',
    'Plan first, execute when ready',
    'Works autonomously within permissions',
  ],
  default: 'interactive',
  sessionMutable: true,
};

/** The modes `MODE` offers. */
const MODES = ['interactive', 'plan', 'autopilot'];

export interface DemoOptions extends NotesOptions {
  /** Milliseconds between the lines `slow` streams. */
  every?: number;
}

export function demo(options: DemoOptions): Agent {
  const base = notes(options);
  const every = options.every ?? 1000;

  /** The `notes` session, with `slow` and `fail` in front of it. */
  const create = (start: Start): Session => {
    const inner = base.create(start);
    const id = start.resume ?? idOf(start.uri);
    /** The `slow` turn while it runs. */
    let own: Bag | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let activity: string | undefined;
    /** Whether the last turn ended in an error, which the status says until the next turn. */
    let failed = false;
    /** The session's mode. `notes` refuses a key it does not have, so the demo keeps this one. */
    let mode = typeof start.settings.mode === 'string' && MODES.includes(start.settings.mode) ? start.settings.mode : 'interactive';
    /** The title a first `slow` or `fail` gave the session, as `notes` titles one from its first message. */
    let named: string | undefined;
    const title = (): string => named ?? inner.title();

    const doing = (what: string | undefined): void => {
      if (activity === what) return;
      activity = what;
      start.emit('chat', { type: 'chat/activityChanged', ...(what !== undefined ? { activity: what } : {}) });
      start.emit('session', { type: 'session/activityChanged', ...(what !== undefined ? { activity: what } : {}) });
    };

    /** `SessionStatus`: 8 while `slow` runs, 2 after `fail`, and the `notes` session's otherwise. */
    const status = (): number => {
      if (own !== undefined) return 8;
      const held = inner.status();
      return failed && held === 1 ? 2 : held;
    };

    /** The finished turn, kept where the `notes` session keeps its own. */
    const keep = (turn: Bag): void => { inner.allTurns().push(turn); };

    const opened = (turnId: string, text: string): Bag => {
      if (named === undefined && inner.allTurns().length === 0 && text) {
        named = text.slice(0, 60);
        start.emit('session', { type: 'session/titleChanged', title: named });
      }
      const startedAt = new Date().toISOString();
      start.emit('chat', { type: 'chat/turnStarted', turnId, startedAt, message: { text } });
      return { id: turnId, startedAt, message: { text }, responseParts: [] };
    };

    const slow = (turnId: string, text: string): void => {
      const turn = opened(turnId, text);
      own = turn;
      doing('Counting slowly');
      const part: Bag = { id: `${turnId}:0`, kind: 'markdown', content: '' };
      (turn.responseParts as Bag[]).push(part);
      start.emit('chat', { type: 'chat/responsePart', turnId, part });
      let count = 0;
      timer = setInterval(() => {
        count += 1;
        const chunk = `${count === 1 ? '' : '\n\n'}Line ${String(count)} of ${String(SLOW_LINES)}.`;
        part.content = `${String(part.content)}${chunk}`;
        start.emit('chat', { type: 'chat/delta', turnId, partId: part.id, content: chunk });
        if (count < SLOW_LINES) return;
        clearInterval(timer);
        timer = undefined;
        own = undefined;
        turn.duration = Date.now() - Date.parse(String(turn.startedAt));
        keep(turn);
        doing(undefined);
        start.emit('chat', { type: 'chat/turnComplete', turnId, duration: turn.duration });
      }, every);
    };

    const fail = (turnId: string, text: string): void => {
      const turn = opened(turnId, text);
      const message = 'The demo turn failed, as `fail` asks.';
      const part: Bag = { kind: 'error', error: { errorType: 'turnFailed', message } };
      (turn.responseParts as Bag[]).push(part);
      turn.state = 'error';
      turn.duration = 0;
      keep(turn);
      failed = true;
      start.emit('chat', { type: 'chat/error', turnId, duration: 0, part });
    };

    const stop = (): void => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };

    return {
      ...inner,
      models: () => MODELS.map(({ id: model, name }) => ({ id: model, name })),
      agentId: () => id,
      activity: () => activity ?? inner.activity(),
      status,
      title,
      settings: () => ({ ...inner.settings(), mode }),
      setConfig: (key, value) => {
        if (key !== 'mode') return inner.setConfig?.(key, value) ?? `${key} is not a config key this backend takes`;
        if (typeof value !== 'string' || !MODES.includes(value)) return `mode is one of ${MODES.join(', ')} - not ${String(value)}`;
        mode = value;
        return true;
      },
      sessionState: () => ({
        ...inner.sessionState(),
        config: { ...(inner.sessionState().config as Bag | undefined), values: { ...inner.settings(), mode } },
        provider: 'demo',
        title: title(),
        chats: [{ resource: start.chatUri, title: title() }],
        status: status(),
        ...(activity !== undefined ? { activity } : {}),
      }),
      chatState: () => ({
        ...inner.chatState(),
        title: title(),
        status: status(),
        ...(own !== undefined ? { activeTurn: own } : {}),
        ...(activity !== undefined ? { activity } : {}),
      }),
      begin: (turnId, text) => {
        const word = text.trim().toLowerCase();
        // Only on a session with nothing running: a `slow` said behind
        // another turn is the `notes` session's to queue, and it says help.
        if (own === undefined && inner.status() === 1 && (word === 'slow' || word === 'fail')) {
          failed = false;
          if (word === 'slow') slow(turnId, text);
          else fail(turnId, text);
          return;
        }
        failed = false;
        inner.begin(turnId, text);
      },
      cancel: (turnId) => {
        if (own === undefined) {
          inner.cancel(turnId);
          return;
        }
        const turn = own;
        stop();
        own = undefined;
        turn.state = 'cancelled';
        turn.duration = Date.now() - Date.parse(String(turn.startedAt));
        keep(turn);
        doing(undefined);
        start.emit('chat', { type: 'chat/turnCancelled', turnId: turnId || String(turn.id), duration: turn.duration });
      },
      close: () => {
        stop();
        own = undefined;
        inner.close();
      },
    };
  };

  return {
    ...base,
    provider: 'demo',
    displayName: 'Agent Demo',
    schema: () => {
      const theirs = base.schema();
      return { ...theirs, properties: { mode: MODE, ...(theirs.properties as Bag) } };
    },
    defaults: () => ({ mode: 'interactive', ...base.defaults() }),
    description: `Notes in ${options.path}, with models, customizations, a slow turn and a failing one`,
    probe: async () => ({
      models: MODELS,
      commands: [
        { name: 'read', description: 'Read a note' },
        { name: 'write', description: 'Write a note' },
        { name: 'slow', description: 'Stream a line a second for a minute' },
        { name: 'fail', description: 'End the turn with an error' },
      ],
      customizations: CUSTOMIZATIONS,
    }),
    create,
  };
}
