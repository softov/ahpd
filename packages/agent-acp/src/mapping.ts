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

import type { ContentBlock, Diff, PermissionOption, PlanEntry, SessionUpdate, ToolCall, ToolCallStatus, ToolCallUpdate } from '@agentclientprotocol/sdk';
import { bag, callTimes, uriOf, withCallTimes } from '@ahpd/sdk';
import type { Bag } from '@ahpd/sdk';
import type { AcpCall, AcpTurn, ConfirmationOption } from './types.js';

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
 * The id of the turn's plan call.
 *
 * Named rather than numbered, because a turn keeps one plan for as long as the
 * agent sends plans and a second one would have to be told apart from it.
 */
const planId = (turnId: string): string => `${turnId}:plan`;

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
  const named = 'name' in update && update.name !== undefined && update.name !== null ? update.name : undefined;
  const name = named ?? title;
  /*
   * Which client's tool this is, read off what the agent reported. The name it
   * gave is what it called, so it is read before the title: a title that spells
   * some other client's tool is not what the agent said it reached for.
   */
  const owner = turn.ownerOf?.(named, title);
  const call: AcpCall = {
    toolCallId: update.toolCallId,
    toolName: name,
    displayName: title,
    readied: false,
    asked: false,
    ...(owner === undefined ? {} : { owner }),
  };
  turn.calls.set(update.toolCallId, call);
  // A call ends the run of message chunks before it, held whitespace and all.
  delete turn.waiting;
  turn.parts.push({
    id: update.toolCallId,
    kind: 'toolCall',
    toolCall: {
      toolCallId: update.toolCallId,
      toolName: name,
      displayName: title,
      status: 'streaming',
      ...contributorOf(call),
    },
  });
  return call;
};

/**
 * The contributor an action about a call carries, when a client owns its tool.
 *
 * The protocol ignores a client contributor that arrives after the start of the
 * call, so a backend that means one has to say it on the start and on
 * everything after it. Nothing for a call nobody owns, which carries no
 * `contributor` key at all.
 */
const contributorOf = (call: AcpCall): Bag =>
  (call.owner === undefined ? {} : { contributor: { kind: 'client', clientId: call.owner } });

/**
 * Whether the agent has moved the call off `pending`.
 *
 * `pending` is the agent's own word for a call it has not started, and a ready
 * carrying `not-needed` is a statement that nobody is going to be asked about
 * it - so it waits until the agent has said the call is running. A call that
 * arrives already finished has left it too.
 */
const started = (status: ToolCallStatus | null | undefined): boolean =>
  status !== undefined && status !== null && status !== 'pending';

/**
 * The arguments an update carried, kept on the call.
 *
 * A call announced `pending` is often given its arguments on that same
 * announcement, and the update that starts it afterwards carries a status
 * alone - so the ready that follows takes what the call holds rather than what
 * this one update happened to carry.
 */
const inputOf = (call: AcpCall, update: ToolCall | ToolCallUpdate): string | undefined => {
  const input = written(update.rawInput);
  if (input !== undefined) call.input = input;
  return input;
};

/**
 * Whether a ready saying nobody is going to be asked may go out now.
 *
 * Not for a call a person is being asked about: its question is the ready, and
 * one behind that says the question is not there.
 */
const mayReady = (call: AcpCall): boolean => started(call.status) && !call.asked;

/**
 * The action that moves a call on, once the agent has started it.
 *
 * Sent twice at most for one call: once when the status first left `pending`,
 * and again for a `rawInput` that arrived after, because the ready action is
 * where the arguments a client shows come from.
 */
const ready = (turn: AcpTurn, call: AcpCall, input: string | undefined): Bag => {
  call.readied = true;
  return {
    type: 'chat/toolCallReady',
    turnId: turn.turnId,
    toolCallId: call.toolCallId,
    invocationMessage: call.displayName,
    confirmed: 'not-needed',
    ...(input === undefined ? {} : { toolInput: input }),
    ...contributorOf(call),
    ...metaOf(turn, call),
  };
};

/**
 * The ready that says a call is running, and the ask that goes with it.
 *
 * A call a client owns is that client's to run, so the entry asking it is
 * raised here, at the one ready that says the agent has started the call -
 * never at `pending`, which is the agent saying it has not. A call that arrives
 * already finished is nobody's to run and asks nobody.
 */
