/**
 * The one place a cofold `RunEvent` becomes an AHP `chat/*` action.
 *
 * Every event a run emits arrives here, and every decision about what it
 * means on the wire is made here, so a change in cofold's event union is one
 * edit in one file. `session.ts` iterates the run's stream and sends what
 * this returns; it makes no choices of its own about an event.
 *
 * A pause is a pair of things: a `session/inputNeededSet` a client can draw
 * and answer, and a marker that the run is waiting. The set is what the
 * session tracks, the answer comes back through `RunHandle.submit`, and the
 * resolution events take the entry down again. Nothing here reports a pause
 * as a finished turn, because a run nobody can continue is a conversation
 * that has stopped without saying so.
 */

import { ZERO_USAGE, addUsage } from '@cofold/agents';
import type { AskQuestion, RunEvent, Usage } from '@cofold/agents';
import type { Bag } from '@ahpd/sdk';
import { callTimes, startOf, withCallTimes } from '@ahpd/sdk';
import { contributorOf, describe, intentionOf, toolCallPart, toolCompleteAction, toolInputOf, toolMetaOf, toolReadyAction, toolStartAction } from './tools.js';

/**
 * A request a client has to answer, as the session must hold it.
 *
 * The mapping makes one when a pause arrives and hands it over with the
 * actions; the session keeps it until `confirm` or `answer` routes a decision
 * back. Two requests are two of these, so answering one cannot settle the
 * other.
 */
export interface OpenRequest {
  /** The run's own id for the request, which is what `submit` names. */
  requestId: string;
  /** `approval` for a tool call, `input` for a question. */
  kind: 'approval' | 'input';
  /** The tool call an approval is about, when the pause named one. */
  callId?: string;
  /** The entry id a client was told, carried by the set and the removal. */
  entryId: string;
  /** The entry itself, held so a subscription snapshot can repeat it. */
  entry: Bag;
  /** The choices an approval offered, which the person's `selectedOptionId` names one of. */
  options?: Bag[];
}

/** What one event means: the actions to send, and the request it opened or closed. */
export interface MappedEvent {
  /** The actions this event means, in the order they must be sent. */
  actions: Bag[];
  /** The request this event opened; the session tracks it until it is answered. */
  opened?: OpenRequest;
  /** The request this event settled; the session drops it. */
  settled?: string;
}

/** What one turn's mapping was told, and what it reads as the turn runs. */
export interface TurnMappingOptions {
  /** The turn the client began. */
  turnId: string;
  /** The session's own chat URI, which every entry and request names. */
  chatUri: string;
  /** The turn's response parts, held so a subscription snapshot shows them. */
  parts: Bag[];
  /** When the turn began, so the action that ends it can carry a duration. */
  startedAt: number;
  /** What the model is called, for the usage report. */
  model?: string;
  /** The name a client draws for a tool, off the definition the host offered. */
  displayNameOf(name: string): string;
  /**
   * The client that runs a tool, when one does.
   *
   * Off the same bound definitions the host offered, so a call is reported
   * with the owner the tool was announced under. Undefined for a tool this
   * host runs itself, which is what keeps the contributor off its actions.
   */
  ownerOf(name: string): string | undefined;
  /**
   * Whether the client has asked to stop this turn.
   *
   * Checked at `run.finished` because a cancel can land after the run already
   * decided it was done; the client's word wins, so the turn still ends
   * cancelled rather than complete.
   */
  cancelled(): boolean;
}

/** One turn's event translation. */
export interface TurnMapping {
  /** What one event means. */
  actions(event: RunEvent): MappedEvent;
  /**
   * Take a request down, once.
   *
   * The session calls this when a client answers, so the entry leaves the
   * client's screen at the moment of the answer rather than a resume later.
   * Nothing is returned for a request that is already gone, which is what
   * keeps the removal from being sent twice when the resolution event
   * follows.
   */
  settle(requestId: string): Bag | undefined;
}

