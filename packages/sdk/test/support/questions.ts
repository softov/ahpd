import { echo } from '../../../../examples/echo/agent.js';
import type { Agent, Start } from '../../src/types/agent.js';
import type { Bag } from '../../src/types/common.js';
import type { Session } from '../../src/types/session.js';

/**
 * A backend that puts one question in the next turn it is sent, with what the
 * case says for the host's decision beside it, and keeps every answer the host
 * hands it.
 *
 * The host decides a question with its approval chain as VS Code's host
 * decides a pending confirmation, so the chain is read from outside, as a
 * window reads it: the question the host said, with its options, or the
 * answer it gave the backend without saying one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1684-L1766
 */
export function questioning(path: string, over: Partial<Agent> = {}) {
  const base = echo({ path, pace: 0 });
  const answers = new Map<string, boolean>();
  let next: { tool: string; asked: Bag } | undefined;
  const agent: Agent = {
    ...base,
    provider: 'echo',
    displayName: 'Echo backend',
    ...over,
    create: (given: Start) => {
      const session = base.create(given) as Session;
      return {
        ...session,
        // The question first, while the turn runs: the echo backend, unpaced,
        // ends its turn before its send returns.
        sendMessage: (...args: Parameters<Session['sendMessage']>) => {
          const question = next;
          next = undefined;
          if (question !== undefined) {
            const turnId = args[0];
            const toolCallId = `call-${turnId}`;
            given.emit('chat', { type: 'chat/toolCallStart', turnId, toolCallId, toolName: question.tool, displayName: question.tool });
            given.emit('chat', {
              type: 'chat/toolCallReady', turnId, toolCallId, invocationMessage: `Run ${question.tool}`, confirmationTitle: `Run ${question.tool}?`, ...question.asked,
            });
          }
          session.sendMessage(...args);
        },
        confirm: (toolCallId: string, approved: boolean) => {
          answers.set(toolCallId, approved);
          return true;
        },
      };
    },
  };
  return {
    agent,
    /** Put this question, about a call of `tool`, in the next turn the backend is sent. */
    ask: (tool: string, asked: Bag): void => { next = { tool, asked }; },
    /** The answer the host handed the backend for the call a turn asked about. */
    answerOf: (turnId: string): boolean | undefined => answers.get(`call-${turnId}`),
  };
}

/** The question a window was said for the call a turn asked about, from what its connection heard. */
export const questionOf = (notes: readonly { method: string; params: unknown }[], turnId: string): Bag | undefined => notes
  .filter((note) => note.method === 'action')
  .map((note) => (note.params as { action: Bag }).action)
  .find((action) => action.type === 'chat/toolCallReady' && action.toolCallId === `call-${turnId}` && action.confirmationTitle !== undefined);
