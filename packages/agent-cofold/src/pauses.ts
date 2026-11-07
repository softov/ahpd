import type { RunCommand } from '@cofold/agents';
import { bag } from '@ahpd/sdk';
import type { Bag, Session } from '@ahpd/sdk';
import type { SessionContext } from './context.js';

/**
 * The answers a client sent, in the shape cofold's questions want.
 *
 * AHP carries each answer as `{ state, value: { kind, value } }` and cofold
 * wants the value itself, keyed by question id and a list only where the
 * question allows many. The value sits two levels in, and a value that is
 * already a string or a list is taken as it is, so a caller that hands over
 * cofold's own shape is not unwrapped into nothing.
 *
 * The words a person typed beside the choices, or instead of them, go with
 * the answer, as VS Code's Claude agent hands them on: after a single choice,
 * joined with it, as the answer where nothing was chosen, and in a list beside
 * the choices.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeInteractiveTools.ts#L133-L156
 */
const answersOf = (given: Bag): Record<string, string | string[]> => {
  /** One value as cofold reads it, or nothing for a shape it would refuse. */
  const valueOf = (value: unknown): string | string[] | undefined => {
    const strings = (list: unknown[]): string[] => list.filter((one): one is string => typeof one === 'string');
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return strings(value);
    const answer = bag(value);
    const inner = bag(answer.value);
    const raw = inner.value ?? answer.value;
    const typed = Array.isArray(inner.freeformValues) ? strings(inner.freeformValues) : [];
    if (Array.isArray(raw)) return [...strings(raw), ...typed];
    if (typeof raw === 'string') return typed.length === 0 ? raw : [raw, ...typed].filter((one) => one !== '').join(', ');
    return typed.length === 0 ? undefined : typed.join(', ');
  };
  const answers: Record<string, string | string[]> = {};
  for (const [id, value] of Object.entries(given)) {
    const one = valueOf(value);
    // A skipped or shapeless answer is left out rather than sent empty, which
    // cofold's own validation would refuse the whole form for.
    if (one !== undefined) answers[id] = one;
  }
  return answers;
};

/** What a stopped turn offers the other areas. */
export interface Pauses {
  /** Stop the running turn's run, settling what it waits on, as VS Code's agent aborts a turn. */
  abort: (reason: string) => void;
}