/** cofold's token counts, in the protocol's spelling, and what they cost. */
const usageOf = (usage: Usage, model: string | undefined, cost?: number): Bag => {
  const extra: Bag = {
    ...(usage.cacheWriteTokens !== undefined ? { 'ahpd.cacheWriteTokens': usage.cacheWriteTokens } : {}),
    ...(usage.reasoningTokens !== undefined ? { 'ahpd.reasoningTokens': usage.reasoningTokens } : {}),
    ...(cost !== undefined ? { 'ahpd.cost': { amount: cost, currency: 'USD' } } : {}),
  };
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(model !== undefined ? { model } : {}),
    /*
     * The protocol names no field for cache writes, reasoning tokens or what
     * the calls cost, and each is a measurement rather than a guess, so they
     * ride `_meta` rather than being dropped or flattened into a field that
     * means something else. The cost is cofold's own tally in dollars, and it
     * is there only for an adapter with a price row.
     */
    ...(Object.keys(extra).length > 0 ? { _meta: extra } : {}),
  };
};

/**
 * What a compaction is said as, in a live turn and in a transcript alike.
 *
 * The Claude backend words its own compaction this way, and a person reading
 * two hosts should read one sentence for one thing. The numbers are cofold's
 * own estimate of the history before the summary and after it, and a call with
 * neither says the compaction happened rather than nothing about it.
 */
export const compactionNotice = (tokens?: { before: number; after: number }): string =>
  tokens === undefined
    ? 'Context compacted automatically.'
    : `Context compacted automatically: ${String(tokens.before)} tokens to ${String(tokens.after)}.`;

/** The part that ends a turn which failed, in the shape `chat/error` carries. */
const failurePart = (message: string): Bag => ({
  kind: 'error',
  error: { errorType: 'turnFailed', message },
});

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});

/** One tool call as it is held between its proposal and its result. */
interface OpenCall {
  name: string;
  input: unknown;
  /** The client that runs it, when one does; undefined for a host tool. */
  owner: string | undefined;
  /** Whether `chat/toolCallReady` has gone out yet. */
  readied: boolean;
  /**
   * Whether the call was held for a person's decision.
   *
   * The ready action that follows an approved call has to say it was approved
   * by a person rather than needing no approval, or the client draws an
   * allowed call as one that was never asked about.
   */
  awaited: boolean;
  /** The sentence the approval carried, so the resumed call keeps it. */
  invocation: string | undefined;
  /** The part held in the turn's snapshot, updated as the call moves. */
  part: Bag;
}

/**
 * One question as AHP's composer wants it.
 *
 * cofold's option is a label and a line about it; the protocol wants both an
 * id and a label, and the label is what comes back as the answer. A question
 * with no options is free text, and one that allows a free-text answer beside
 * its options says so.
 */
const questionOf = (question: AskQuestion): Bag => {
  const title = question.header === undefined ? {} : { title: question.header };
  if (question.options === undefined || question.options.length === 0) {
    return { id: question.id, kind: 'text', message: question.question, required: true, ...title };
  }
  return {
    id: question.id,
    kind: question.multiSelect === true ? 'multi-select' : 'single-select',
    message: question.question,
    required: true,
    options: question.options.map((one) => ({
      id: one.label,
      label: one.label,
      ...(one.description !== undefined ? { description: one.description } : {}),
    })),
    // cofold takes free text unless the question said otherwise, and the
    // protocol's default is the same, so the flag is only sent when it is no.
    ...(question.allowOther === false ? { allowFreeformInput: false } : {}),
    ...title,
  };
};

