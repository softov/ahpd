/**
 * The one place a pi event becomes an AHP `chat/*` action.
 *
 * Every decision about what pi's stream means on the wire is made here, so a
 * change in pi's event union is one edit in one file. `session.ts` sends what
 * this returns and makes no choices of its own about an event.
 *
 * Two rules the protocol requires and this file keeps:
 *
 * - A part exists before anything streams into it. Each thinking or text
 *   block pi writes is its own part, opened here when the block starts and
 *   announced exactly once, so a turn's parts are in the order pi wrote them.
 *   A text block opens at its first delta holding more than whitespace, so a
 *   block that is only whitespace opens nothing.
 * - The snapshot is built from the turn's own parts, so every action that adds
 *   text also appends it to the part. A client that re-subscribes mid-turn is
 *   served the state, not a replay of what the last one was sent.
 *
 * An event this bridge has no action for returns nothing rather than throwing:
 * pi's union grows, and a turn failed over an event nobody mapped would be
 * worse than one that carried on.
 */

import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage } from '@earendil-works/pi-ai';
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
 * Opened here rather than only where the model starts writing the call,
 * because an update or an end for a call whose start was missed is still a
 * call a client should see, and dropping it would leave a turn with a result
 * nothing accounts for.
 */
function callOf(turn: PiTurn, toolCallId: string, toolName: string): PiCall {
  return turn.calls.get(toolCallId) ?? openCall(turn, toolCallId, toolName);
}

/** A new row for a call, in the snapshot. */
function openCall(turn: PiTurn, toolCallId: string, toolName: string): PiCall {
  const call: PiCall = { toolCallId, toolName, displayName: toolName };
  turn.calls.set(toolCallId, call);
  const owner = turn.ownerOf?.(toolName);
  turn.parts.push({
    id: toolCallId,
    kind: 'toolCall',
    toolCall: {
      toolCallId,
      toolName,
      displayName: toolName,
      status: 'streaming',
      ...(owner !== undefined ? { contributor: { kind: 'client', clientId: owner } } : {}),
    },
  });
  return call;
}

/**
 * A call's row, opened and announced once, whichever event names it first.
 *
 * Nothing for a call already open, so the model's `toolcall_start` and pi's
 * `tool_execution_start` for the same call start one row.
 */
function startCall(turn: PiTurn, toolCallId: string, toolName: string): Bag[] {
  if (turn.calls.has(toolCallId)) return [];
  const call = openCall(turn, toolCallId, toolName);
  /*
   * A client-owned tool is that client's to run, so the call is reported
   * against it and not as the host's own. The host's own tools and pi's
   * built-ins carry nothing.
   */
  const owner = turn.ownerOf?.(call.toolName);
  return [{
    type: 'chat/toolCallStart',
    turnId: turn.turnId,
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    displayName: call.displayName,
    ...(owner !== undefined ? { contributor: { kind: 'client' as const, clientId: owner } } : {}),
  }];
}

/** The key a block is held under: the message and the block's index in it. */
const keyOf = (turn: PiTurn, contentIndex: number): string => `${turn.messages}:${contentIndex}`;

/**
 * The part a thinking or text block streams into, and the action announcing
 * it the first time the block is seen.
 *
 * Keyed by the message and the block's index in it, so a second thought is a
 * part of its own and a block pi raised no start for is still opened before
 * its first delta.
 */
function blockOf(turn: PiTurn, contentIndex: number, kind: 'markdown' | 'reasoning'): { id: string; opened: Bag[] } {
  const key = keyOf(turn, contentIndex);
  const known = turn.blocks.get(key);
  if (known !== undefined) return { id: known, opened: [] };
  const part: Bag = { id: `${turn.turnId}:${key}`, kind, content: '' };
  const id = String(part.id);
  turn.blocks.set(key, id);
  turn.parts.push(part);
  return { id, opened: [{ type: 'chat/responsePart', turnId: turn.turnId, part: { ...part } }] };
}