const running = (turn: AcpTurn, call: AcpCall, input: string | undefined): Bag[] => {
  const finished = call.status === 'completed' || call.status === 'failed';
  if (call.owner !== undefined && !finished) turn.onRunning?.(call);
  return [ready(turn, call, input)];
};

/**
 * The tool-call part held in the snapshot, opened lazily for an update that arrived first.
 */
const callPartOf = (turn: AcpTurn, callId: string): Bag | undefined =>
  partOf(turn, callId);

/**
 * A call's times, as the `_meta` an action about it carries.
 *
 * The start is the receive time of the first update about the call and the end
 * the receive time of the one that finished it, both on this plugin's clock:
 * ACP carries no time of its own. An action's `_meta` replaces the call's whole
 * bag, so every action sent after the start carries them again.
 */
const metaOf = (turn: AcpTurn, call: AcpCall): Bag => {
  const held = callPartOf(turn, call.toolCallId);
  if (held === undefined) return {};
  const meta = bag(bag(held.toolCall)._meta);
  return Object.keys(meta).length === 0 ? {} : { _meta: meta };
};

/**
 * The start a call's first update about it gives it.
 *
 * The first word about a call is what starts it, whichever update that is: a
 * `tool_call` holding the agent still deciding has started it, and so has the
 * `tool_call_update` of a call whose `tool_call` went missing. A row a
 * permission request opened is no different, and the request itself stamps
 * nothing. A call that arrives already finished is stamped twice over by the
 * one update that carries both.
 */
const stampStart = (turn: AcpTurn, call: AcpCall, at?: number): void => {
  if (at === undefined || call.startedAt !== undefined) return;
  call.startedAt = at;
  const held = bag(callPartOf(turn, call.toolCallId)?.toolCall);
  held._meta = withCallTimes(bag(held._meta), callTimes(at));
};

/**
 * The end a call's finishing update gives it, kept beside the start.
 */
const stampEnd = (turn: AcpTurn, call: AcpCall, at?: number): void => {
  if (at === undefined) return;
  const held = bag(callPartOf(turn, call.toolCallId)?.toolCall);
  held._meta = withCallTimes(bag(held._meta), callTimes(call.startedAt ?? at, at));
};

/**
 * The actions that open a call's row, for an update that is the first word
 * about it.
 *
 * A server may send the first thing a client hears about a call as the update
 * that finishes it, and a row that is closed without ever being opened is a
 * completion for a call nobody drew.
 */
const opened = (turn: AcpTurn, call: AcpCall): Bag[] => [{
  type: 'chat/toolCallStart',
  turnId: turn.turnId,
  toolCallId: call.toolCallId,
  toolName: call.toolName,
  displayName: call.displayName,
  ...contributorOf(call),
  ...metaOf(turn, call),
}];

/**
 * The actions that close a call, whichever update finished it.
 *
 * A server may announce a call and finish it in one update, so a `tool_call`
 * lands here as well as a `tool_call_update`: a row closed without ever being
 * opened is a completion for a call nobody drew.
 */
const closed = (turn: AcpTurn, call: AcpCall, content: Bag[], actions: Bag[], at?: number): Bag[] => {
  stampEnd(turn, call, at);
  const success = call.status === 'completed';
  const part = callPartOf(turn, call.toolCallId);
  const held = part === undefined ? undefined : bag(part.toolCall);
  if (held !== undefined) {
    held.status = 'completed';
    held.success = success;
    held.pastTenseMessage = call.displayName;
  }
  const text = contentText(content);
  return [...actions, {
    type: 'chat/toolCallComplete',
    turnId: turn.turnId,
    toolCallId: call.toolCallId,
    result: {
      success,
      pastTenseMessage: call.displayName,
      ...(content.length === 0 ? {} : { content }),
      ...(success ? {} : { error: { message: text === '' ? 'The tool failed' : text } }),
    },
    ...metaOf(turn, call),
  }];
};

/**
 * The actions that replace what a client shows beside a call still running.
 *
 * An update carrying a status alone carries nothing to replace, and a client
 * given an empty content change would draw an empty call.
 */