export const createPauses = (
  ctx: SessionContext,
): Pauses & { methods: Pick<Session, 'confirm' | 'answer'> } => {
  const { pending } = ctx;

  /**
   * Send a decision back into the run that is waiting on it.
   *
   * The handle a run was started or resumed with stays open across its own
   * pause and takes the answer, so there is one place a decision goes: the
   * handle this process holds. The answer is fire and forget, the way a steer
   * is: whether a turn was waiting is known here, and a refusal is cofold's to
   * log rather than a turn to fail - a closed handle throws `not_running`.
   */
  const route = (command: RunCommand): void => {
    const live = ctx.handle;
    if (live !== undefined) {
      void live.submit(command).catch(() => {});
      return;
    }
    /*
     * An answer can arrive while a resume is still opening.
     *
     * The replay a `start.resume` does announces the request the run is waiting
     * on before it attaches the handle that takes commands, so a person
     * answering the moment the form appears would have the decision dropped and
     * the run left waiting for ever. The answer waits for the same opening
     * every turn waits for, then goes to whatever handle that left behind.
     */
    const waiting = ctx.opening;
    if (waiting === undefined) return;
    void waiting.then(() => {
      const later = ctx.handle;
      if (later !== undefined) void later.submit(command).catch(() => {});
    }, () => {});
  };

  /**
   * Stop the run, answering anything it is waiting on.
   *
   * Every held entry is settled first, so the session stops reporting
   * `InputNeeded` the moment it is stopped rather than when the run's own
   * resolution arrives. The cancel is what answers an open request - with
   * "The turn was stopped" - and ends the run cancelled, whether the run was
   * working or waiting on a person: one handle serves both.
   */
  const abortNow = (reason: string): void => {
    // The entries follow the chat's state: the turn's end takes down every
    // entry of the chat that no longer stands.
    for (const held of [...pending.values()]) ctx.activeMapping?.settle(held.requestId);
    pending.clear();
    ctx.handle?.cancel({ reason });
  };

  const abort = (reason: string): void => {
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
     * exists, so a stop in that window would find no handle and quietly do
     * nothing. It waits for the same opening every turn waits for and then
     * stops whatever handle that left behind.
     */
    const opening = ctx.opening;
    if (opening !== undefined) {
      void opening.then(() => abortNow(reason), () => abortNow(reason));
      return;
    }
    abortNow(reason);
  };

  return {
    abort,
    methods: {
      /**
       * Answer a tool call the run is waiting on, with the host's answer, a
       * person's or its own.
       *
       * Found by the call's own id rather than assumed to be the only request:
       * with two open, comparing against whichever was held last is a person
       * pressing Approve and nothing at all happening. The host has said the
       * client's confirmation; the entry leaves by the same id it arrived with,
       * and the answer goes into the run, for this call alone whatever the
       * host keeps of it, as VS Code's agents answer their runtimes once.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L8640
       */
      confirm: (toolCallId, approved) => {
        const held = [...pending.values()].find((one) => one.kind === 'approval' && one.callId === toolCallId);
        if (held === undefined) return false;
        /*
         * A decline ends the call without a result, so the file it announced as
         * changing is settled here, where the call id is still known: the run's
         * own `approval.resolved` arrives after this entry is gone, and a run
         * paused on the next question never reaches the end-of-run sweep.
         */
        if (!approved && held.callId !== undefined) ctx.settleEdit(held.callId);
        pending.delete(held.requestId);
        // The entry follows the chat's state: the host took it down when it
        // said the confirmation that moved the call.
        ctx.activeMapping?.settle(held.requestId);

        /*
         * The row in this session's own snapshot moves with the decision, as
         * the protocol's reducer moves it: running when approved, and cancelled
         * as `denied` when refused, the reason its cancelled state carries.
         *
         * Nothing applies what a client dispatched, so a call approved here
         * would stay `pending-confirmation` for anybody who subscribes next.
         * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L599-L629
         */
        const part = (ctx.active?.responseParts as Bag[] | undefined)
          ?.find((one) => one.kind === 'toolCall' && bag(one.toolCall).toolCallId === held.callId);
        if (part !== undefined) {
          const call = bag(part.toolCall);
          call.status = approved ? 'running' : 'cancelled';
          if (approved) call.confirmed = 'user-action';
          else call.reason = 'denied';
          part.toolCall = call;
        }
        /*
         * A refusal goes to cofold with no reason, as cofold's own app denies
         * one the person gave none for, and cofold tells the model its own
         * words, "Denied by the user".
         * https://github.com/softov/cofold/blob/ee4819644696b88e83e63c56ed7bdf426d32cfb9/packages/papo/src/chat.ts#L544
         * https://github.com/softov/cofold/blob/ee4819644696b88e83e63c56ed7bdf426d32cfb9/packages/agents/src/run/turn.ts#L405
         */
        route(approved ? { type: 'approve', requestId: held.requestId } : { type: 'deny', requestId: held.requestId });
        return true;
      },

      /**
       * Answer a question the run is waiting on.
       *
       * A declined question is a deny, because cofold's own validation refuses
       * a form with nothing in it, sent with no reason as a refused call is.
       * False when the run is not waiting on that request.
       */
      answer: (requestId, accepted, answers) => {
        const held = pending.get(requestId);
        if (held === undefined || held.kind !== 'input') return false;
        pending.delete(requestId);
        // The entry follows the chat's state: the host took it down when it
        // said the completion that answered the request.
        ctx.activeMapping?.settle(requestId);
        route(accepted
          ? { type: 'answer', requestId, answers: answersOf(answers) }
          : { type: 'deny', requestId });
        return true;
      },
    },
  };
};