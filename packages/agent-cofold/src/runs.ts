import { resume, textOf } from '@cofold/agents';
import type { RunEvent, RunHandle } from '@cofold/agents';
import { Status } from '@ahpd/sdk';
import type { Bag } from '@ahpd/sdk';
import { mapTurn } from './mapping.js';
import type { TurnMapping } from './mapping.js';
import { AGENT_ID } from './turnagent.js';
import type { SessionContext } from './context.js';

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** What reading and reopening a run offers the other areas. */
export interface Runs {
  cut: () => Promise<void>;
  doing: (said: string | undefined) => void;
  status: () => number;
  apply: (mapping: TurnMapping, turnId: string, event: RunEvent, replaying: boolean) => Promise<boolean>;
  read: (live: RunHandle, mapping: TurnMapping, turnId: string) => void;
  reopen: () => Promise<void>;
}

export const createRuns = (ctx: SessionContext): Runs => {
  const { start, provider, store, sessionId, turns, pending, points } = ctx;

  /**
   * The cut this session was asked for, made before it runs a turn.
   *
   * AHP gives a fork and a rewind the same job - the conversation the host
   * named, ending at the point it named - and the difference is only where the
   * result lives: a fork copies it into this session's new id and leaves the
   * source whole, a rewind drops what followed the point in place. Both are
   * one store call, and both are refused when the store cannot make the cut,
   * because a fork that quietly continued would append to the conversation it
   * was told to preserve and a rewind that did nothing would keep the turns it
   * was told to drop.
   */
  const cut = async (): Promise<void> => {
    if (start.forkAt !== undefined && start.rewindAt !== undefined) {
      throw new Error(`${provider}: a session cannot fork and rewind at once`);
    }
    if (start.forkAt !== undefined) {
      if (start.resume === undefined) throw new Error(`${provider}: a fork needs the conversation it copies`);
      await store.sessions.fork({ fromSessionId: start.resume, throughMessageId: start.forkAt, sessionId });
      return;
    }
    if (start.rewindAt !== undefined) {
      if (start.resume === undefined) throw new Error(`${provider}: a rewind needs the conversation it cuts`);
      await store.sessions.truncate({ sessionId, throughMessageId: start.rewindAt });
    }
  };

  /** Say what it is doing, on both channels, the way a session mirrors its chat. */
  const doing = (said: string | undefined): void => {
    if (ctx.activity === said) return;
    ctx.activity = said;
    start.emit('chat', { type: 'chat/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
    start.emit('session', { type: 'session/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
  };

  /**
   * `SessionStatus`: 8 is in progress, 1 is idle, 2 is a last turn that
   * failed, and 24 is waiting on a person and carries the 8.
   */
  const status = (): number => (pending.size > 0 ? Status.InputNeeded
    : ctx.active !== undefined ? Status.InProgress
      : ctx.failed !== undefined ? Status.Error
        : Status.Idle);

  /**
   * Move the running turn into the history, once the stream has ended.
   *
   * Called before the ending action goes out: the host reads `status()` as it
   * passes that action on, and a turn still active there reads as running.
   * Answers whether there was a turn to settle. `why` is what an `error`
   * ending failed with.
   */
  const settleTurn = (ending: 'complete' | 'cancelled' | 'error', why?: string): boolean => {
    const turn = ctx.active;
    if (turn === undefined) return false;
    if (ending === 'error') ctx.failed = why === undefined || why === '' ? 'The turn failed' : why;
    turn.state = ending;
    turn.duration = Date.now() - Date.parse(String(turn.startedAt));
    turns.push(turn);
    ctx.active = undefined;
    ctx.handle = undefined;
    ctx.liveAgent = undefined;
    ctx.activeMapping = undefined;
    ctx.paused = undefined;
    ctx.payPause(false);
    // An ending turn cannot still be waiting on an answer; a request left
    // here would keep the session reporting `InputNeeded` over nothing.
    pending.clear();
    ctx.cancelRequested = false;
    ctx.touch();
    return true;
  };

  /**
   * Keep where this turn ended, for the two cut methods.
   *
   * Read from the run record rather than from the events, because the last
   * thing a run wrote is a message no event names - a tool result, a steer, the
   * marker a cancel leaves - and a cut at a guessed point would drop a turn's
   * log for a point it did not really have. The store advances the run's
   * `lastMessageId` with every message it appends, so the record is exact.
   */
  const rememberPoints = async (turnId: string, runId: string): Promise<void> => {
    const record = await store.runs.get({ sessionId, runId });
    if (record?.lastMessageId !== undefined) points.set(turnId, record.lastMessageId);
  };

  /**
   * One event's actions, through the mapping, and what it did to the session.
   *
   * `replaying` is for a run history read back on a resume: the awaiting
   * `run.finished` that ends it is not a pause to rejoin, because the rejoin
   * is what is reading it and its handle is still open. Answers whether this
   * run has now said how it ended.
   */
  const apply = async (mapping: TurnMapping, turnId: string, event: RunEvent, replaying: boolean): Promise<boolean> => {
    if (event.type === 'run.finished') doing(undefined);
    /*
     * A call that will never have a result still owes its `after`.
     *
     * A denial from the run ends the call without the tool running and a
     * stopped run can cut one off mid-flight; either way the file was announced
     * as changing, so the `after` goes out here when the tool's own result will
     * not carry it. The sweep is idempotent: `settleEdit` forgets the call it
     * answers, so a call settled where it ended is not settled again.
     */
    if (event.type === 'tool.denied') ctx.settleEdit(event.callId);
    if (event.type === 'run.finished' && event.outcome.status !== 'awaiting') {
      for (const callId of [...ctx.editing.keys()]) ctx.settleEdit(callId);
    }
    /*
     * A finished turn's span is recorded before the client is told it ended,
     * so a fork or a rewind asked for the moment the turn appears has a point
     * to cut at. A pause is not an ending and is not recorded: `endPoint` is
     * where a turn ended, and a run waiting on a person has not ended.
     */
    if (event.type === 'run.finished' && event.outcome.status !== 'awaiting') {
      await rememberPoints(turnId, event.runId);
    }
    let settled = false;
    const mapped = mapping.actions(event);
    /*
     * A request is held before it is announced, so a client that answers
     * inside the emit that carries it finds it; a live run that announced one
     * owes the pause its answer waits for.
     */
    const hold = (): void => {
      if (mapped.opened === undefined) return;
      pending.set(mapped.opened.requestId, mapped.opened);
      if (!replaying) ctx.owePause();
    };
    for (const action of mapped.actions) {
      const type = str(action.type) ?? '';
      if (type === 'session/inputNeededSet') hold();
      const ending = type === 'chat/turnComplete' ? 'complete'
        : type === 'chat/turnCancelled' ? 'cancelled'
          : type === 'chat/error' ? 'error'
            : undefined;
      const why = ending === 'error' ? str(bag(bag(action.part).error).message) : undefined;
      const ended = ending !== undefined && settleTurn(ending, why);
      /*
       * A pause lives on the session channel and a turn on the chat channel;
       * the action's own name is what says which, so a client watching the
       * catalogue alone still learns somebody is being asked.
       */
      start.emit(type.startsWith('session/') ? 'session' : 'chat', action);
      if (ending !== undefined) settled = true;
      // Somebody stopping a turn is stopping this conversation; a queued
      // message behind it is the opposite of what they asked for. After the
      // ending, so the next turn starts after the last one ended.
      if (ended && ending !== 'cancelled') ctx.startNext();
    }
    hold();
    if (mapped.settled !== undefined) pending.delete(mapped.settled);
    /*
     * The awaiting outcome is a pause, not an ending: the handle is closed
     * and the turn stays open until somebody answers. This read is over, so
     * the fallback below must not report the pause as a turn that ended, and
     * the sequence is kept so the answer rejoins rather than replays.
     */
    if (!replaying && event.type === 'run.finished' && event.outcome.status === 'awaiting') {
      settled = true;
      ctx.paused = { runId: event.runId, seq: event.seq };
    }
    if (!replaying && event.type === 'run.finished') ctx.payPause(event.outcome.status === 'awaiting');
    return settled;
  };

  /**
   * Read a run to its end.
   *
   * Every action comes from `mapping.ts`, including the one that ends the
   * turn. A pause is not an ending: the awaiting outcome leaves the turn open
   * and records where the run stopped, so an answer can rejoin it.
   */
  const read = (live: RunHandle, mapping: TurnMapping, turnId: string): void => {
    /** Whether this run has already said how it ended. */
    let settled = false;
    void (async () => {
      for await (const event of live.events) {
        if (await apply(mapping, turnId, event, false)) settled = true;
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
        await apply(mapping, turnId, {
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
   * Rejoin the run a restart left paused.
   *
   * A paused cofold run still holds the session's writer claim, so a new run
   * under this id would be refused `writer_busy`, and no answer could reach it
   * either: `resume()` is the only call that installs a command channel. The
   * run's own events are replayed through the same mapping a live turn uses,
   * so the request reaches the client by the path that put it there rather
   * than a second path written here.
   *
   * A conversation whose newest run already finished, or that the store has
   * never seen, is left alone: the next turn appends a new run under the same
   * cofold session, which is what continuing a finished conversation means.
   */
  const reopen = async (): Promise<void> => {
    if (ctx.closed) return;
    const record = await store.sessions.get({ sessionId });
    if (record === undefined || ctx.closed) return;
    const runs = await store.runs.list({ sessionId });
    const newest = runs[0];
    if (newest === undefined || newest.status !== 'awaiting' || newest.pendingRequestId === undefined) return;

    const agent = ctx.agentOf(ctx.settings);
    ctx.liveAgent = agent;
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
     * The same opening as a live turn, with no part: the replayed events open
     * each part as they did when the turn first ran.
     */
    ctx.active = {
      id: turnId,
      startedAt,
      message: { text: input === undefined ? '' : textOf(input) },
      responseParts: [],
    };
    start.emit('chat', { type: 'chat/turnStarted', turnId, startedAt, message: ctx.active.message });
    const mapping = mapTurn({
      turnId,
      chatUri: start.chatUri,
      parts: ctx.active.responseParts as Bag[],
      startedAt: Number.isFinite(began) ? began : Date.now(),
      displayNameOf: (name) => ctx.offered.find((one) => one.definition.name === name)?.definition.title ?? name,
      ownerOf: (name) => ctx.offered.find((one) => one.definition.name === name)?.owner,
      cancelled: () => false,
    });
    ctx.activeMapping = mapping;

    /*
     * What the run already wrote, in the order cofold persisted it, before the
     * live handle is read: the paused call and the request it waits on are
     * rebuilt by the events that carry them.
     */
    const events = await store.runs.listEvents({ sessionId, runId: newest.runId });
    const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : 0;
    for (const event of events) await apply(mapping, turnId, event, true);

    // Everything up to `lastSeq` has just been replayed, so the live stream
    // carries only what happens next rather than the conversation again.
    const live = resume({ agent, sessionId, runId: newest.runId, afterSeq: lastSeq });
    if (ctx.closed) {
      live.cancel({ reason: 'the session closed' });
      return;
    }
    ctx.handle = live;
    read(live, mapping, turnId);
    doing('Waiting on you');
    ctx.touch();
  };

  return { cut, doing, status, apply, read, reopen };
};