const shown = (turn: AcpTurn, call: AcpCall, content: Bag[], actions: Bag[]): Bag[] =>
  content.length === 0 ? actions : [...actions, {
    type: 'chat/toolCallContentChanged',
    turnId: turn.turnId,
    toolCallId: call.toolCallId,
    content,
    ...metaOf(turn, call),
  }];

/** A call's content, as the actions that carry it on whichever update brought it. */
const drawn = (turn: AcpTurn, call: AcpCall, content: Bag[], actions: Bag[], at?: number): Bag[] =>
  call.status === 'completed' || call.status === 'failed' ? closed(turn, call, content, actions, at) : shown(turn, call, content, actions);

/** The content a call's held part carries, which is what its completion repeats. */
const heldContent = (part: Bag | undefined): Bag[] => {
  const content = part === undefined ? undefined : bag(part.toolCall).content;
  return Array.isArray(content) ? content as Bag[] : [];
};

/**
 * One diff, as the file edit a client draws and as an entry in the changeset.
 *
 * Only the `after` side goes in the block: no `file://` URI addresses what a
 * file used to be, and the diff's own `oldText` is what the turn's review holds
 * as the before side. A file with no `oldText` is one the agent created. A
 * diff of a path outside the session's own directories is shown and not
 * recorded - it is something the agent says it did somewhere this session was
 * never given.
 */
const fileEdit = (turn: AcpTurn, diff: Diff): Bag => {
  const uri = uriOf(diff.path);
  if (turn.reach !== undefined && turn.reach.within(diff.path)) {
    turn.reach.changed(diff.path, diff.oldText ?? undefined);
  }
  return { type: 'fileEdit', after: { uri, content: { uri } } };
};

/**
 * A call's content, as the blocks a client shows beside it.
 *
 * A terminal id is already a host terminal URI, because the bridge opened the
 * shell through the host, so the block is the one `runCommand` builds.
 */
const contentBlocks = (turn: AcpTurn, content: ToolCallUpdate['content']): Bag[] => {
  const blocks: Bag[] = [];
  for (const entry of content ?? []) {
    if (entry.type === 'content' && entry.content.type === 'text') {
      blocks.push({ type: 'text', text: entry.content.text });
    } else if (entry.type === 'terminal') {
      blocks.push({ type: 'terminal', resource: entry.terminalId, title: 'Terminal', isPty: false });
    } else if (entry.type === 'diff') {
      blocks.push(fileEdit(turn, entry));
    }
  }
  return blocks;
};

/** What a call's content says in words, which is all a failure carries. */
const contentText = (blocks: Bag[]): string =>
  blocks.filter((block) => block.type === 'text').map((block) => String(block.text ?? '')).join('\n');

/**
 * One plan entry, as a line of the plan.
 *
 * A checkbox says whether the entry is done, and the status is written out
 * where a checkbox cannot say it, because an entry that is running is not an
 * entry that is waiting either.
 */
const entryLine = (entry: PlanEntry): string => {
  const done = entry.status === 'completed';
  const where = done || entry.status === 'pending' ? '' : ` (${entry.status})`;
  return `- [${done ? 'x' : ' '}] ${entry.content}${where}`;
};

/**
 * The turn's one plan, as the call that holds it.
 *
 * A plan is something the agent writes rather than streams, so it is a call:
 * one for the whole turn, opened by the first plan and rewritten by every one
 * after it. The protocol sends the whole list each time rather than a change to
 * it, so there is nothing to append and each update replaces what the call
 * shows - an update carrying no entries replacing it with nothing. Nothing in
 * the protocol says when the agent has finished writing a plan, so the call is
 * completed by the turn ending, with the last plan as its result.
 */
const plan = (turn: AcpTurn, entries: PlanEntry[]): Bag[] => {
  const call = callOf(turn, { toolCallId: planId(turn.turnId), title: 'Plan', name: 'plan' });
  const first = call.readied === false;
  call.status = 'in_progress';
  const content: Bag[] = entries.map((entry) => ({ type: 'text', text: entryLine(entry) }));
  bag(callPartOf(turn, call.toolCallId)?.toolCall).content = content;
  return [
    // The row, and the ready that says nobody is ever going to be asked about
    // a plan - a question is a question about a tool, and a plan is not one.
    ...(first ? opened(turn, call) : []),
    ...(first ? [ready(turn, call, undefined)] : []),
    { type: 'chat/toolCallContentChanged', turnId: turn.turnId, toolCallId: call.toolCallId, content },
  ];
};