/** Append to a part, and to nothing else: the snapshot is these parts. */
function append(turn: PiTurn, partId: string, text: string): void {
  const part = partOf(turn, partId);
  if (part !== undefined) part.content = `${String(part.content ?? '')}${text}`;
}

/**
 * What one assistant message used, in the protocol's spelling.
 *
 * The protocol names no field for a cache write, and it is a measurement
 * rather than a guess, so it rides `_meta` as the other sibling's does. A
 * number pi did not report is left out rather than sent as zero.
 */
export function usageOf(message: AssistantMessage | undefined): Bag | undefined {
  const usage = message?.usage;
  if (message === undefined || usage === undefined) return undefined;
  // A call that failed before the provider answered reports every count at
  // zero, and a zero report is not something the turn used.
  if (message.stopReason === 'error'
    && usage.input === 0 && usage.output === 0 && usage.cacheRead === 0 && usage.cacheWrite === 0) {
    return undefined;
  }
  const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
  const wrote = num(usage.cacheWrite);
  const info: Bag = {
    ...(num(usage.input) !== undefined ? { inputTokens: num(usage.input) } : {}),
    ...(num(usage.output) !== undefined ? { outputTokens: num(usage.output) } : {}),
    ...(num(usage.cacheRead) !== undefined ? { cacheReadTokens: num(usage.cacheRead) } : {}),
    ...(message.provider !== undefined && message.model !== undefined
      ? { model: `${message.provider}/${message.model}` }
      : {}),
    ...(wrote !== undefined ? { _meta: { cacheWriteTokens: wrote } } : {}),
  };
  return Object.keys(info).length > 0 ? info : undefined;
}

/**
 * What a call runs on, as its row is titled: the command of `bash` and
 * `powershell`, the path of `read`, `edit` and `write`, the pattern of `grep`
 * and `find`, and the path of `ls`, which is `.` when it names none. Any
 * other tool, or one missing the argument, is titled by its name.
 */
export function describe(name: string, input: Bag): string {
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
  if (name === 'bash' || name === 'powershell') return text(input.command) ?? name;
  if (name === 'read' || name === 'edit' || name === 'write') return text(input.path) ?? name;
  if (name === 'grep' || name === 'find') return text(input.pattern) ?? name;
  if (name === 'ls') return text(input.path) ?? '.';
  return name;
}

/**
 * A call's row, moved as the `tool_call` hook moves it before the tool runs.
 *
 * `extra` is what the hook decided: `confirmed: 'not-needed'` for a call that
 * runs without asking, which leaves it `running`, or a `confirmationTitle` for
 * one a person is asked about, which leaves it `pending-confirmation`.
 */
