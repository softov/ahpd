/**
 * One facio session, seen through the AHP `Session` contract.
 *
 * The host owns the channels and the sequence numbers; this owns the state
 * they carry, the facio `run()` behind a turn, and the translation of that
 * run's events into the `chat/*` actions a client already knows. The
 * event-to-action decisions themselves live in `mapping.ts` and the host tool
 * wrapping in `tools.ts`; this file is the lifecycle around them.
 *
 * Rules the protocol requires of anything emitting chat actions, kept here
 * the way the other backends keep them:
 *
 * - `chat/turnStarted` comes first, then a response part is opened, and only
 *   then may a delta stream into it.
 * - The running turn is `activeTurn` and is not in `turns`; it moves there
 *   when it completes.
 * - A turn carries both sides: `message.text` is what was said and
 *   `responseParts` is what the agent answered.
 */

import { createAgent, run } from '@facio/agents';
import type { Agent as FacioAgent, RunEvent, RunHandle } from '@facio/agents';
import { Status } from '@ahpd/sdk';
import type { Bag, Chosen, MessageFrom, Session, Start } from '@ahpd/sdk';
import { modelOf, storeOf } from './agent.js';
import type { FacioOptions } from './agent.js';
import { mapTurn } from './mapping.js';
import type { TurnMapping } from './mapping.js';
import { facioTools } from './tools.js';

/**
 * The facio agent id.
 *
 * A constant rather than the AHP provider: facio requires an id matching its
 * own pattern, and the provider is a registration name a host is free to
 * spell with characters facio would refuse. One backend serves one store, so
 * two sessions of it are two conversations rather than two agents.
 */
const AGENT_ID = 'facio';

/** What the model is told when neither the package nor the session named a prompt. */
const DEFAULT_INSTRUCTIONS = 'You are a helpful assistant.';

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * The facio session id an AHP session URI names.
 *
 * The client names the channel and facio names the transcript; the two are
 * one conversation, so the id is derived in one place rather than a channel
 * URI handed to a store keyed by ids. A URI already stripped of its scheme
 * is left alone, which is what a `resume` carries.
 */
