/**
 * The one place a `session/update` becomes an AHP `chat/*` action.
 *
 * Every notification a server sends arrives here, and every decision about
 * what it means on the wire is made here, so a change in the ACP update union
 * is one edit in one file. `session.ts` iterates what this returns and sends
 * it; it makes no choices of its own about an update.
 *
 * The protocol requires a part to exist before text streams into it, so this
 * file opens a markdown or reasoning part at the first chunk of each run of
 * that kind, a markdown run at its first chunk holding more than whitespace,
 * and a turn's parts land in the order the server wrote them. An
 * update this bridge does not understand returns nothing rather than
 * throwing, so a 1.5 server does not fail a 1.4 bridge.
 */

import type { ContentBlock, PermissionOption, SessionUpdate, ToolCall, ToolCallUpdate } from '@agentclientprotocol/sdk';
import type { Bag } from '@ahpd/sdk';
import type { AcpCall, AcpTurn, ConfirmationOption } from './types.js';

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
 * The part a chunk of one kind appends to, with the action that announces it
 * when this chunk opens it.
 *
 * ACP chunks carry no block index, so a run is what the order says: the part
 * last opened in the turn takes the chunk when it is of the same kind and
 * `continues`, and a chunk of the other kind, one after a tool call, or one
 * after a run of held whitespace, opens a new part. Its id is the turn's and
 * its position in the turn, which no later part changes.
 */
const runOf = (turn: AcpTurn, kind: 'markdown' | 'reasoning', continues: boolean): { part: Bag; opened?: Bag } => {
  const last = turn.parts.at(-1);
  if (continues && last !== undefined && last.kind === kind) return { part: last };
  const part: Bag = { id: `${turn.turnId}:${turn.parts.length}`, kind, content: '' };
  turn.parts.push(part);
  return { part, opened: { type: 'chat/responsePart', turnId: turn.turnId, part: { ...part } } };
};

/**
 * One chunk's actions: its part's announcement when it opens one, then the text.
 *
 * A run of message chunks is held while it is only whitespace and leads the
 * part it opens once a chunk writes something else, so a message that is only
 * whitespace, as some models write before a call, opens nothing and takes no
 * position in the turn.
 */
const chunk = (turn: AcpTurn, kind: 'markdown' | 'reasoning', written: string): Bag[] => {
  const held = turn.waiting;
  delete turn.waiting;
  let text = written;
  if (kind === 'markdown' && turn.parts.at(-1)?.kind !== 'markdown') {
    text = `${held ?? ''}${written}`;
    if (text.trim() === '') {
      turn.waiting = text;
      return [];
    }
  }
  const { part, opened } = runOf(turn, kind, held === undefined);
  part.content = `${String(part.content ?? '')}${text}`;
  const type = kind === 'markdown' ? 'chat/delta' : 'chat/reasoning';
  const streamed: Bag = { type, turnId: turn.turnId, partId: part.id, content: text };
  return opened === undefined ? [streamed] : [opened, streamed];
};

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
  // A call ends the run of message chunks before it, held whitespace and all.
  delete turn.waiting;
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
     * Prose and thinking, each appended to the run it continues.
     *
     * The part is mutated as well as the action sent, because the session's
     * snapshot is built from the turn's own parts rather than by replaying the
     * actions a client was sent. The part is announced once, when it is
     * opened, as a copy: the held part keeps growing, and announcing it again
     * would draw the whole block again in a client that appends on
     * `chat/responsePart`.
     */
    case 'agent_message_chunk': {
      const text = textOf(update.content);
      return text === undefined ? [] : chunk(turn, 'markdown', text);
    }

    case 'agent_thought_chunk': {
      const text = textOf(update.content);
      return text === undefined ? [] : chunk(turn, 'reasoning', text);
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
     * What the agent has spent, as the turn's cost so far.
     *
     * ACP counts no tokens here: `used` and `size` are the context window and
     * not what the turn spent, so what this update does report is its cost -
     * cumulative for the whole session rather than for the turn, which makes
     * what the turn spent the change since it opened.
     *
     * Sent as it stands rather than as the difference between two reports,
     * because the protocol replaces the active turn's usage on each
     * `chat/usage` instead of adding to it: a client watches the number grow
     * through the turn, as it does with the other backends. A server that
     * sends no cost has reported nothing here, so nothing is sent.
     */
    case 'usage_update': {
      const cost = update.cost;
      if (cost === undefined || cost === null || typeof cost.amount !== 'number') return [];
      turn.cost = { amount: cost.amount, currency: cost.currency };
      return [{
        type: 'chat/usage',
        turnId: turn.turnId,
        usage: {
          _meta: { cost: { amount: cost.amount - (turn.costAtStart ?? 0), currency: cost.currency } },
        },
      }];
    }

    /*
     * Everything else - a user echo, a plan, a mode or command catalogue - is a
     * variant this task does not carry. Nothing is thrown for one, because the
     * union grows with the protocol and a bridge that failed a turn over an
     * update it did not know would be worse than one that ignored it.
     */
    default:
      return [];
  }
}

/**
 * A permission request's options, as the choices a call offers a person.
 *
 * The approvals first and then the refusals, each in the server's order, so
 * a client that draws them in order draws them grouped. A kind this bridge
 * does not know is left out rather than guessed at.
 */
export function confirmationOptions(options: readonly PermissionOption[]): ConfirmationOption[] {
  const of = (kind: 'approve' | 'deny', group: number, kinds: string[]): ConfirmationOption[] => options
    .filter((one) => kinds.includes(one.kind))
    .map((one) => ({ id: one.optionId, label: one.name, kind, group }));
  return [...of('approve', 1, ['allow_once', 'allow_always']), ...of('deny', 2, ['reject_once', 'reject_always'])];
}