export function readyRow(row: Bag, displayName: string, input: Bag, extra: Bag): void {
  row.status = extra.confirmed === 'not-needed' ? 'running' : 'pending-confirmation';
  row.invocationMessage = describe(displayName, input);
  row.toolInput = JSON.stringify(input);
  if (extra.confirmationTitle !== undefined) row.confirmationTitle = extra.confirmationTitle;
  if (extra.confirmed !== undefined) row.confirmed = extra.confirmed;
  else delete row.confirmed;
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
    /** A new assistant message, whose blocks are numbered from zero again. */
    case 'message_start': {
      if (event.message.role === 'assistant') turn.messages += 1;
      return [];
    }

    /*
     * The answer, the thinking before it and the calls it asks for.
     *
     * pi streams all three as blocks of one assistant message, discriminated
     * by the inner event rather than by the outer one, so this is where they
     * are told apart. Each block is opened where it starts, a text block at
     * its first words, which is what keeps a turn's parts in the order pi
     * wrote them.
     */
    case 'message_update': {
      const inner = event.assistantMessageEvent;
      if (inner.type === 'thinking_start') return blockOf(turn, inner.contentIndex, 'reasoning').opened;
      if (inner.type === 'text_delta' || inner.type === 'thinking_delta') {
        const text = inner.type === 'text_delta';
        let delta = inner.delta;
        /*
         * A text block's whitespace is held until it writes something else,
         * and then leads the part it opens; a block that is only whitespace,
         * as some models write before a call, opens nothing.
         */
        const key = keyOf(turn, inner.contentIndex);
        if (text && !turn.blocks.has(key)) {
          delta = `${turn.waiting.get(key) ?? ''}${delta}`;
          if (delta.trim() === '') {
            turn.waiting.set(key, delta);
            return [];
          }
          turn.waiting.delete(key);
        }
        const { id, opened } = blockOf(turn, inner.contentIndex, text ? 'markdown' : 'reasoning');
        if (delta === '') return opened;
        append(turn, id, delta);
        /*
         * `chat/delta` appends to a markdown part and `chat/reasoning` to a
         * reasoning one; the protocol's reducer ignores either sent to the
         * other kind.
         */
        return [...opened, {
          type: text ? 'chat/delta' : 'chat/reasoning', turnId: turn.turnId, partId: id, content: delta,
        }];
      }
      /*
       * A call, from the moment the model names it: opened here rather than
       * when pi runs it, which is after the whole message, so its row sits
       * between the blocks written before and after it. A provider that
       * streams the id later names it by the block's end.
       */
      if (inner.type === 'toolcall_start' || inner.type === 'toolcall_delta' || inner.type === 'toolcall_end') {
        const block = bag(inner.type === 'toolcall_end'
          ? inner.toolCall
          : (inner.partial?.content as unknown[] | undefined)?.[inner.contentIndex]);
        const { id, name } = block;
        if (block.type !== 'toolCall' || typeof id !== 'string' || id === ''
          || typeof name !== 'string' || name === '') return [];
        return startCall(turn, id, name);
      }
      return [];
    }

    /*
     * A tool about to run.
     *
     * The row is open already when the model's stream named the call, and is
     * opened here when it did not. pi raises this before its `tool_call` hook,
     * and the session's hook moves the row: a call nobody asks about is
     * readied `not-needed` and one that is asked about is readied
     * `pending-confirmation`, both from the hook, which sees the same id.
     */
    case 'tool_execution_start': {
      const opened = startCall(turn, event.toolCallId, event.toolName);
      const call = turn.calls.get(event.toolCallId);
      if (call !== undefined) call.said = describe(event.toolName, bag(event.args));
      return opened;
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
      const said = call.said ?? call.displayName;
      /*
       * A call still `streaming` was never readied: pi failed it before its
       * `tool_call` hook, for a tool it does not have, arguments that do not
       * validate, or an extension that blocked it first. A client completes a
       * call only from `running` or `pending-confirmation`, so it is readied
       * here, or the row would stay open in every client.
       */
      const unreadied = held.status === 'streaming';
      const owner = turn.ownerOf?.(call.toolName);
      /*
       * A call a person declined is already `cancelled`. pi reports the block
       * as a failed execution, and a result does not reopen a row somebody
       * answered no to.
       */
      if (held.status !== 'cancelled') {
        held.status = 'completed';
        held.success = success;
        held.pastTenseMessage = said;
        if (unreadied) {
          held.invocationMessage = said;
          held.confirmed = 'not-needed';
        }
      }
      return [...(unreadied ? [{
        type: 'chat/toolCallReady',
        turnId: turn.turnId,
        toolCallId: call.toolCallId,
        invocationMessage: said,
        confirmed: 'not-needed' as const,
        ...(owner !== undefined ? { contributor: { kind: 'client' as const, clientId: owner } } : {}),
      }] : []), {
        type: 'chat/toolCallComplete',
        turnId: turn.turnId,
        toolCallId: call.toolCallId,
        result: {
          success,
          pastTenseMessage: said,
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
