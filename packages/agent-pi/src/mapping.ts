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
import { bag, callTimes, startOf, withCallTimes } from '@ahpd/sdk';
import type { PiCall, PiTurn } from './types.js';

/** The part this turn already holds under an id. */
const partOf = (turn: PiTurn, id: string): Bag | undefined => turn.parts.find((held) => held.id === id);

/** A tool call's row, which is where the times are kept between the events. */
const rowOf = (turn: PiTurn, id: string): Bag | undefined => bag(partOf(turn, id)?.toolCall);

/**
 * A call's bag with its start stamped, which is when pi began running it.
 *
 * Written on the row rather than onto the action that announced it, because
 * the model's stream opens a call before pi runs it and the action that
 * carries the times then is the one the hook sends. Answers the bag, for the
 * action that goes out with it.
 */
const stampStart = (row: Bag | undefined, at: number): Bag | undefined => {
  if (row === undefined) return undefined;
  row._meta = withCallTimes(bag(row._meta), callTimes(at));
  return bag(row._meta);
};

/** A call's bag with its end stamped, measured from the start it holds. */
const stampEnd = (row: Bag | undefined, at: number): void => {
  if (row === undefined) return;
  row._meta = withCallTimes(bag(row._meta), callTimes(startOf(row._meta) ?? at, at));
};

/** A call's bag with the times taken off, for a call that never ran. */
export const untime = (row: Bag): Bag => {
  const { 'ahpd.startedAt': _started, 'ahpd.endedAt': _ended, 'ahpd.durationMs': _duration, ...rest } = bag(row._meta);
  row._meta = Object.keys(rest).length > 0 ? rest : undefined;
  return bag(row._meta);
};

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
 * `tool_execution_start` for the same call start one row. `at` is when pi
 * began running the call, and only `tool_execution_start` has one: a call the
 * model named is not running yet.
 */
function startCall(turn: PiTurn, toolCallId: string, toolName: string, at?: number): Bag[] {
  if (turn.calls.has(toolCallId)) return [];
  const call = openCall(turn, toolCallId, toolName);
  const meta = at === undefined ? undefined : stampStart(rowOf(turn, toolCallId), at);
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
    ...(meta === undefined ? {} : { _meta: meta }),
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
    ...(wrote !== undefined ? { _meta: { 'ahpd.cacheWriteTokens': wrote } } : {}),
  };
  return Object.keys(info).length > 0 ? info : undefined;
}

/**
 * One message's usage added to what the turn has used, and the turn's total.
 *
 * A turn's usage is every call it made, so each `message_end` adds to what the
 * earlier ones used rather than replacing it, and the total goes out as it
 * stands: a client watches the number grow through the turn, and it ends as the
 * sum of the calls. The model is the last call's, so a turn that switched models
 * mid-way reports the one it ended on.
 *
 * A call that failed before the provider answered used nothing and leaves the
 * total as it was. A count no call reported is left out rather than sent as a
 * zero, which is the rule `usageOf` keeps for one call.
 *
 * The cost is pi's own `usage.cost`, summed over the calls and priced by pi in
 * dollars. pi prices a call as four parts - the tokens sent as `input`,
 * `cacheRead` and `cacheWrite`, and the tokens received as `output` - and the
 * protocol has one field for each side, so what was sent is those three added
 * together. A part no call sent stays absent rather than being written as a
 * nought, which would be a price pi never gave. The protocol names no field for
 * what a turn cost, so it rides `_meta` beside the cache write.
 */
export function addUsage(total: Bag | undefined, message: AssistantMessage | undefined): Bag | undefined {
  const one = usageOf(message);
  if (one === undefined) return total;
  const held = bag(total);
  const was = bag(held._meta);
  const now = bag(one._meta);
  const sum = (before: unknown, after: unknown): number | undefined => {
    const had = typeof before === 'number' ? before : undefined;
    const got = typeof after === 'number' ? after : undefined;
    return had === undefined && got === undefined ? undefined : (had ?? 0) + (got ?? 0);
  };
  const input = sum(held.inputTokens, one.inputTokens);
  const output = sum(held.outputTokens, one.outputTokens);
  const read = sum(held.cacheReadTokens, one.cacheReadTokens);
  const wrote = sum(was['ahpd.cacheWriteTokens'], now['ahpd.cacheWriteTokens']);
  const price = bag(message?.usage?.cost);
  /** One side of a call, the parts pi priced it in summed; absent if pi gave none of them. */
  const side = (...keys: string[]): number | undefined => {
    let part: number | undefined;
    for (const key of keys) {
      const priced = typeof price[key] === 'number' ? price[key] as number : undefined;
      if (priced !== undefined) part = (part ?? 0) + priced;
    }
    return part;
  };
  const before = bag(was['ahpd.cost']);
  const paid = sum(before.amount, price.total);
  const sent = sum(before.input, side('input', 'cacheRead', 'cacheWrite'));
  const got = sum(before.output, side('output'));
  const meta: Bag = {
    ...(wrote !== undefined ? { 'ahpd.cacheWriteTokens': wrote } : {}),
    ...(paid !== undefined ? {
      'ahpd.cost': {
        amount: paid,
        currency: 'USD',
        ...(sent === undefined ? {} : { input: sent }),
        ...(got === undefined ? {} : { output: got }),
      },
    } : {}),
  };
  return {
    ...(input !== undefined ? { inputTokens: input } : {}),
    ...(output !== undefined ? { outputTokens: output } : {}),
    ...(read !== undefined ? { cacheReadTokens: read } : {}),
    ...(one.model !== undefined
      ? { model: one.model }
      : (held.model !== undefined ? { model: held.model } : {})),
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
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
 *
 * `at` is when the event happened, as epoch milliseconds, and is given only by
 * a replay reading pi's own file: live, an event arrives as it happens and the
 * plugin's clock is the truer time.
 */
export function mapEvent(turn: PiTurn, event: AgentSessionEvent, at?: number): Bag[] {
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
      const when = at ?? Date.now();
      const opened = startCall(turn, event.toolCallId, event.toolName, when);
      const call = turn.calls.get(event.toolCallId);
      if (call !== undefined) call.said = describe(event.toolName, bag(event.args));
      // A row the model's stream opened was announced there, so the start has
      // no action of its own here: it rides on the held row, and the hook's
      // ready carries it when the hook moves that row.
      if (opened.length === 0) stampStart(rowOf(turn, event.toolCallId), when);
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
      const when = at ?? Date.now();
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
        stampEnd(held, when);
      }
      // The whole bag on both, because an action's `_meta` replaces the call's.
      const meta = held._meta === undefined ? {} : { _meta: bag(held._meta) };
      return [...(unreadied ? [{
        type: 'chat/toolCallReady',
        turnId: turn.turnId,
        toolCallId: call.toolCallId,
        invocationMessage: said,
        confirmed: 'not-needed' as const,
        ...(owner !== undefined ? { contributor: { kind: 'client' as const, clientId: owner } } : {}),
        ...meta,
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
        ...meta,
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
