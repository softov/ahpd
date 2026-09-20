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

import { createAgent, resume, run, textOf } from '@facio/agents';
import type { Agent as FacioAgent, RunCommand, RunEvent, RunHandle, Store } from '@facio/agents';
import { Status } from '@ahpd/sdk';
import type { Bag, Chosen, MessageFrom, Session, Start } from '@ahpd/sdk';
import { modelOf, storeOf } from './agent.js';
import type { FacioOptions } from './agent.js';
import { mapTurn } from './mapping.js';
import type { OpenRequest, TurnMapping } from './mapping.js';
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

/** What a person is told the model was told when they turn a tool down. */
const DECLINED = 'The person declined this action';

/**
 * The answers a client sent, in the shape facio's questions want.
 *
 * AHP carries each answer as `{ state, value: { kind, value } }` and facio
 * wants the value itself, keyed by question id and a list only where the
 * question allows many. The value sits two levels in, and a value that is
 * already a string or a list is taken as it is, so a caller that hands over
 * facio's own shape is not unwrapped into nothing.
 */
const answersOf = (answers: Bag): Record<string, string | string[]> => {
  /** One value as facio reads it, or nothing for a shape it would refuse. */
  const valueOf = (value: unknown): string | string[] | undefined => {
    const strings = (list: unknown[]): string[] => list.filter((one): one is string => typeof one === 'string');
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return strings(value);
    const answer = bag(value);
    const inner = bag(answer.value);
    const raw = inner.value ?? answer.value;
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) return strings(raw);
    return undefined;
  };
  const said: Record<string, string | string[]> = {};
  for (const [id, value] of Object.entries(answers)) {
    const one = valueOf(value);
    // A skipped or shapeless answer is left out rather than sent empty, which
    // facio's own validation would refuse the whole form for.
    if (one !== undefined) said[id] = one;
  }
  return said;
};

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
export function facioSession(options: FacioOptions, start: Start, sharedStore?: Store): Session {
  const provider = options.provider ?? 'facio';
  /** The configured facio id, or the URI's when this is a fresh session. */
  const sessionId = start.resume ?? sessionIdOf(start.uri);
  /** The directory the agent works in; the host's when it named one. */
  const where = start.workingDirectory ?? process.cwd();
  /**
   * The store every turn of this session shares.
   *
   * `facioAgent` builds one for the whole backend, so the catalogue and the
   * conversation read the same store; a caller that named none - the export
   * is public - gets one of its own, which is what a single session had.
   */
  const store = sharedStore ?? storeOf(options);

  /** Finished turns. The running one is `active` and is deliberately not here. */
  const turns: Bag[] = [...(start.seed ?? [])];
  let active: Bag | undefined;
  /** The run behind `active`, so a cancel has something to stop. */
  let handle: RunHandle | undefined;
  /** The agent the active run was built from, so a rejoin continues on the same one. */
  let liveAgent: FacioAgent | undefined;
  /** The active turn's mapping, so an answer can settle the entries it opened. */
  let activeMapping: TurnMapping | undefined;
  /**
   * What a client is being asked about, by the run's own request id.
   *
   * One row per request rather than one for the turn, because a run can pause
   * again after each answer and the second request must not overwrite the
   * first while it is still open.
   */
  const pending = new Map<string, OpenRequest>();
  /**
   * Where the run stopped waiting, when it is paused rather than finished.
   *
   * A paused run closes the handle that started it, so the answer has to
   * rejoin the run from this sequence rather than submit to a handle with
   * nothing left to receive it.
   */
  let paused: { runId: string; seq: number } | undefined;
  /** Whether a client asked to stop, read by the mapping when the run ends. */
  let cancelRequested = false;
  let title = 'Facio session';
  let modified = new Date().toISOString();
  let closed = false;
  /**
   * Whether the conversation the host resumed is still being looked up.
   *
   * A run paused before the restart still holds the session's writer claim, so
   * a turn that started before the lookup finished would fight it for the
   * claim and lose. Everything that would begin a turn waits on this instead,
   * so it sees either an empty conversation or the reopened one.
   */
  let opening: Promise<void> | undefined;
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
    // Absent means facio's own default, which is the policy an approval comes
    // from; this bridge does not keep a second one beside it.
    ...(options.policy !== undefined ? { policy: options.policy } : {}),
  });

  /** Say what it is doing, on both channels, the way a session mirrors its chat. */
  const doing = (said: string | undefined): void => {
    if (activity === said) return;
    activity = said;
    start.emit('chat', { type: 'chat/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
    start.emit('session', { type: 'session/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
  };

  /**
   * `SessionStatus`: 8 is in progress, 1 is idle, and 24 is waiting on a
   * person and carries the 8.
   */
  const status = (): number => (pending.size > 0 ? Status.InputNeeded
    : active !== undefined ? Status.InProgress
      : Status.Idle);

  /** Move the running turn into the history, once the stream has ended. */
  const settleTurn = (ending: 'complete' | 'cancelled' | 'error'): void => {
    const turn = active;
    if (turn === undefined) return;
    turn.state = ending;
    turn.duration = Date.now() - Date.parse(String(turn.startedAt));
    turns.push(turn);
    active = undefined;
    handle = undefined;
    liveAgent = undefined;
    activeMapping = undefined;
    paused = undefined;
    // An ending turn cannot still be waiting on an answer; a request left
    // here would keep the session reporting `InputNeeded` over nothing.
    pending.clear();
    cancelRequested = false;
    touch();
    // Somebody stopping a turn is stopping this conversation; a queued message
    // behind it is the opposite of what they asked for.
    if (ending !== 'cancelled') startNext();
  };

  /**
   * One event's actions, through the mapping, and what it did to the session.
   *
   * `replaying` is for a run history read back on a resume: the awaiting
   * `run.finished` that ends it is not a pause to rejoin, because the rejoin
   * is what is reading it and its handle is still open. Answers whether this
   * run has now said how it ended.
   */
  const apply = (mapping: TurnMapping, event: RunEvent, replaying: boolean): boolean => {
    if (event.type === 'run.finished') doing(undefined);
    let settled = false;
    const mapped = mapping.actions(event);
    for (const action of mapped.actions) {
      const type = str(action.type) ?? '';
      /*
       * A pause lives on the session channel and a turn on the chat channel;
       * the action's own name is what says which, so a client watching the
       * catalogue alone still learns somebody is being asked.
       */
      start.emit(type.startsWith('session/') ? 'session' : 'chat', action);
      if (type === 'chat/turnComplete' || type === 'chat/turnCancelled' || type === 'chat/error') {
        settled = true;
        settleTurn(type === 'chat/turnCancelled' ? 'cancelled' : type === 'chat/error' ? 'error' : 'complete');
      }
    }
    if (mapped.opened !== undefined) pending.set(mapped.opened.requestId, mapped.opened);
    if (mapped.settled !== undefined) pending.delete(mapped.settled);
    /*
     * The awaiting outcome is a pause, not an ending: the handle is closed
     * and the turn stays open until somebody answers. This read is over, so
     * the fallback below must not report the pause as a turn that ended, and
     * the sequence is kept so the answer rejoins rather than replays.
     */
    if (!replaying && event.type === 'run.finished' && event.outcome.status === 'awaiting') {
      settled = true;
      paused = { runId: event.runId, seq: event.seq };
    }
    return settled;
  };

  /**
   * Read a run to its end.
   *
   * Every action comes from `mapping.ts`, including the one that ends the
   * turn. A pause is not an ending: the awaiting outcome leaves the turn open
   * and records where the run stopped, so an answer can rejoin it.
   */
  const read = (live: RunHandle, mapping: TurnMapping): void => {
    /** Whether this run has already said how it ended. */
    let settled = false;
    void (async () => {
      for await (const event of live.events) {
        if (apply(mapping, event, false)) settled = true;
      }
      /*
       * A run that failed before it could publish anything ends its stream
       * with the handle's outcome and no `run.finished`. The turn is still
       * open, so the outcome is mapped as the event the stream should have
       * carried. That goes through `mapping.ts` with every other event, so
       * the decision about what it means stays in one place.
       */
      if (!settled) {
        const outcome = await live.outcome;
        apply(mapping, {
          seq: 0,
          runId: live.runId,
          sessionId: live.sessionId,
          agentId: AGENT_ID,
          at: new Date().toISOString(),
          type: 'run.finished',
          outcome,
        }, false);
      }
    })();
  };

  /**
   * Rejoin a run this process paused, so it can take a command again.
   *
   * facio's `run()` returns a handle with no command channel; only `resume()`
   * installs one. The sequence the pause ended at is passed so the rejoined
   * stream carries what happens next rather than everything the client has
   * already seen.
   */
  const rejoin = (): RunHandle | undefined => {
    const waiting = paused;
    const agent = liveAgent;
    if (waiting === undefined || agent === undefined) return undefined;
    paused = undefined;
    const rejoined = resume({ agent, sessionId, runId: waiting.runId, afterSeq: waiting.seq });
    handle = rejoined;
    if (activeMapping !== undefined) read(rejoined, activeMapping);
    return rejoined;
  };

  /**
   * Send a decision back into the run that is waiting on it.
   *
   * A run that has not paused still holds a live handle and takes the command
   * directly; one that paused is rejoined first. The answer is fire and
   * forget, the way a steer is: whether it was taken is known here, and a
   * refusal is facio's to log rather than a turn to fail.
   */
  const route = (command: RunCommand): void => {
    const live = paused === undefined ? handle : rejoin();
    if (live === undefined) return;
    void live.submit(command).catch(() => {});
  };

  /**
   * Stop the run, answering anything it is waiting on.
   *
   * A paused run has already closed its handle, so stopping it means
   * rejoining it and cancelling that: facio's own cancel denies the open
   * request and ends the run, which is the one path that leaves no promise
   * nobody can settle.
   */
  const stop = (reason: string): void => {
    if (paused !== undefined) {
      for (const held of [...pending.values()]) {
        const removal = activeMapping?.settle(held.requestId);
        if (removal !== undefined) start.emit('session', removal);
      }
      pending.clear();
      const rejoined = rejoin();
      rejoined?.cancel({ reason });
      return;
    }
    handle?.cancel({ reason });
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
  const startTurn = (turnId: string, text: string, model?: Chosen, from?: MessageFrom, queuedMessageId?: string): void => {
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
      chatUri: start.chatUri,
      markdownPartId: String(part.id),
      parts: active.responseParts as Bag[],
      startedAt: began,
      displayNameOf: (name) => start.tools?.find((one) => one.definition.name === name)?.definition.title ?? name,
      cancelled: () => cancelRequested,
      ...(chosen !== undefined ? { model: chosen } : {}),
    });
    activeMapping = mapping;

    const agent = agentOf(values);
    liveAgent = agent;
    const live = run({ agent, session: sessionId, workspace: where, input: text });
    handle = live;
    read(live, mapping);
    touch();
  };

  /**
   * Begin a turn, once the resume lookup has settled.
   *
   * A resumed session may already have an open turn waiting on a person, so a
   * second run would fight the paused one for the session's writer claim and
   * fail `writer_busy`. Waiting for the lookup is what tells the two apart,
   * and it costs an ordinary session nothing: `opening` is only set when the
   * host named a conversation to continue.
   */
  const beginTurn = (turnId: string, text: string, model?: Chosen, from?: MessageFrom, queuedMessageId?: string): void => {
    const waiting = opening;
    if (waiting === undefined) {
      startTurn(turnId, text, model, from, queuedMessageId);
      return;
    }
    const start = (): void => startTurn(turnId, text, model, from, queuedMessageId);
    void waiting.then(start, start);
  };

  /** The head of the queue, once there is nothing running. */
  const startNext = (): void => {
    if (opening !== undefined) {
      // A paused run decides whether anything may be taken off the queue, so
      // the queue waits for the same lookup every turn does.
      void opening.then(startNext, startNext);
      return;
    }
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

  /**
   * Rejoin the run a restart left paused.
   *
   * A paused facio run still holds the session's writer claim, so a new run
   * under this id would be refused `writer_busy`, and no answer could reach it
   * either: `resume()` is the only call that installs a command channel. The
   * run's own events are replayed through the same mapping a live turn uses,
   * so the request reaches the client by the path that put it there rather
   * than a second path written here.
   *
   * A conversation whose newest run already finished, or that the store has
   * never seen, is left alone: the next turn appends a new run under the same
   * facio session, which is what continuing a finished conversation means.
   */
  const reopen = async (): Promise<void> => {
    if (closed) return;
    const record = await store.sessions.get({ sessionId });
    if (record === undefined || closed) return;
    const runs = await store.runs.list({ sessionId });
    const newest = runs[0];
    if (newest === undefined || newest.status !== 'awaiting' || newest.pendingRequestId === undefined) return;

    const agent = agentOf(settings);
    liveAgent = agent;
    const messages = await store.sessions.listMessages({ sessionId });
    const input = messages.find((one) => one.id === newest.inputMessageId);
    const turnId = input?.id ?? newest.runId;
    const began = input === undefined ? Date.now() : Date.parse(input.createdAt);
    const startedAt = new Date(Number.isFinite(began) ? began : Date.now()).toISOString();
    /*
     * The seed gives way to the replay.
     *
     * The host seeds `transcript(id)` into `start.seed`, and that transcript
     * already carries this run's open turn as a finished one, because AHP's
     * turn states have no `awaiting`. The replay below rebuilds the very same
     * turn as the live `active` one, with the parts the next deltas append to,
     * so keeping the seeded copy would show the open turn twice in every
     * subscription snapshot - once in `turns` and once as `activeTurn`. The
     * seed is the side that gives way, because only this session knows the run
     * is about to be replayed; the transcript still carries the turn for the
     * catalogue row a client browses without continuing it.
     */
    const seeded = turns.findIndex((turn) => String(turn.id) === turnId);
    if (seeded >= 0) turns.splice(seeded, 1);
    /*
     * The same opening as a live turn: the markdown part exists before the
     * replay, so a text delta from a replayed event has a part to append to
     * exactly as it did when the turn first ran.
     */
    const part: Bag = { id: `${turnId}:text`, kind: 'markdown', content: '' };
    active = {
      id: turnId,
      startedAt,
      message: { text: input === undefined ? '' : textOf(input) },
      responseParts: [part],
    };
    start.emit('chat', { type: 'chat/turnStarted', turnId, startedAt, message: active.message });
    start.emit('chat', { type: 'chat/responsePart', turnId, part });
    const mapping = mapTurn({
      turnId,
      chatUri: start.chatUri,
      markdownPartId: String(part.id),
      parts: active.responseParts as Bag[],
      startedAt: Number.isFinite(began) ? began : Date.now(),
      displayNameOf: (name) => start.tools?.find((one) => one.definition.name === name)?.definition.title ?? name,
      cancelled: () => false,
    });
    activeMapping = mapping;

    /*
     * What the run already wrote, in the order facio persisted it, before the
     * live handle is read: the paused call and the request it waits on are
     * rebuilt by the events that carry them.
     */
    const events = await store.runs.listEvents({ sessionId, runId: newest.runId });
    const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : 0;
    for (const event of events) apply(mapping, event, true);

    // Everything up to `lastSeq` has just been replayed, so the live stream
    // carries only what happens next rather than the conversation again.
    const live = resume({ agent, sessionId, runId: newest.runId, afterSeq: lastSeq });
    if (closed) {
      live.cancel({ reason: 'the session closed' });
      return;
    }
    handle = live;
    read(live, mapping);
    doing('Waiting on you');
    touch();
  };

  /*
   * A resumed conversation may be paused, and every turn has to wait for that
   * answer before it can start. Nothing else in the session reads the store
   * first, so this is the one lookup the deferral is for.
   */
  if (start.resume !== undefined && !closed) {
    const pending = reopen();
    opening = pending;
    const settledOpening = (): void => { if (opening === pending) opening = undefined; };
    void pending.then(settledOpening, settledOpening);
  }

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
      /*
       * What a client is being asked, so a session channel a client
       * subscribed to before the pause still shows the form and the status
       * that carries it. The entries are the ones the set actions carried.
       */
      ...(pending.size > 0 ? { inputNeeded: [...pending.values()].map((held) => held.entry) } : {}),
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
      const turn = active;
      if (turn === undefined) return;
      if (turnId !== String(turn.id)) return;
      cancelRequested = true;
      stop('the client stopped the turn');
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

    /**
     * Answer a tool call the run is waiting on.
     *
     * Found by the call's own id rather than assumed to be the only request:
     * with two open, comparing against whichever was held last is a person
     * pressing Approve and nothing at all happening. The entry leaves by the
     * same id it arrived with, the decision is said back because nothing in a
     * client applies its own dispatch, and the answer goes into the run.
     */
    confirm: (toolCallId, approved) => {
      const held = [...pending.values()].find((one) => one.kind === 'approval' && one.callId === toolCallId);
      if (held === undefined) return;
      pending.delete(held.requestId);
      const removal = activeMapping?.settle(held.requestId);
      if (removal !== undefined) start.emit('session', removal);

      /*
       * The row in this session's own snapshot moves with the decision.
       *
       * Nothing applies what a client dispatched, so a call approved here
       * would stay `pending-confirmation` for anybody who subscribes next.
       */
      const part = (active?.responseParts as Bag[] | undefined)?.find((one) => one.id === held.callId);
      if (part !== undefined) {
        const call = bag(part.toolCall);
        call.status = approved ? 'running' : 'cancelled';
        if (approved) call.confirmed = 'user-action';
        part.toolCall = call;
      }
      start.emit('chat', {
        type: 'chat/toolCallConfirmed',
        turnId: active?.id,
        toolCallId,
        approved,
        ...(approved ? { confirmed: 'user-action' } : { reason: DECLINED }),
      });
      route(approved
        ? { type: 'approve', requestId: held.requestId }
        : { type: 'deny', requestId: held.requestId, reason: DECLINED });
      touch();
    },

    /**
     * Answer a question the run is waiting on.
     *
     * A declined question is a deny rather than an empty answer, because
     * facio's own validation refuses a form with nothing in it and the model
     * is owed the reason either way.
     */
    answer: (requestId, accepted, answers) => {
      const held = pending.get(requestId);
      if (held === undefined || held.kind !== 'input') return;
      pending.delete(requestId);
      const removal = activeMapping?.settle(requestId);
      if (removal !== undefined) start.emit('session', removal);
      route(accepted
        ? { type: 'answer', requestId, answers: answersOf(answers) }
        : { type: 'deny', requestId, reason: DECLINED });
      touch();
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
      stop('the session closed');
    },
  };
}