export const sessionIdOf = (uri: string): string => uri.replace(/^ahp-session:\//, '');

/**
 * One conversation over a facio agent.
 *
 * `options` is the backend's identity and wiring: the provider it was
 * registered under, the store, and the model factory a session's settings
 * feed. `start` is what this particular session was told. Everything after
 * this is the turn lifecycle.
 */
export function facioSession(options: FacioOptions, start: Start): Session {
  const provider = options.provider ?? 'facio';
  /** The configured facio id, or the URI's when this is a fresh session. */
  const sessionId = start.resume ?? sessionIdOf(start.uri);
  /** The directory the agent works in; the host's when it named one. */
  const where = start.workingDirectory ?? process.cwd();
  /** The store every turn of this session shares. */
  const store = storeOf(options);

  /** Finished turns. The running one is `active` and is deliberately not here. */
  const turns: Bag[] = [...(start.seed ?? [])];
  let active: Bag | undefined;
  /** The run behind `active`, so a cancel has something to stop. */
  let handle: RunHandle | undefined;
  /** Whether a client asked to stop, read by the mapping when the run ends. */
  let cancelRequested = false;
  let title = 'Facio session';
  let modified = new Date().toISOString();
  let closed = false;
  /** What it is doing, or nothing while it is idle. */
  let activity: string | undefined;
  /** Messages waiting for the running turn to end. The host's, not a client's. */
  const queued: Bag[] = [];
  /** What somebody is part-way through typing. */
  let draft: Bag | undefined;
  /**
   * The config in force, by key.
   *
   * `session/configChanged` merges into this, and the agent for the next turn
   * is built from it, so a session-mutable key changes what runs rather than
   * being recorded and ignored.
   */
  const settings: Record<string, unknown> = { ...start.settings };

  const touch = (): void => { modified = new Date().toISOString(); };

  /**
   * The system prompt for a turn.
   *
   * The session's own prompt, then what the host wants the model told beside
   * it: the instruction behind each host tool, which is what makes a tool
   * nothing asks for worth calling.
   */
  const instructionsOf = (values: Record<string, unknown>): string => {
    const own = str(values.instructions) ?? options.instructions ?? DEFAULT_INSTRUCTIONS;
    const fromHost = (start.instructions ?? []).filter((one) => one.trim() !== '');
    return [own, ...fromHost].join('\n\n');
  };

  /**
   * The facio agent a turn runs on, built fresh so the config in force is
   * the config that runs. `createAgent` is a value, not an actor, so building
   * it per turn costs nothing the store does not already hold.
   */
  const agentOf = (values: Record<string, unknown>): FacioAgent => createAgent({
    id: AGENT_ID,
    instructions: instructionsOf(values),
    model: modelOf(options, values),
    tools: facioTools(start.tools ?? []),
    store,
  });

  /** Say what it is doing, on both channels, the way a session mirrors its chat. */
  const doing = (said: string | undefined): void => {
    if (activity === said) return;
    activity = said;
    start.emit('chat', { type: 'chat/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
    start.emit('session', { type: 'session/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
  };

  /** `SessionStatus`: 8 is in progress, 1 is idle. */
  const status = (): number => (active !== undefined ? Status.InProgress : Status.Idle);

  /** Move the running turn into the history, once the stream has ended. */
  const settleTurn = (ending: 'complete' | 'cancelled' | 'error'): void => {
    const turn = active;
    if (turn === undefined) return;
    turn.state = ending;
    turn.duration = Date.now() - Date.parse(String(turn.startedAt));
    turns.push(turn);
    active = undefined;
    handle = undefined;
    cancelRequested = false;
    touch();
    // Somebody stopping a turn is stopping this conversation; a queued message
    // behind it is the opposite of what they asked for.
    if (ending !== 'cancelled') startNext();
  };

  /**
   * Read a run to its end.
   *
   * Every action comes from `mapping.ts`, including the one that ends the
   * turn. A mapping error is not caught: a pause arriving here must fail
   * loudly rather than be answered with a turn end nobody asked for. Task 03
   * gives those events their own actions and a route back into the run.
   */
  const read = (live: RunHandle, mapping: TurnMapping): void => {
    /** Whether this run has already said how it ended. */
    let settled = false;
    /** One event's actions, and the ending if it carried one. */
    const send = (event: RunEvent): void => {
      if (event.type === 'run.finished') doing(undefined);
      for (const action of mapping.actions(event)) {
        start.emit('chat', action);
        const type = str(action.type);
        if (type === 'chat/turnComplete' || type === 'chat/turnCancelled' || type === 'chat/error') {
          settled = true;
          settleTurn(type === 'chat/turnCancelled' ? 'cancelled' : type === 'chat/error' ? 'error' : 'complete');
        }
      }
    };
    void (async () => {
      for await (const event of live.events) send(event);
      /*
       * A run that failed before it could publish anything ends its stream
       * with the handle's outcome and no `run.finished`. The turn is still
       * open, so the outcome is mapped as the event the stream should have
       * carried. That goes through `mapping.ts` with every other event, so
       * the decision about what it means stays in one place.
       */
      if (!settled) {
        const outcome = await live.outcome;
        send({
          seq: 0,
          runId: live.runId,
          sessionId: live.sessionId,
          agentId: AGENT_ID,
          at: new Date().toISOString(),
          type: 'run.finished',
          outcome,
        });
      }
    })();
  };

  /**
   * Start a turn, whoever asked for it.
   *
   * `chat/turnStarted` is emitted here, before `run()` is called, because the
   * host has already dispatched that action and AHP requires the order
   * turnStarted, then an opened part, then deltas. facio's own `run.started`
   * therefore means nothing on the wire and is dropped in `mapping.ts`.
   *
   * `queuedMessageId` names the waiting message it came from; a client's
   * reducer takes it out of the queue on that word.
   */
  const beginTurn = (turnId: string, text: string, model?: Chosen, from?: MessageFrom, queuedMessageId?: string): void => {
    if (closed || active !== undefined) return;
    cancelRequested = false;
    if (title === 'Facio session' && text !== '') {
      title = text.slice(0, 60);
      // Said, because a client that opened the session holds the old one.
      start.emit('session', { type: 'session/titleChanged', title });
    }
    // A model named on the turn wins over the session's, and is what the
    // usage report names; it is applied before the agent is built.
    const values: Record<string, unknown> = model === undefined ? settings : { ...settings, model: model.id };
    const chosen = model?.id ?? str(settings.model);
    const began = Date.now();
    /*
     * The markdown part is opened now rather than at the first delta, the way
     * the echo example opens it: a client that subscribes between two events
     * still sees the part the text is arriving in.
     */
    const part: Bag = { id: `${turnId}:text`, kind: 'markdown', content: '' };
    active = {
      id: turnId,
      startedAt: new Date(began).toISOString(),
      message: {
        text,
        ...(from?.origin !== undefined ? { origin: from.origin } : {}),
        ...(from?._meta !== undefined ? { _meta: from._meta } : {}),
      },
      responseParts: [part],
      ...(chosen !== undefined ? { model: chosen } : {}),
    };
    start.emit('chat', {
      type: 'chat/turnStarted',
      turnId,
      startedAt: active.startedAt,
      message: active.message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    start.emit('chat', { type: 'chat/responsePart', turnId, part });
    doing('Thinking');

    const mapping = mapTurn({
      turnId,
      markdownPartId: String(part.id),
      parts: active.responseParts as Bag[],
      startedAt: began,
      displayNameOf: (name) => start.tools?.find((one) => one.definition.name === name)?.definition.title ?? name,
      cancelled: () => cancelRequested,
      ...(chosen !== undefined ? { model: chosen } : {}),
    });

    const live = run({ agent: agentOf(values), session: sessionId, workspace: where, input: text });
    handle = live;
    read(live, mapping);
    touch();
  };

  /** The head of the queue, once there is nothing running. */
  const startNext = (): void => {
    if (active !== undefined || closed) return;
    const next = queued.shift();
    if (next === undefined) return;
    const message = bag(next.message);
    beginTurn(
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
     * The model this session runs on.
     *
     * Read off the adapter the turn would use rather than off the schema
     * alone, because a package that ships no default and a session that chose
     * nothing is a session that cannot answer a turn. An empty list is the
     * honest form of that.
     */
    models: () => {
      const id = str(settings.model) ?? options.model ?? options.adapter?.modelId;
      return id === undefined ? [] : [{ id, name: id }];
    },
    agentId: () => sessionId,
    customizations: () => start.seedCustomizations ?? [],
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
      customizations: start.seedCustomizations ?? [],
      ...(activity !== undefined ? { activity } : {}),
      // The schema *and* what is in force: a client reads
      // `config.schema.properties` for the controls and `config.values` for
      // where each one sits.
      config: { schema: start.schema(), values: { ...settings } },
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
      // The protocol's `PendingMessage` is `{ id, message }` and nothing else,
      // so the model a queued turn will run on stays in this session.
      queuedMessages: queued.map((held) => ({ id: held.id, message: held.message })),
    }),

    begin: (turnId, text, model, from) => beginTurn(turnId, text, model, from),

    /**
     * Stop the running turn.
     *
     * The cancel reaches facio's `RunHandle.cancel`, and the run's own
     * `run.finished` (a cancelled outcome) is what emits `chat/turnCancelled`
     * exactly once. This must not send one of its own, or a client sees two.
     */
    cancel: (turnId) => {
      const live = handle;
      const turn = active;
      if (live === undefined || turn === undefined) return;
      if (turnId !== String(turn.id)) return;
      cancelRequested = true;
      live.cancel({ reason: 'the client stopped the turn' });
    },

    /**
     * Put a message into the running turn.
     *
     * facio's own word for it is a steer: a message appended to the
     * transcript before the next model step. Answers whether there was a turn
     * to steer, because a chat with nothing running has nothing to inject
     * into.
     */
    steer: (_id, text) => {
      const live = handle;
      if (live === undefined) return false;
      // Fire and forget: the answer is whether a turn was running, which is
      // known here, and the submit settles when the transcript takes it.
      void live.submit({ type: 'steer', text }).catch(() => {});
      return true;
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
      start.emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message: entry.message });
      touch();
      startNext();
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
        if (held === undefined || seen.has(id)) continue;
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

    // Held by the session, so two people on one chat see each other's.
    setDraft: (next) => {
      if (JSON.stringify(next) === JSON.stringify(draft)) return;
      draft = next;
      start.emit('chat', { type: 'chat/draftChanged', ...(next !== undefined ? { draft: next } : {}) });
    },

    /*
     * Nothing here asks anything yet: a paused run and its answers arrive
     * with task 03, and these are only reachable from one. Throwing says so
     * rather than accepting a decision with nowhere to go.
     */
    confirm: () => {
      throw new Error(`${provider}: tool confirmation arrives with task 03; nothing pauses a run yet`);
    },
    answer: () => {
      throw new Error(`${provider}: questions arrive with task 03; nothing pauses a run yet`);
    },

    /*
     * Take a config value. A key in the schema is kept and applied to the
     * next turn's agent; anything else is refused in this backend's words,
     * because the host reads the schema for how a key behaves and knows
     * nothing about what one means.
     */
    setConfig: (key, value) => {
      const declared = bag(bag(start.schema()).properties);
      if (declared[key] === undefined) return `${provider}: ${key} is not a config key this backend takes`;
      if (typeof value !== 'string') return `${provider}: ${key} takes a string`;
      settings[key] = value;
      return true;
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
      handle?.cancel({ reason: 'the session closed' });
    },
  };
}