/**
 * The turn's plan, completed as the turn ends.
 *
 * A plan is the one row the protocol never closes itself, so the turn ending is
 * what closes it - with the last plan the agent wrote as what it returned.
 */
export function closePlan(turn: AcpTurn): Bag[] {
  const call = turn.calls.get(planId(turn.turnId));
  if (call === undefined) return [];
  call.status = 'completed';
  return closed(turn, call, heldContent(callPartOf(turn, call.toolCallId)), []);
}

/**
 * One update's actions, in the order they must be sent.
 *
 * `at` is the time the update was received, and only the tool cases stamp from
 * it: a call's times are when this plugin heard about it, and an update that
 * carries no time of its own - one a `session/load` replayed - leaves the calls
 * it mentions untimed rather than timing them with the replay's own clock.
 */
export function mapUpdate(turn: AcpTurn, update: SessionUpdate, at?: number): Bag[] {
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
     * follows it once the agent has started the call: a ready carrying
     * `not-needed` says nobody is going to be asked about it, which is a claim
     * the bridge cannot make while the agent is still holding the call. A call
     * that arrives already finished is opened and completed at once.
     */
    case 'tool_call': {
      const call = callOf(turn, update);
      call.status = update.status ?? 'pending';
      stampStart(turn, call, at);
      const actions = opened(turn, call);
      inputOf(call, update);
      if (mayReady(call)) actions.push(...running(turn, call, call.input));
      return drawn(turn, call, contentBlocks(turn, update.content), actions, at);
    }

    /*
     * A tool call moving on.
     *
     * A terminal status closes the row with `chat/toolCallComplete`, which is
     * the only action that carries a result. Anything else that brought content
     * replaces what a client shows beside a running call.
     */
    case 'tool_call_update': {
      const known = turn.calls.has(update.toolCallId);
      const call = callOf(turn, update);
      if (update.status !== undefined && update.status !== null) call.status = update.status;
      const input = inputOf(call, update);
      stampStart(turn, call, at);
      const actions = known ? [] : opened(turn, call);
      // A second ready goes out for arguments that arrived after the first, so
      // what a client shows is the arguments the agent last wrote down.
      if (mayReady(call) && (!call.readied || input !== undefined)) actions.push(...running(turn, call, call.input));
      return drawn(turn, call, contentBlocks(turn, update.content), actions, at);
    }

    /*
     * What the agent has spent, and how full its context is.
     *
     * ACP counts no tokens per call: `used` and `size` are the context window
     * and not what the turn spent, so both go in `_meta` where a client reads
     * them as what they are. What this reports as the turn's usage is its cost
     * - cumulative for the whole session rather than for the turn, which makes
     * what the turn spent the change since it opened.
     *
     * Sent as it stands rather than as the difference between two reports,
     * because the protocol replaces the active turn's usage on each
     * `chat/usage` instead of adding to it: a client watches the number grow
     * through the turn, as it does with the other backends.
     */
    case 'usage_update': {
      const _meta: Bag = { 'ahpd.context': { used: update.used, size: update.size } };
      const cost = update.cost;
      if (cost !== undefined && cost !== null && typeof cost.amount === 'number') {
        turn.cost = { amount: cost.amount, currency: cost.currency };
        _meta['ahpd.cost'] = { amount: cost.amount - (turn.costAtStart ?? 0), currency: cost.currency };
      }
      // The last of it is what the turn holds, which is what a rebuilt
      // conversation reads back.
      turn.usage = { _meta };
      return [{ type: 'chat/usage', turnId: turn.turnId, usage: turn.usage }];
    }

    /*
     * The agent's plan, as the turn's one call for it.
     */
    case 'plan':
      return plan(turn, update.entries);

    /*
     * Everything else - a user echo, a mode or command catalogue - is a variant
     * this bridge does not carry. Nothing is thrown for one, because the union
     * grows with the protocol and a bridge that failed a turn over an update it
     * did not know would be worse than one that ignored it.
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
