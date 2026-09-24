/**
 * The one place a pi event becomes an AHP `chat/*` action.
 *
 * Every decision about what pi's stream means on the wire is made here, so a
 * change in pi's event union is one edit in one file. `session.ts` sends what
 * this returns and makes no choices of its own about an event.
 *
 * Two rules the protocol requires and this file keeps:
 *
 * - A part exists before anything streams into it. The turn's markdown part is
 *   opened with the turn; the reasoning part is opened here, the first time pi
 *   thinks, and announced exactly once.
 * - The snapshot is built from the turn's own parts, so every action that adds
 *   text also appends it to the part. A client that re-subscribes mid-turn is
 *   served the state, not a replay of what the last one was sent.
 *
 * An event this bridge has no action for returns nothing rather than throwing:
 * pi's union grows, and a turn failed over an event nobody mapped would be
 * worse than one that carried on.
 */

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Bag } from '@ahpd/sdk';
import type { PiCall, PiTurn } from './types.js';

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});

/** The part this turn already holds under an id. */
const partOf = (turn: PiTurn, id: string): Bag | undefined => turn.parts.find((held) => held.id === id);

/** Everything a tool result says, as the one string a client shows. */
export function resultText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result === undefined || result === null) return '';
  const held = bag(result);
  if (typeof held.output === 'string') return held.output;
  if (typeof held.text === 'string') return held.text;
  if (Array.isArray(held.content)) {
    return held.content
      .map((one) => (typeof one === 'string' ? one : String(bag(one).text ?? '')))
      .filter((one) => one !== '')
      .join('\n');
  }
  return JSON.stringify(result);
}

/**
 * The call an event names, opening the row the first time it is seen.
 *
 * Opened here rather than only on `tool_execution_start`, because an update or
 * an end for a call whose start was missed is still a call a client should
 * see, and dropping it would leave a turn with a result nothing accounts for.
 */
function callOf(turn: PiTurn, toolCallId: string, toolName: string): PiCall {
  const known = turn.calls.get(toolCallId);
  if (known !== undefined) return known;
  const call: PiCall = { toolCallId, toolName, displayName: toolName };
  turn.calls.set(toolCallId, call);
  turn.parts.push({
    id: toolCallId,
    kind: 'toolCall',
    toolCall: { toolCallId, toolName, displayName: toolName, status: 'streaming' },
  });
  return call;
}

/** Append to a part, and to nothing else: the snapshot is these parts. */
function append(turn: PiTurn, partId: string, text: string): void {
  const part = partOf(turn, partId);
  if (part !== undefined) part.content = `${String(part.content ?? '')}${text}`;
}

/**
 * One event's actions, in the order they must be sent.
 *
 * Returns an empty array for an event that says nothing a client needs, which
 * is most of pi's union: the retry and summarization events are pi telling its
 * own terminal what it is doing, and the activity line carries that better
 * than a turn part would.
 */
