import { resume } from '@cofold/agents';
import type { RunCommand, RunHandle } from '@cofold/agents';
import type { Bag, Session } from '@ahpd/sdk';
import type { SessionContext } from './context.js';

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});

/** What a person is told the model was told when they turn a tool down. */
const DECLINED = 'The person declined this action';

/**
 * The answers a client sent, in the shape cofold's questions want.
 *
 * AHP carries each answer as `{ state, value: { kind, value } }` and cofold
 * wants the value itself, keyed by question id and a list only where the
 * question allows many. The value sits two levels in, and a value that is
 * already a string or a list is taken as it is, so a caller that hands over
 * cofold's own shape is not unwrapped into nothing.
 */
const answersOf = (answers: Bag): Record<string, string | string[]> => {
  /** One value as cofold reads it, or nothing for a shape it would refuse. */
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
    // cofold's own validation would refuse the whole form for.
    if (one !== undefined) said[id] = one;
  }
  return said;
};

/** What a paused run's answers and stops offer the other areas. */
export interface Pauses {
  owePause: () => void;
  payPause: (didPause: boolean) => void;
  stop: (reason: string) => void;
}

export const createPauses = (
  ctx: SessionContext,
): Pauses & { methods: Pick<Session, 'confirm' | 'answer'> } => {
  const { start, sessionId, pending } = ctx;

  /** Start owing a pause, unless one is already owed. */
  const owePause = (): void => {
    if (ctx.pausing !== undefined) return;
    let resolve: (didPause: boolean) => void = () => {};
    const settled = new Promise<boolean>((done) => { resolve = done; });
    ctx.pausing = { settled, resolve };
  };

  /** Settle the owed pause, if there is one, with whether the run paused. */
  const payPause = (didPause: boolean): void => {
    const owed = ctx.pausing;
    ctx.pausing = undefined;
    owed?.resolve(didPause);
  };

  /**
   * Rejoin a run this process paused, so it can take a command again.
   *
   * cofold's `run()` returns a handle with no command channel; only `resume()`
   * installs one. The sequence the pause ended at is passed so the rejoined
   * stream carries what happens next rather than everything the client has
   * already seen.
   */
  const rejoin = (): RunHandle | undefined => {
    const waiting = ctx.paused;
    const agent = ctx.liveAgent;
    if (waiting === undefined || agent === undefined) return undefined;
    ctx.paused = undefined;
    const rejoined = resume({ agent, sessionId, runId: waiting.runId, afterSeq: waiting.seq });
    ctx.handle = rejoined;
    if (ctx.activeMapping !== undefined) ctx.read(rejoined, ctx.activeMapping, ctx.active === undefined ? waiting.runId : String(ctx.active.id));
    return rejoined;
  };

  /**
   * Send a decision back into the run that is waiting on it.
   *
   * A run that has not paused still holds a live handle and takes the command
   * directly; one that paused is rejoined first, and one that has announced a
   * request but not yet paused is waited for and then rejoined. The answer is
   * fire and forget, the way a steer is: whether it was taken is known here,
   * and a refusal is cofold's to log rather than a turn to fail.
   */
  const route = (command: RunCommand): void => {
    const owed = ctx.pausing;
    if (owed !== undefined && ctx.paused === undefined) {
      void owed.settled.then((didPause) => { if (didPause) route(command); });
      return;
    }
    const live = ctx.paused === undefined ? ctx.handle : rejoin();
    if (live !== undefined) {
      void live.submit(command).catch(() => {});
      return;
    }
    /*
     * An answer can arrive while a resume is still opening.
     *
     * The replay a `start.resume` does announces the request the run is waiting
     * on before it attaches the handle that takes commands - the awaiting
     * `run.finished` it reads is history, not a live pause - so a person
     * answering the moment the form appears would have the decision dropped and
     * the run left waiting for ever. The answer waits for the same opening
     * every turn waits for, then goes to whatever handle that left behind.
     */
    const waiting = ctx.opening;
    if (waiting === undefined) return;
    void waiting.then(() => {
      const later = ctx.paused === undefined ? ctx.handle : rejoin();
      if (later !== undefined) void later.submit(command).catch(() => {});
    }, () => {});
  };

  /**
   * Stop the run, answering anything it is waiting on.
   *
   * A paused run has already closed its handle, so stopping it means
   * rejoining it and cancelling that: cofold's own cancel denies the open
   * request and ends the run, which is the one path that leaves no promise
   * nobody can settle. A run that has announced a request but not yet paused
   * is waited for, and then stopped the same way.
   */
  /** The half of `stop` that needs a handle, once the opening has settled. */
  const stopNow = (reason: string): void => {
    const owed = ctx.pausing;
    if (owed !== undefined && ctx.paused === undefined) {
      void owed.settled.then((didPause) => { if (didPause) stopNow(reason); });
      return;
    }
    if (ctx.paused !== undefined) {
      for (const held of [...pending.values()]) {
        const removal = ctx.activeMapping?.settle(held.requestId);
        if (removal !== undefined) start.emit('session', removal);
      }
      pending.clear();
      const rejoined = rejoin();
      rejoined?.cancel({ reason });
      return;
    }
    ctx.handle?.cancel({ reason });
  };

  const stop = (reason: string): void => {
    /*
     * A client-run call is settled here too, even though a stopped turn's
     * abort means the model will not read the result: the entry must not
     * outlive the turn, or `toolCallOwner` keeps claiming a call that is over
     * and a later answer would settle a promise nobody is waiting on.
     */
    ctx.releaseCalls(reason);
    /*
     * A stop can arrive while a resume is still opening.
     *
     * `active` is rebuilt by the replay before the handle that takes a cancel
     * exists, so a stop in that window would find neither a paused run nor a
     * handle and quietly do nothing. It waits for the same opening every turn
     * waits for and then stops whatever handle that left behind.
     */
    const waiting = ctx.opening;
    if (waiting !== undefined) {
      void waiting.then(() => stopNow(reason), () => stopNow(reason));
      return;
    }
    stopNow(reason);
  };

  return {
    owePause,
    payPause,
    stop,
    methods: {
      /**
       * Answer a tool call the run is waiting on.
       *
       * Found by the call's own id rather than assumed to be the only request:
       * with two open, comparing against whichever was held last is a person
       * pressing Approve and nothing at all happening. The entry leaves by the
       * same id it arrived with, the decision is said back because nothing in a
       * client applies its own dispatch, and the answer goes into the run. An
       * approval that picked `allow-session` is sent with `alwaysApprove`, which
       * cofold keeps for this session and tool.
       */
      confirm: (toolCallId, approved, optionId) => {
        const held = [...pending.values()].find((one) => one.kind === 'approval' && one.callId === toolCallId);
        if (held === undefined) return;
        const picked = held.options?.find((one) => one.id === optionId && one.kind === (approved ? 'approve' : 'deny'));
        /*
         * A decline ends the call without a result, so the file it announced as
         * changing is settled here, where the call id is still known: the run's
         * own `approval.resolved` arrives after this entry is gone, and a run
         * paused on the next question never reaches the end-of-run sweep.
         */
        if (!approved && held.callId !== undefined) ctx.settleEdit(held.callId);
        pending.delete(held.requestId);
        const removal = ctx.activeMapping?.settle(held.requestId);
        if (removal !== undefined) start.emit('session', removal);

        /*
         * The row in this session's own snapshot moves with the decision.
         *
         * Nothing applies what a client dispatched, so a call approved here
         * would stay `pending-confirmation` for anybody who subscribes next.
         */
        const part = (ctx.active?.responseParts as Bag[] | undefined)?.find((one) => one.id === held.callId);
        if (part !== undefined) {
          const call = bag(part.toolCall);
          call.status = approved ? 'running' : 'cancelled';
          if (approved) call.confirmed = 'user-action';
          delete call.options;
          if (picked !== undefined) call.selectedOption = picked;
          part.toolCall = call;
        }
        start.emit('chat', {
          type: 'chat/toolCallConfirmed',
          turnId: ctx.active?.id,
          toolCallId,
          approved,
          ...(approved ? { confirmed: 'user-action' } : { reason: DECLINED }),
          ...(picked === undefined ? {} : { selectedOptionId: picked.id }),
        });
        route(approved
          ? { type: 'approve', requestId: held.requestId, ...(picked?.id === 'allow-session' ? { alwaysApprove: true } : {}) }
          : { type: 'deny', requestId: held.requestId, reason: DECLINED });
        ctx.touch();
      },

      /**
       * Answer a question the run is waiting on.
       *
       * A declined question is a deny rather than an empty answer, because
       * cofold's own validation refuses a form with nothing in it and the model
       * is owed the reason either way. False when the run is not waiting on
       * that request.
       */
      answer: (requestId, accepted, answers) => {
        const held = pending.get(requestId);
        if (held === undefined || held.kind !== 'input') return false;
        pending.delete(requestId);
        const removal = ctx.activeMapping?.settle(requestId);
        if (removal !== undefined) start.emit('session', removal);
        route(accepted
          ? { type: 'answer', requestId, answers: answersOf(answers) }
          : { type: 'deny', requestId, reason: DECLINED });
        ctx.touch();
        return true;
      },
    },
  };
};