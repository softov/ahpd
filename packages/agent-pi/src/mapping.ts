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
import { appendEscapedMarkdownInlineCode, bag, toolCallDurationMs, truncate, withToolCallDuration } from '@ahpd/sdk';
import type { PiCall, PiTurn } from './types.js';

/** The prose part this turn already holds under its id. */
const partOf = (turn: PiTurn, id: string): Bag | undefined =>
  turn.parts.find((held) => held.kind !== 'toolCall' && held.id === id);

/**
 * The tool call part this turn holds for a call, found by the call's own id.
 *
 * A tool call part is a kind and a call, as the protocol declares one, so the
 * id it is found by is the one on the call.
 */
export const callPartOf = (turn: { parts: Bag[] }, id: string): Bag | undefined =>
  turn.parts.find((held) => held.kind === 'toolCall' && bag(held.toolCall).toolCallId === id);

/** A tool call's row, which is what its start is held by between the events. */
const rowOf = (turn: PiTurn, id: string): Bag | undefined => bag(callPartOf(turn, id)?.toolCall);

/**
 * When pi began running each call, by its row, on this plugin's clock.
 *
 * What the duration said at the call's completion is measured from, on its
 * `_meta` as VS Code's host says it. A call asked about is started again when
 * a person allows it, so the wait is not counted.
 */
const started = new WeakMap<Bag, number>();

/** Hold when pi began running a call, and answer its bag for the action that goes out with it. */
export const stampStart = (row: Bag | undefined, at: number): Bag | undefined => {
  if (row === undefined) return undefined;
  started.set(row, at);
  return row._meta === undefined ? undefined : bag(row._meta);
};

/** Put how long a call ran on its row, measured from the start held for it. */
const stampEnd = (row: Bag | undefined, at: number): void => {
  if (row === undefined) return;
  const meta = withToolCallDuration(row._meta === undefined ? undefined : bag(row._meta), toolCallDurationMs(started.get(row), at));
  if (meta !== undefined) row._meta = meta;
  started.delete(row);
};