export function mapTurn(options: TurnMappingOptions): TurnMapping {
  const { turnId, parts } = options;
  /** How many model steps this turn has started, which numbers the one streaming. */
  let step = 0;
  /**
   * The current step's reasoning and text parts, by kind.
   *
   * cofold's adapters gather a step's reasoning into one part and its text
   * into another, and its deltas name neither a message nor a block, so a
   * step holds at most one of each here too.
   */
  const blocks = new Map<'reasoning' | 'text', Bag>();
  /** The whitespace the current step's text has written before its part opened. */
  let waiting = '';
  /**
   * Whether the current step streamed its text and its reasoning.
   *
   * An adapter with `features.streaming: false` never emits `model.delta`, so
   * `model.completed` is the only place its reply exists. These say whether
   * the deltas already carried it, so the fallback below appends it once and
   * not twice.
   */
  let textStreamed = false;
  let reasoningStreamed = false;
  /**
   * What the turn's steps have used between them, which each one adds to.
   *
   * A turn is as many model calls as it takes steps, and the run's outcome
   * counts them all - but only once it is over. Held here so a client watches
   * the number grow, and sent as it stands rather than only at the end.
   */
  let spent: Usage = ZERO_USAGE;
  /** Tool calls waiting on a result, by the id the model gave them. */
  const open = new Map<string, OpenCall>();
  /** Requests a client is being asked about, by the run's request id. */
  const requests = new Map<string, OpenRequest>();
  /**
   * The reasoning and text the last `model.completed` has not written yet.
   *
   * A step that did not stream its reply is only known whole at
   * `model.completed`, and what that reply *is* is not known there either: a
   * compaction step's reply is the summary, which is the model's own working
   * text rather than its answer, and cofold says so one event later with
   * `context.compacted`. Holding the writes for one event is what lets the two
   * be told apart without guessing. Nothing is held for a step that streamed,
   * because its deltas are already on the wire.
   */
  let held: { kind: 'reasoning' | 'text'; text: string }[] = [];
  /** How many compactions this turn has reported, which numbers the parts. */
  let compactions = 0;

  /** Write what the last step's reply was held for, if anything. */
  const flush = (): Bag[] => {
    const actions: Bag[] = [];
    for (const piece of held) actions.push(...write(piece.kind, piece.text));
    held = [];
    return actions;
  };

  /**
   * The part a step's reasoning or its text is written into, and the action
   * announcing it the first time the step writes that kind.
   *
   * Opened where the step starts writing it, so the turn's parts are in the
   * order the model wrote them: a step's thinking, the calls it asked for,
   * then the next step's thinking and text. The id names the step and the
   * block's place in it. The announcement is a copy, because the object the
   * deltas keep writing into is the one it would otherwise carry, and a
   * client that applied both would read the text twice.
   */
  const blockOf = (kind: 'reasoning' | 'text'): { part: Bag; opened: Bag[] } => {
    const known = blocks.get(kind);
    if (known !== undefined) return { part: known, opened: [] };
    const part: Bag = {
      id: `${turnId}:${step}:${blocks.size}`,
      kind: kind === 'text' ? 'markdown' : 'reasoning',
      content: '',
    };
    blocks.set(kind, part);
    parts.push(part);
    return { part, opened: [{ type: 'chat/responsePart', turnId, part: { ...part } }] };
  };

  /**
   * Some of the step's reasoning or text, as the part holds it and the
   * actions that send it.
   *
   * `chat/reasoning` for reasoning and `chat/delta` for text: the reducer
   * pairs each append action with the kind of part it may append to, and one
   * naming the other kind is dropped.
   *
   * A step's text is held while it is only whitespace and leads the part it
   * opens once it writes something else, so text that is only whitespace, as
   * some models write before a call, opens nothing.
   */
  const write = (kind: 'reasoning' | 'text', written: string): Bag[] => {
    let text = written;
    if (kind === 'text' && !blocks.has('text')) {
      text = `${waiting}${written}`;
      if (text.trim() === '') {
        waiting = text;
        return [];
      }
      waiting = '';
    }
    const { part, opened } = blockOf(kind);
    part.content = `${String(part.content ?? '')}${text}`;
    return [...opened, {
      type: kind === 'text' ? 'chat/delta' : 'chat/reasoning', turnId, partId: part.id, content: text,
    }];
  };

  /**
   * Take a request down, once.
   *
   * The entry id is the one the set used, so a client matches the two by it;
   * a request that is already gone answers nothing, which is what stops the
   * session's own removal and the resolution event's from being two.
   */
  const settle = (requestId: string): Bag | undefined => {
    const held = requests.get(requestId);
    if (held === undefined) return undefined;
    requests.delete(requestId);
    return { type: 'session/inputNeededRemoved', id: held.entryId };
  };

  /** The actions one event means, with nothing else. */
  const only = (actions: Bag[]): MappedEvent => ({ actions });

  /**
   * What one event means, on its own.
   *
   * `actions` below leads a mapped event with what the step before it held,
   * so this is the translation without that prefix - which is why every return
   * here is a `MappedEvent` and not a decision about the turn as a whole.
   */
  const translate = (event: RunEvent): MappedEvent => {
      switch (event.type) {
        /*
         * `run.started` is already said: the session emits `chat/turnStarted`
         * before it calls `run()`, because the host has already dispatched
         * that action and AHP requires it before any part or delta. A second
         * one here would be the same turn announced twice.
         */
        case 'run.started':
          return only([]);
        /*
         * A step boundary. Nothing on the wire means anything to a client: it
         * already sees the deltas, and the step number is cofold's bookkeeping.
         * What it does mean is that the next step writes parts of its own and
         * has not streamed anything yet, which is what the `model.completed`
         * fallback reads.
         */
        case 'model.started':
          step += 1;
          blocks.clear();
          waiting = '';
          textStreamed = false;
          reasoningStreamed = false;
          return only([]);
        /*
         * The step's reply, once it is whole, and what the step used. An
         * adapter that streamed has already sent every part as a delta, so the
         * text below is empty for one that streamed. An adapter that did not
         * stream never sent a delta at all, and this is where its text and its
         * reasoning reach the client - otherwise the turn would finish having
         * said nothing.
         *
         * The step's `usage` is here and not only in the run's outcome: a turn
         * that runs tools spends most of what it costs between its first and
         * its last step, so this one adds to what the earlier ones used and
         * sends the total as it stands. The protocol replaces the active turn's
         * usage on each `chat/usage`, so a client watching the number sees it
         * grow rather than being handed deltas it has to add up itself.
         *
         * What it wrote is held rather than sent: the next event decides
         * whether this reply was the model's answer or a summary, and a step
         * that streamed wrote its parts as deltas and holds nothing.
         */
        case 'model.completed': {
          const pieces: { kind: 'reasoning' | 'text'; text: string }[] = [];
          for (const piece of event.message.parts) {
            if (piece.type === 'reasoning' && !reasoningStreamed && piece.text !== '') {
              pieces.push({ kind: 'reasoning', text: piece.text });
            }
            else if (piece.type === 'text' && !textStreamed && piece.text !== '') {
              pieces.push({ kind: 'text', text: piece.text });
            }
          }
          held = pieces;
          // The step is told, so a later step that did not stream is not
          // mistaken for this one having been silent.
          textStreamed = true;
          reasoningStreamed = true;
          spent = addUsage(spent, event.usage);
          return only([{ type: 'chat/usage', turnId, usage: usageOf(spent, options.model) }]);
        }
        /*
         * The turn folded its own history into a summary.
         *
         * What the summary step wrote is the summary, so the writes held above
         * are dropped rather than shown as the model's answer, and a notice
         * takes their place: somebody watching an answer change character
         * half-way through deserves to know why. The notice is a part of the
         * turn rather than a `chat/truncated`, because nothing was dropped from
         * the conversation - every message it stands for is still in the
         * transcript the client can read.
         */
        case 'context.compacted': {
          compactions += 1;
          const part: Bag = {
            id: `${turnId}:compact:${compactions}`,
            kind: 'systemNotification',
            content: compactionNotice({ before: event.estimatedTokens, after: event.afterTokens }),
          };
          parts.push(part);
          return only([{ type: 'chat/responsePart', turnId, part: { ...part } }]);
        }
        /* A steer is already in the transcript the client typed it into. */
        case 'run.steered':
        /*
         * `run.paused` is the marker that the run is waiting on a person, and
         * the request itself already told the client what was wanted. There is
         * no action for "still waiting", so this is deliberately empty - and
         * deliberately not a completion.
         */
        case 'run.paused':
          return only([]);

        case 'model.delta': {
          if (event.kind === 'reasoning') reasoningStreamed = true;
          else textStreamed = true;
          return only(write(event.kind, event.text));
        }

        case 'tool.proposed': {
          const displayName = options.displayNameOf(event.name);
          const owner = options.ownerOf(event.name);
          /*
           * The kind a client routes by and the line it draws, both off the
           * tool's name: a shell call is a terminal running a command rather
           * than a generic tool with an input. They go out with the part and
           * the action together, so a subscription after the fact and a
           * client watching the stream see the same row.
           */
          const meta = toolMetaOf(event.name);
          const intention = intentionOf(event.name, event.input);
          const held: OpenCall = {
            name: event.name,
            input: event.input,
            owner,
            readied: false,
            awaited: false,
            invocation: undefined,
            part: toolCallPart(event.callId, event.name, displayName, owner, meta, intention),
          };
          open.set(event.callId, held);
          parts.push(held.part);
          return only([toolStartAction(turnId, event.callId, event.name, displayName, owner, meta, intention)]);
        }

        /*
         * A tool call the policy picked out for a person to allow.
         *
         * The call is moved to `pending-confirmation` and said back with a
         * ready action that carries no `confirmed`, which is the reducer's
         * word for "waiting on somebody". The entry beside it is what a
         * client that is not watching this chat answers from.
         */
        case 'approval.requested': {
          const displayName = options.displayNameOf(event.name);
          const prompt = event.prompt ?? `Run ${displayName}?`;
          const held = open.get(event.callId);
          const owner = held?.owner ?? options.ownerOf(event.name);
          const meta = toolMetaOf(event.name);
          const intention = intentionOf(event.name, event.input);
          const call: Bag = held === undefined
            ? {
                toolCallId: event.callId,
                toolName: event.name,
                displayName,
                ...(intention !== undefined ? { intention } : {}),
                ...(meta !== undefined ? { _meta: meta } : {}),
                ...contributorOf(owner),
              }
            : held.part.toolCall as Bag;
          /*
           * Allow once, allow this tool for the rest of the session, or deny.
           * The session choice is one cofold keeps itself, per session and
           * tool, and answers the next ask for that tool with.
           */
          const choices: Bag[] = [
            { id: 'allow-once', label: 'Allow once', kind: 'approve', group: 1 },
            { id: 'allow-session', label: `Allow ${displayName} for this session`, kind: 'approve', group: 1 },
            { id: 'deny', label: 'Deny', kind: 'deny', group: 2 },
          ];
          call.status = 'pending-confirmation';
          call.confirmationTitle = prompt;
          call.invocationMessage = prompt;
          call.options = choices;
          delete call.confirmed;
          const written = toolInputOf(event.name, event.input);
          if (written !== undefined) call.toolInput = written;

          const actions: Bag[] = [];
          /*
           * A call the run never proposed, which should not happen but would
           * otherwise be an entry naming a row no client has.
           */
          if (held === undefined) {
            parts.push({ id: event.callId, kind: 'toolCall', toolCall: call });
            actions.push(toolStartAction(turnId, event.callId, event.name, displayName, owner, meta, intention));
          } else {
            held.awaited = true;
            held.invocation = prompt;
          }
          actions.push({
            type: 'chat/toolCallReady',
            turnId,
            toolCallId: event.callId,
            invocationMessage: prompt,
            confirmationTitle: prompt,
            ...contributorOf(owner),
            ...(written !== undefined ? { toolInput: written } : {}),
            options: choices,
          });

          const entryId = `approval:${event.requestId}`;
          const entry: Bag = { id: entryId, chat: options.chatUri, kind: 'toolConfirmation', turnId, toolCall: call };
          const opened: OpenRequest = {
            requestId: event.requestId,
            kind: 'approval',
            callId: event.callId,
            entryId,
            entry,
            options: choices,
          };
          requests.set(event.requestId, opened);
          actions.push({ type: 'session/inputNeededSet', request: entry });
          return { actions, opened };
        }

        /*
         * The ask tool's questions, which are not about a tool call a client
         * confirms but about what somebody types. The entry carries the
         * questions and their options, so a composer draws the form from the
         * session channel alone.
         */
        case 'input.requested': {
          const entryId = `input:${event.requestId}`;
          const request: Bag = {
            id: event.requestId,
            message: 'The agent has a question',
            questions: event.questions.map(questionOf),
          };
          const entry: Bag = { id: entryId, chat: options.chatUri, kind: 'chatInput', request };
          const opened: OpenRequest = {
            requestId: event.requestId,
            kind: 'input',
            callId: event.callId,
            entryId,
            entry,
          };
          requests.set(event.requestId, opened);
          return { actions: [{ type: 'session/inputNeededSet', request: entry }], opened };
        }

        /*
         * The ways a pause ends: the decision arrived, the question was
         * answered or declined, and the run said it was carrying on. Each
         * takes the entry down if it is still up; the tool actions that
         * follow are what a client draws, and `run.resumed` has none of its
         * own because the run's next events already say what continues.
         */
        case 'approval.resolved':
        case 'input.resolved':
        case 'input.declined':
        case 'run.resumed': {
          const removal = settle(event.requestId);
          return removal === undefined ? only([]) : { actions: [removal], settled: event.requestId };
        }

        case 'tool.started': {
          const held = open.get(event.callId);
          if (held === undefined) return only([]);
          held.readied = true;
          const call = held.part.toolCall as Bag;
          call.status = 'running';
          call.invocationMessage = held.invocation ?? describe(held.name, held.input);
          call.confirmed = held.awaited ? 'user-action' : 'not-needed';
          const written = toolInputOf(held.name, held.input);
          if (written !== undefined) call.toolInput = written;
          /*
           * The call starts when cofold says it started, which for a call a
           * person was asked about is after they allowed it.
           */
          call._meta = withCallTimes(bag(call._meta), callTimes(event.at));
          /*
           * Built here rather than through `toolReadyAction`, because an
           * approved call has to keep saying a person allowed it: the same
           * action with `not-needed` would draw the approval as one nobody
           * was ever asked for.
           */
          return only([{
            type: 'chat/toolCallReady',
            turnId,
            toolCallId: event.callId,
            invocationMessage: held.invocation ?? describe(held.name, held.input),
            confirmed: held.awaited ? 'user-action' : 'not-needed',
            ...contributorOf(held.owner),
            ...(written !== undefined ? { toolInput: written } : {}),
            _meta: bag(call._meta),
          }]);
        }

        case 'tool.completed': {
          const held = open.get(event.callId);
          open.delete(event.callId);
          let meta: Bag | undefined;
          if (held !== undefined) {
            const call = held.part.toolCall as Bag;
            call.status = 'completed';
            call.success = !event.isError;
            call.pastTenseMessage = describe(held.name, held.input);
            if (event.content !== '') call.content = [{ type: 'text', text: event.content }];
            if (event.isError) call.error = { message: event.content === '' ? 'The tool failed' : event.content };
            call._meta = withCallTimes(bag(call._meta), callTimes(startOf(call._meta) ?? event.at, event.at, event.durationMs));
            meta = bag(call._meta);
          }
          return only([toolCompleteAction(turnId, event.callId, event.name, event.content, event.isError, held?.input, meta)]);
        }

        /*
         * A call the run refused, for an unknown tool or arguments that did
         * not validate. It was already announced by `tool.proposed`, so it is
         * closed as a failed call rather than left open for ever; the reason
         * is the result the model is given.
         */
        case 'tool.denied': {
          const held = open.get(event.callId);
          /*
           * An unknown tool never got a proposal, so there is no call on the
           * client to close. The refusal still reaches the model as the tool
           * result cofold appends; it is not a row a client was ever shown.
           */
          if (held === undefined) return only([]);
          open.delete(event.callId);
          const call = held.part.toolCall as Bag;
          call.status = 'completed';
          call.success = false;
          call.pastTenseMessage = describe(held.name, held.input);
          call.error = { message: event.reason };
          // A refusal can land before the call ever reached `running`; the
          // ready action is what moves it there so the completion applies.
          const actions: Bag[] = held.readied
            ? []
            : [toolReadyAction(turnId, event.callId, event.name, held.input, held.owner)];
          actions.push(toolCompleteAction(turnId, event.callId, event.name, event.reason, true, held.input));
          return only(actions);
        }

        case 'run.finished': {
          const outcome = event.outcome;
          /*
           * The awaiting outcome is the pause itself: the request events
           * above have already told the client what is wanted, and the run is
           * waiting rather than over. `chat/turnComplete` here would end a
           * turn somebody still has to answer.
           */
          if (outcome.status === 'awaiting') return only([]);
          const cancelled = outcome.status === 'cancelled' || options.cancelled();
          const actions: Bag[] = [];
          if (cancelled) {
            actions.push({ type: 'chat/turnCancelled', turnId, duration: Date.now() - options.startedAt });
            return only(actions);
          }
          /*
           * The run's own tally, which counts every step the turn made, sent
           * last so the turn ends on the whole of it. It is the same number
           * the steps sent as they went, and the cost is cofold's, in dollars
           * and only for an adapter that carries a price row.
           */
          actions.push({ type: 'chat/usage', turnId, usage: usageOf(outcome.usage, options.model, outcome.cost) });
          const duration = Date.now() - options.startedAt;
          if (outcome.status === 'failed') {
            /*
             * A turn that failed is not a turn that completed. The protocol's
             * own ending carries the reason as an error part, which is what a
             * client draws; reporting it as complete would leave the failure
             * in the snapshot and nowhere on the stream.
             */
            actions.push({ type: 'chat/error', turnId, duration, part: failurePart(outcome.error.message) });
            return only(actions);
          }
          /*
           * `stopped` as well as `completed`: the run ended on purpose at a
           * limit, a policy or a hook, and there is no separate action for a
           * deliberate stop. The turn is over either way.
           */
          actions.push({ type: 'chat/turnComplete', turnId, duration });
          return only(actions);
        }

        default: {
          /*
           * A new cofold event is a compile error here rather than a silent
           * drop, which is the property this file exists to keep.
           */
          const unhandled: never = event;
          throw new Error(`cofold event is not mapped: ${(unhandled as { type?: string }).type ?? 'unknown'}`);
        }
      }
  };

  return {
    settle,

    actions(event: RunEvent): MappedEvent {
      /*
       * What the step before this one held leads, whatever this event is: the
       * text belongs before whatever comes next, and the one event that shows
       * it was not an answer - a compaction - drops it instead. Flushing here
       * is also what keeps a non-streaming adapter's reply from being lost
       * when the run ends on the step that wrote it.
       */
      let lead: Bag[] = [];
      if (event.type === 'context.compacted') held = [];
      else lead = flush();
      const mapped = translate(event);
      return lead.length === 0 ? mapped : { ...mapped, actions: [...lead, ...mapped.actions] };
    },
  };
}
