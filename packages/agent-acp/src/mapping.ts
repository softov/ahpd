/**
 * The one place a `session/update` becomes an AHP `chat/*` action.
 *
 * Every notification a server sends arrives here, and every decision about
 * what it means on the wire is made here, so a change in the ACP update union
 * is one edit in one file. `session.ts` iterates what this returns and sends
 * it; it makes no choices of its own about an update.
 *
 * The protocol requires a part to exist before text streams into it, which is
 * why the session opens the turn's markdown part before the prompt is sent and
 * this file opens a reasoning part the first time the server thinks. An update
 * this bridge does not understand returns nothing rather than throwing, so a
 * 1.5 server does not fail a 1.4 bridge.
 */

import type { ContentBlock, SessionUpdate, ToolCall, ToolCallUpdate } from '@agentclientprotocol/sdk';
import type { Bag } from '@ahpd/sdk';
import type { AcpCall, AcpTurn } from './types.js';

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});

/** The text of a content block, or nothing for a kind this bridge does not carry. */
const textOf = (content: ContentBlock): string | undefined =>
  (content.type === 'text' ? content.text : undefined);

/** The value a `toolInput` carries: the JSON a client reads, or nothing. */
const written = (value: unknown): string | undefined =>
  (value === undefined ? undefined : JSON.stringify(value));

/** The part this turn already holds under an id. */
const partOf = (turn: AcpTurn, id: string): Bag | undefined =>
  turn.parts.find((held) => held.id === id);

/**
 * The tool call an update names, opening the row on the first sight of it.
 *
 * A server may send a `tool_call_update` for a call whose `tool_call` arrived
 * on another connection or was dropped, so the call is created here rather
 * than the update being thrown away. The part is held in the turn's snapshot;
 * `chat/toolCallStart` is what creates it on a client, so no response part is
 * announced for one.
 */
const callOf = (turn: AcpTurn, update: ToolCall | ToolCallUpdate): AcpCall => {
  const known = turn.calls.get(update.toolCallId);
  if (known !== undefined) return known;
  const title = 'title' in update && update.title !== undefined && update.title !== null ? update.title : update.toolCallId;
  const name = 'name' in update && update.name !== undefined && update.name !== null ? update.name : title;
  const call: AcpCall = { toolCallId: update.toolCallId, toolName: name, displayName: title, readied: false };
  turn.calls.set(update.toolCallId, call);
  turn.parts.push({
    id: update.toolCallId,
    kind: 'toolCall',
    toolCall: { toolCallId: update.toolCallId, toolName: name, displayName: title, status: 'streaming' },
  });
  return call;
};

/** The tool-call part held in the snapshot, opened lazily for an update that arrived first. */
const callPartOf = (turn: AcpTurn, callId: string): Bag | undefined =>
  partOf(turn, callId);

/** The text blocks of a tool call's content, in the order the server sent them. */
const contentBlocks = (content: ToolCallUpdate['content']): Bag[] => {
  const blocks: Bag[] = [];
  for (const entry of content ?? []) {
    if (entry.type === 'content' && entry.content.type === 'text') {
      blocks.push({ type: 'text', text: entry.content.text });
    }
  }
  return blocks;
};

/** Everything a tool call's content says, as one string. */
const contentText = (content: ToolCallUpdate['content']): string =>
  contentBlocks(content).map((block) => String(block.text ?? '')).join('\n');

/** One update's actions, in the order they must be sent. */
export function mapUpdate(turn: AcpTurn, update: SessionUpdate): Bag[] {
  switch (update.sessionUpdate) {
    /*
     * Prose and thinking, both appended to a part the caller opened.
     *
     * The part is mutated as well as the action sent, because the session's
     * snapshot is built from the turn's own parts rather than by replaying the
     * actions a client was sent.
     */
    case 'agent_message_chunk': {
      const text = textOf(update.content);
      if (text === undefined) return [];
      const part = partOf(turn, turn.textPartId);
      if (part !== undefined) part.content = `${String(part.content ?? '')}${text}`;
      return [{ type: 'chat/delta', turnId: turn.turnId, partId: turn.textPartId, content: text }];
    }

    case 'agent_thought_chunk': {
      const text = textOf(update.content);
      if (text === undefined) return [];
      const actions: Bag[] = [];
      /*
       * The part is announced once, when it is opened, and every delta after
       * that appends to it. Announcing it again would draw the whole block
       * again in a client that appends on `chat/responsePart`.
       */
      if (turn.reasoningPartId === undefined) {
        const part: Bag = { id: `${turn.turnId}:reasoning`, kind: 'reasoning', content: '' };
        turn.reasoningPartId = String(part.id);
        turn.parts.push(part);
        actions.push({ type: 'chat/responsePart', turnId: turn.turnId, part });
      }
      const part = partOf(turn, turn.reasoningPartId as string);
      if (part !== undefined) part.content = `${String(part.content ?? '')}${text}`;
      actions.push({ type: 'chat/reasoning', turnId: turn.turnId, partId: turn.reasoningPartId, content: text });
      return actions;
    }

    /*
     * A new tool call. The start action creates the row, and the ready action
     * follows it when the server sent the arguments with the call: without a
     * ready action the reducer parks the call in `pending-confirmation`, which
     * is the wrong question for a call nobody has to approve.
     */
    case 'tool_call': {
      const call = callOf(turn, update);
      const actions: Bag[] = [{
        type: 'chat/toolCallStart',
        turnId: turn.turnId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        displayName: call.displayName,
      }];
      const input = written(update.rawInput);
      if (input !== undefined) {
        call.readied = true;
        actions.push({
          type: 'chat/toolCallReady',
          turnId: turn.turnId,
          toolCallId: call.toolCallId,
          invocationMessage: call.displayName,
          confirmed: 'not-needed',
          toolInput: input,
        });
      }
      return actions;
    }

    /*
     * A tool call moving on.
     *
     * A terminal status closes the row with `chat/toolCallComplete`, which is
     * the only action that carries a result. Anything else that brought content
     * replaces what a client shows beside a running call; a status-only update
     * has nothing new to say, because the start action already opened the row.
     */
    case 'tool_call_update': {
      const call = callOf(turn, update);
      if (update.status === 'completed' || update.status === 'failed') {
        const success = update.status === 'completed';
        const text = contentText(update.content);
        const part = callPartOf(turn, call.toolCallId);
        const held = part === undefined ? undefined : bag(part.toolCall);
        if (held !== undefined) {
          held.status = 'completed';
          held.success = success;
          held.pastTenseMessage = call.displayName;
        }
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
      const content = contentBlocks(update.content);
      if (content.length === 0) return [];
      return [{
        type: 'chat/toolCallContentChanged',
        turnId: turn.turnId,
        toolCallId: call.toolCallId,
        content,
      }];
    }

    /*
     * Everything else - a user echo, a plan, a mode or command catalogue, a
     * usage report - is a variant this task does not carry. Nothing is thrown
     * for one, because the union grows with the protocol and a bridge that
     * failed a turn over an update it did not know would be worse than one that
     * ignored it.
     */
    default:
      return [];
  }
}