export function mapEvent(turn: PiTurn, event: AgentSessionEvent): Bag[] {
  switch (event.type) {
    /*
     * The answer, and the thinking before it.
     *
     * pi streams both as deltas on one assistant message, discriminated by the
     * inner event rather than by the outer one, so this is where the two are
     * told apart.
     */
    case 'message_update': {
      const inner = event.assistantMessageEvent;
      if (inner.type === 'text_delta') {
        if (inner.delta === '') return [];
        append(turn, turn.textPartId, inner.delta);
        return [{ type: 'chat/delta', turnId: turn.turnId, partId: turn.textPartId, content: inner.delta }];
      }
      if (inner.type === 'thinking_delta') {
        if (inner.delta === '') return [];
        const actions: Bag[] = [];
        /*
         * Announced once, on the first thought. Announcing it again would draw
         * the whole block a second time in a client that appends on
         * `chat/responsePart`.
         */
        if (turn.reasoningPartId === undefined) {
          const part: Bag = { id: `${turn.turnId}:reasoning`, kind: 'reasoning', content: '' };
          turn.reasoningPartId = String(part.id);
          turn.parts.push(part);
          actions.push({ type: 'chat/responsePart', turnId: turn.turnId, part });
        }
        append(turn, turn.reasoningPartId as string, inner.delta);
        actions.push({
          type: 'chat/reasoning', turnId: turn.turnId, partId: turn.reasoningPartId, content: inner.delta,
        });
        return actions;
      }
      return [];
    }

    /*
     * A tool about to run.
     *
     * The arguments are already known - pi finished parsing the call before it
     * raised this - so the row is opened and readied in one go. Without the
     * ready action a client parks the call in `pending-confirmation`, which is
     * the wrong question: pi has no built-in permission policy and nobody is
     * being asked anything.
     */
    case 'tool_execution_start': {
      const call = callOf(turn, event.toolCallId, event.toolName);
      const held = bag(partOf(turn, call.toolCallId)?.toolCall);
      held.status = 'running';
      return [
        {
          type: 'chat/toolCallStart',
          turnId: turn.turnId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          displayName: call.displayName,
        },
        {
          type: 'chat/toolCallReady',
          turnId: turn.turnId,
          toolCallId: call.toolCallId,
          invocationMessage: call.displayName,
          confirmed: 'not-needed',
          toolInput: JSON.stringify(event.args ?? {}),
        },
      ];
    }

    /** Output while it is still running, which is what a long command gives. */
    case 'tool_execution_update': {
      const call = callOf(turn, event.toolCallId, event.toolName);
      const text = resultText(event.partialResult);
      if (text === '') return [];
      return [{
        type: 'chat/toolCallContentChanged',
        turnId: turn.turnId,
        toolCallId: call.toolCallId,
        content: [{ type: 'text', text }],
      }];
    }

    /** The row closed, which is the only action carrying a result. */
    case 'tool_execution_end': {
      const call = callOf(turn, event.toolCallId, event.toolName);
      const success = !event.isError;
      const text = resultText(event.result);
      const held = bag(partOf(turn, call.toolCallId)?.toolCall);
      held.status = 'completed';
      held.success = success;
      held.pastTenseMessage = call.displayName;
      return [{
        type: 'chat/toolCallComplete',
        turnId: turn.turnId,
        toolCallId: call.toolCallId,
        result: {
          success,
          pastTenseMessage: call.displayName,
          ...(text === '' ? {} : { content: [{ type: 'text', text }] }),
          ...(success ? {} : { error: { message: text === '' ? 'The tool failed' : text } }),
        },
      }];
    }

    /**
     * A shell command's output, arriving on its own event rather than on the
     * tool's. pi raises this for the bash tool while it runs, and the id is
     * the tool call's, so it lands on the row that call already opened.
     */
    case 'bash_execution_update': {
      if (event.id === undefined || event.delta === '') return [];
      const call = turn.calls.get(event.id);
      if (call === undefined) return [];
      return [{
        type: 'chat/toolCallContentChanged',
        turnId: turn.turnId,
        toolCallId: call.toolCallId,
        content: [{ type: 'text', text: event.delta }],
      }];
    }

    /*
     * Everything else: the retry and summarization events, the queue, the
     * compaction pair, the entries pi appended and the level it is thinking
     * at. Each is either the session's business rather than the turn's -
     * handled in `session.ts`, where the state it changes lives - or pi
     * narrating to its own terminal, which the activity line carries.
     */
    default:
      return [];
  }
}

/** What the session should say it is doing, for an event that changes it. */
export function activityOf(event: AgentSessionEvent): string | undefined | false {
  switch (event.type) {
    case 'agent_start': return 'Thinking';
    case 'tool_execution_start': return `Running ${event.toolName}`;
    case 'tool_execution_end': return 'Thinking';
    case 'compaction_start': return 'Compacting the conversation';
    case 'auto_retry_start': return `Retrying, attempt ${event.attempt} of ${event.maxAttempts}`;
    case 'agent_settled': return undefined;
    // `false` is "this event says nothing about activity", which is not the
    // same answer as `undefined`, which clears it.
    default: return false;
  }
}