/** Forget a call's start, for a call that never ran, and answer its bag. */
export const untime = (row: Bag): Bag | undefined => {
  started.delete(row);
  return row._meta === undefined ? undefined : bag(row._meta);
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
 * The call an event names, with the start that announces it the first time
 * it is seen.
 *
 * Opened here rather than only where the model starts writing the call,
 * because an update or an end for a call whose start was missed is still a
 * call a client should see, and dropping it would leave a turn with a result
 * nothing accounts for. It is announced with `chat/toolCallStart` before the
 * actions that name it, as the ACP mapping announces one, so every action
 * names a call each client holds.
 */
function callOf(turn: PiTurn, toolCallId: string, toolName: string): { call: PiCall; opened: Bag[] } {
  const opened = startCall(turn, toolCallId, toolName);
  return { call: turn.calls.get(toolCallId) as PiCall, opened };
}

/**
 * A new row for a call, in the snapshot.
 *
 * A client's tool is named by the name the client announced, off the
 * `<clientId>__<name>` pi was offered, as VS Code's agents strip their client
 * tool server's prefix, so the row names a tool the client has.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L637-L638
 */
function openCall(turn: PiTurn, toolCallId: string, toolName: string): PiCall {
  const owner = turn.ownerOf?.(toolName);
  const shown = owner !== undefined && toolName.startsWith(`${owner}__`) ? toolName.slice(owner.length + 2) : toolName;
  const call: PiCall = { toolCallId, toolName, displayName: shown };
  turn.calls.set(toolCallId, call);
  const toolKind = owner === undefined ? KINDS[toolName] : undefined;
  turn.parts.push({
    kind: 'toolCall',
    toolCall: {
      toolCallId,
      toolName: shown,
      displayName: shown,
      status: 'streaming',
      ...(owner !== undefined ? { contributor: { kind: 'client', clientId: owner } } : {}),
      ...(toolKind === undefined ? {} : { _meta: { toolKind } }),
    },
  });
  return call;
}

/**
 * The kind a client routes a call of one of pi's tools by, as VS Code's agents
 * stamp `_meta.toolKind` from their harness's own tools: pi's shell is a
 * terminal, its read a read, and grep, find and ls search. A tool this table
 * has not heard of carries no kind.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L662
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexMapAppServerEvents.ts#L652
 */
const KINDS: Readonly<Record<string, string>> = { bash: 'terminal', read: 'read', grep: 'search', find: 'search', ls: 'search' };

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
  const row = rowOf(turn, toolCallId);
  if (at !== undefined) stampStart(row, at);
  const meta = row?._meta === undefined ? undefined : bag(row._meta);
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
    toolName: call.displayName,
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
 * What a finished call did, as VS Code's agents word a call's past tense: a
 * call that failed as failed, a shell command as the first line it ran, and
 * any other call by the line it ran on.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeToolDisplay.ts#L497-L541
 */
export function pastTenseOf(call: PiCall, success: boolean): string | { markdown: string } {
  if (!success) return `"${call.displayName}" failed`;
  const command = call.toolName === 'bash' || call.toolName === 'powershell' ? call.input?.command : undefined;
  const first = typeof command === 'string' && command !== '' ? command.split('\n')[0] : undefined;
  return first === undefined
    ? call.invocationMessage ?? call.displayName
    : { markdown: `Ran ${appendEscapedMarkdownInlineCode(truncate(first, 80))}` };
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
 * own terminal what it is doing.
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
     * are told apart. Each block is opened where it starts, whatever it goes
     * on to hold, as VS Code's Claude mapper opens a part at each content
     * block's start; that keeps a turn's parts in the order pi wrote them.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L593-L605
     */
    case 'message_update': {
      const inner = event.assistantMessageEvent;
      if (inner.type === 'thinking_start') return blockOf(turn, inner.contentIndex, 'reasoning').opened;
      if (inner.type === 'text_start') return blockOf(turn, inner.contentIndex, 'markdown').opened;
      if (inner.type === 'text_delta' || inner.type === 'thinking_delta') {
        const text = inner.type === 'text_delta';
        const delta = inner.delta;
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
      if (call !== undefined) {
        call.input = bag(event.args);
        call.invocationMessage = describe(event.toolName, call.input);
      }
      // A row the model's stream opened was announced there, so the start is
      // held for the row and has no action of its own here.
      if (opened.length === 0) stampStart(rowOf(turn, event.toolCallId), when);
      return opened;
    }

    /** Output while it is still running, which is what a long command gives. */
    case 'tool_execution_update': {
      const { call, opened } = callOf(turn, event.toolCallId, event.toolName);
      const text = resultText(event.partialResult);
      if (text === '') return opened;
      return [...opened, {
        type: 'chat/toolCallContentChanged',
        turnId: turn.turnId,
        toolCallId: call.toolCallId,
        content: [{ type: 'text', text }],
      }];
    }

    /** The row closed, which is the only action carrying a result. */
    case 'tool_execution_end': {
      const when = at ?? Date.now();
      const { call, opened } = callOf(turn, event.toolCallId, event.toolName);
      const success = !event.isError;
      const text = resultText(event.result);
      const held = bag(callPartOf(turn, call.toolCallId)?.toolCall);
      const invocationMessage = call.invocationMessage ?? call.displayName;
      /*
       * A call still `streaming` was never readied: pi failed it before its
       * `tool_call` hook, for a tool it does not have, arguments that do not
       * validate, or an extension that blocked it first. A client completes a
       * call only from `running` or `pending-confirmation`, so it is readied
       * here, or the row would stay open in every client.
       *
       * So is a call refused at its question: a refusal the host makes itself
       * is said to no client, which still holds the call as pi opened it, and
       * the failure pi reports for the block is what ends it for them, as
       * VS Code's agents report the failure their runtime gives a refused
       * call. A client that said the refusal holds the call cancelled, and
       * takes neither.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1727-L1735
       */
      const unreadied = held.status === 'streaming' || held.status === 'cancelled';
      const owner = turn.ownerOf?.(call.toolName);
      const readied: Bag = {
        invocationMessage,
        confirmed: 'not-needed',
        ...(owner !== undefined ? { contributor: { kind: 'client', clientId: owner } } : {}),
      };
      const result: Bag = {
        success,
        pastTenseMessage: pastTenseOf(call, success),
        ...(text === '' ? {} : { content: [{ type: 'text', text }] }),
        ...(success ? {} : { error: { message: text === '' ? 'The tool failed' : text } }),
      };
      /*
       * A call refused at its question is already `cancelled` here. pi reports
       * the block as a failed execution, and a result does not reopen a row
       * somebody answered no to.
       *
       * Otherwise onto the held call and into the actions, from one object
       * each. The protocol's reducer builds a completed call from the running
       * one and the result, and what the call showed while it ran is not
       * carried over, so the held call keeps the result's content and no other.
       */
      if (held.status !== 'cancelled') {
        if (unreadied) Object.assign(held, readied);
        delete held.content;
        Object.assign(held, result, { status: 'completed' });
        stampEnd(held, when);
      }
      // The whole bag on both, because an action's `_meta` replaces the call's.
      const meta = held._meta === undefined ? {} : { _meta: bag(held._meta) };
      return [...opened, ...(unreadied ? [{
        type: 'chat/toolCallReady',
        turnId: turn.turnId,
        toolCallId: call.toolCallId,
        ...readied,
        ...meta,
      }] : []), {
        type: 'chat/toolCallComplete',
        turnId: turn.turnId,
        toolCallId: call.toolCallId,
        result,
        ...meta,
      }];
    }

    /**
     * A shell command's output, arriving on its own event rather than on the
     * tool's. pi raises this for the bash tool while it runs, and the id is
     * the tool call's, so it lands on the row that call already opened. Each
     * chunk is added to the output the call holds and the whole of it is said,
     * since a content change replaces what a call shows, as VS Code's Codex
     * mapping says a command's output.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexMapAppServerEvents.ts#L971-L986
     */
    case 'bash_execution_update': {
      if (event.id === undefined || event.delta === '') return [];
      const call = turn.calls.get(event.id);
      if (call === undefined) return [];
      call.output = (call.output ?? '') + event.delta;
      const content = [{ type: 'text', text: call.output }];
      const row = rowOf(turn, call.toolCallId);
      if (row?.status === 'running') row.content = content;
      return [{
        type: 'chat/toolCallContentChanged',
        turnId: turn.turnId,
        toolCallId: call.toolCallId,
        content,
      }];
    }

    /*
     * Everything else: the retry and summarization events, the queue, the
     * compaction pair, the entries pi appended and the level it is thinking
     * at. Each is either the session's business, handled in `session.ts`
     * where the state it changes lives, or pi narrating to its own terminal.
     */
    default:
      return [];
  }
}
