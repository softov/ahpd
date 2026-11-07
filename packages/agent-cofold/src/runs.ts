import { resume } from '@cofold/agents';
import type { RunEvent, RunHandle } from '@cofold/agents';
import { bag, endedParts, mergeLogicalTurnUsage, reason, statusOf, str } from '@ahpd/sdk';
import type { Bag } from '@ahpd/sdk';
import type { TurnMapping } from './mapping.js';
import type { SessionContext } from './context.js';

/** What reading and reopening a run offers the other areas. */
export interface Runs {
  status: () => number;
  apply: (mapping: TurnMapping, turnId: string, event: RunEvent) => Promise<void>;
  read: (live: RunHandle, mapping: TurnMapping, turnId: string) => void;
  findPaused: () => Promise<void>;
  resumePaused: (turnId: string, mapping: TurnMapping) => Promise<boolean>;
  dropPaused: () => Promise<void>;
}

export const createRuns = (ctx: SessionContext): Runs => {
  const { start, store, sessionId, turns, pending, points } = ctx;

  /**
   * Move the running turn into the history, once the stream has ended.
   *
   * Called before the ending action goes out: the host reads `status()` as it
   * passes that action on, and a turn still active there reads as running.
   * Answers whether there was a turn to settle. `why` is what an `error`
   * ending failed with, and `part` is the error part the ending carried: the
   * turn keeps it, because a client that reads the turn back from the snapshot
   * has to find the same failure and the same `resumable` there as on the
   * stream.
   */
  const settleTurn = (ending: 'complete' | 'cancelled' | 'error', why?: string, part?: Bag): boolean => {
    const turn = ctx.active;
    if (turn === undefined) return false;
    // A turn a later one took the place of is in no history, as the reducer
    // keeps none of it, and its failure is not the chat's.
    const gone = ctx.replaced.delete(String(turn.id));
    if (ending === 'error' && !gone) ctx.error = why === undefined || why === '' ? 'The turn failed' : why;
    if (ending === 'error' && part !== undefined && Array.isArray(turn.responseParts)) {
      turn.responseParts.push(part);
    }
    // Held as the reducer holds it once the ending is reduced, so a chat first
    // opened after this turn draws what one that watched it end does.
    turn.responseParts = endedParts(Array.isArray(turn.responseParts) ? turn.responseParts as Bag[] : []);
    turn.state = ending;
    /*
     * A resumed turn's time is the time its run before took and this run's,
     * as the host says its end: the ending this run's mapping says carries
     * this run's time alone, and the host adds the rest.
     */
    const resumedFrom = ctx.resumedFrom;
    ctx.resumedFrom = undefined;
    turn.duration = resumedFrom === undefined
      ? Date.now() - Date.parse(String(turn.startedAt))
      : resumedFrom.duration + (Date.now() - resumedFrom.at);
    if (!gone) turns.push(turn);
    ctx.active = undefined;
    ctx.handle = undefined;
    ctx.activeMapping = undefined;
    // An ending turn cannot still be waiting on an answer; a request left
    // here would keep the session reporting `InputNeeded` over nothing.
    pending.clear();
    ctx.cancelRequested = false;
    // A turn's end moves the stamp to its start plus its duration, as the
    // reducer's does; a turn a later one took the place of ends in no state.
    if (!gone) ctx.setModifiedAt(new Date(Date.parse(String(turn.startedAt)) + Number(turn.duration)).toISOString());
    return true;
  };

  /**
   * Keep where this turn ended, for `forkPoint` and `endPoint`.
   *
   * Read from the run record rather than from the events, because the last
   * thing a run wrote is a message no event names - a tool result, a steer, the
   * marker a cancel leaves - and a fork or a truncation at a guessed point
   * would drop a turn's log for a point it did not really have. The store
   * advances the run's `lastMessageId` with every message it appends, so the
   * record is exact.
   */
  const rememberPoints = async (turnId: string, runId: string): Promise<void> => {
    const record = await store.runs.get({ sessionId, runId });
    if (record?.lastMessageId !== undefined) points.set(turnId, record.lastMessageId);
  };

  /**
   * One event's actions, through the mapping, and what it did to the session.
   *
   * The same call serves a live stream and a run history read back on a
   * resume, so a request reaches the client by the path that put it there the
   * first time rather than by a second path written for the replay.
   */
  const apply = async (mapping: TurnMapping, turnId: string, event: RunEvent): Promise<void> => {
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
    /*
     * The images a reply carries as bytes, kept through the host's port before
     * the reply is said, so its part names the reference the host answered, as
     * VS Code's host keeps a result's embedded content before it publishes a
     * reference to it. Each is named by its message and its place in it.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L148-L183
     */
    if (event.type === 'model.completed' && start.storeToolResultResource !== undefined) {
      for (const [index, part] of event.message.parts.entries()) {
        if (part.type !== 'image' || part.data === undefined) continue;
        const key = `${event.message.id}:${String(index)}`;
        const ref = await start.storeToolResultResource({
          turnId,
          toolCallId: key,
          ordinal: 0,
          name: 'image',
          contentType: part.mimeType,
          bytes: Buffer.from(part.data, 'base64'),
        }).catch(() => undefined);
        if (ref !== undefined) ctx.kept.set(key, { ...ref });
      }
    }
    const mapped = mapping.actions(event);
    /*
     * A request is held before it is announced, so a client that answers
     * inside the emit that carries it finds it.
     */
    const hold = (): void => {
      if (mapped.opened === undefined) return;
      pending.set(mapped.opened.requestId, mapped.opened);
    };
    for (const action of mapped.actions) {
      const type = str(action.type) ?? '';
      if (type === 'session/inputNeededSet' || type === 'chat/inputRequested') hold();
      const ending = type === 'chat/turnComplete' ? 'complete'
        : type === 'chat/turnCancelled' ? 'cancelled'
          : type === 'chat/error' ? 'error'
            : undefined;
      const why = ending === 'error' ? str(bag(bag(action.part).error).message) : undefined;
      const part = ending === 'error' ? bag(action.part) : undefined;
      /*
       * The turn holds the usage it says, as the protocol's reducer holds each
       * `chat/usage` on the active turn, so a chat opened after it holds what
       * a client that watched it was told: a resumed turn's, this run's merged
       * over the run before's, as the host says it.
       * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L772-L779
       */
      if (type === 'chat/usage' && ctx.active !== undefined && String(ctx.active.id) === str(action.turnId)) {
        ctx.active.usage = mergeLogicalTurnUsage(ctx.resumedFrom?.usage, bag(action.usage)) ?? action.usage;
      }
      const ended = ending !== undefined && settleTurn(ending, why, part);
      /*
       * A pause lives on the session channel and a turn on the chat channel;
       * the action's own name is what says which, so a client watching the
       * catalogue alone still learns somebody is being asked.
       */
      start.emit(type.startsWith('session/') ? 'session' : 'chat', action);
      /*
       * The turn handed behind it runs whatever the ending, as the reference
       * agent runs each send after the one before it; a stop drops the turns
       * handed behind the one it stops. After the ending, so the next turn
       * starts after the last one ended.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1814
       */
      if (ended) ctx.sendNext();
    }
    hold();
    if (mapped.settled !== undefined) pending.delete(mapped.settled);
  };

  /**
   * Read a run to its last `run.finished`.
   *
   * Every action comes from `mapping.ts`, including the one that ends the
   * turn. A pause does not end the stream: the awaiting outcome leaves the
   * turn open and the handle keeps reading, so the answer, the resolution and
   * everything after them arrive the same way the events before them did.
   */
  const read = (live: RunHandle, mapping: TurnMapping, turnId: string): void => {
    void (async () => {
      try {
        for await (const event of live.events) await apply(mapping, turnId, event);
      }
      catch (error) {
        /*
         * A run whose events cannot be read or applied ends its turn: the run
         * is cancelled and the turn, where it is still the running one, ends
         * with `chat/error` in the failure's words, as VS Code's Claude
         * pipeline fails the sends it holds when its loop throws and its host
         * ends a turn whose send failed.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2328-L2349
         */
        live.cancel({ reason: reason(error) });
        if (ctx.active !== undefined && String(ctx.active.id) === turnId) {
          await apply(mapping, turnId, ctx.turnFailure(turnId, 'sendFailed', error)).catch(() => {});
        }
      }
    })();
  };

  /**
   * The run a restart left paused, found as the session opens and left as it
   * is: its turn reads back interrupted and resumable, and a client's resume
   * of that turn is what continues it.
   *
   * A conversation whose newest run already finished, or that the store has
   * never seen, has none: the next turn appends a new run under the same
   * cofold session, which is what continuing a finished conversation means.
   */
  const findPaused = async (): Promise<void> => {
    if (ctx.disposed) return;
    const runs = await store.runs.list({ sessionId });
    const newest = runs[0];
    if (newest === undefined || newest.status !== 'awaiting' || newest.pendingRequestId === undefined) return;
    ctx.paused = { turnId: newest.inputMessageId ?? newest.runId, runId: newest.runId, requestId: newest.pendingRequestId };
  };

  /**
   * Continue the paused run on a client's resume of its turn, as VS Code's
   * provider runs `resumeTurn`.
   *
   * cofold's own `resume()` is the only call that installs a command channel
   * for a paused run, which still holds the session's writer claim. It replays
   * the run's stored events from the one that raised its pending question, so
   * that question reaches every client again by the path that raised it, and
   * the run carries on once somebody answers; what the run said before it
   * paused is the reopened turn's already. Answers whether the turn was the
   * paused run's.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1313-L1314
   */
  const resumePaused = async (turnId: string, mapping: TurnMapping): Promise<boolean> => {
    const paused = ctx.paused;
    if (paused === undefined || paused.turnId !== turnId) return false;
    ctx.paused = undefined;
    const events = await store.runs.listEvents({ sessionId, runId: paused.runId });
    const asked = events.findLast((event) => (event.type === 'approval.requested' || event.type === 'input.requested')
      && event.requestId === paused.requestId);
    const afterSeq = asked === undefined ? (events.at(-1)?.seq ?? 0) : asked.seq - 1;
    const live = resume({ agent: ctx.agentOf(ctx.values), sessionId, runId: paused.runId, afterSeq });
    if (ctx.disposed) {
      live.cancel({ reason: 'the session closed' });
      return true;
    }
    ctx.handle = live;
    read(live, mapping, turnId);
    return true;
  };

  /**
   * Let the paused run go, its writer claim with it, before a new turn runs:
   * a client that sent a message in place of resuming the interrupted turn
   * has left that turn where it ended.
   */
  const dropPaused = async (): Promise<void> => {
    const paused = ctx.paused;
    if (paused === undefined) return;
    ctx.paused = undefined;
    const events = await store.runs.listEvents({ sessionId, runId: paused.runId });
    const live = resume({ agent: ctx.agentOf(ctx.values), sessionId, runId: paused.runId, afterSeq: events.at(-1)?.seq ?? 0 });
    live.cancel({ reason: 'a new message took its place' });
    await live.outcome.catch(() => undefined);
  };

  return {
    apply, read, findPaused, resumePaused, dropPaused,
    /** A request nobody has answered yet is the session waiting on somebody. */
    status: (): number => statusOf({
      waiting: pending.size > 0,
      active: ctx.active !== undefined,
      failed: ctx.error !== undefined,
    }),
  };
};