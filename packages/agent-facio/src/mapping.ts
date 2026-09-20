/**
 * The one place a facio `RunEvent` becomes an AHP `chat/*` action.
 *
 * Every event a run emits arrives here, and every decision about what it
 * means on the wire is made here, so a change in facio's event union is one
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

import type { AskQuestion, RunEvent, Usage } from '@facio/agents';
import type { Bag } from '@ahpd/sdk';
import { contributorOf, toolCallPart, toolCompleteAction, toolReadyAction, toolStartAction } from './tools.js';

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
  /**
   * The markdown part opened when the turn began.
   *
   * Text deltas append to it rather than opening a part of their own, which
   * is what the protocol requires: a delta naming a part nobody opened has
   * nowhere to go.
   */
  markdownPartId: string;
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

/** facio's token counts, in the protocol's spelling. */
const usageOf = (usage: Usage, model: string | undefined): Bag => {
  const extra: Bag = {
    ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
  };
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(model !== undefined ? { model } : {}),
    /*
     * The protocol names no field for cache writes or reasoning tokens, and
     * both are measurements rather than guesses, so they ride `_meta` rather
     * than being dropped or flattened into a field that means something else.
     */
    ...(Object.keys(extra).length > 0 ? { _meta: extra } : {}),
  };
};

/** The part that ends a turn which failed, in the shape `chat/error` carries. */
const failurePart = (message: string): Bag => ({
  kind: 'error',
  error: { errorType: 'turnFailed', message },
});

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
 * facio's option is a label and a line about it; the protocol wants both an
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
    // facio takes free text unless the question said otherwise, and the
    // protocol's default is the same, so the flag is only sent when it is no.
    ...(question.allowOther === false ? { allowFreeformInput: false } : {}),
    ...title,
  };
};

export function mapTurn(options: TurnMappingOptions): TurnMapping {
  const { turnId, markdownPartId, parts } = options;
  /** One reasoning part per turn, opened the first time the model thinks. */
  let reasoningId: string | undefined;
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
  /** Tool calls waiting on a result, by the id the model gave them. */
  const open = new Map<string, OpenCall>();
  /** Requests a client is being asked about, by the run's request id. */
  const requests = new Map<string, OpenRequest>();

  const partOf = (id: string): Bag | undefined => parts.find((held) => held.id === id);

  /** The markdown part, which the session opened before the run began. */
  const prose = (): Bag => {
    const held = partOf(markdownPartId);
    if (held !== undefined) return held;
    // Unreachable while the session opens the part it named, and better than
    // appending to nothing if some future caller forgets to.
    const part: Bag = { id: markdownPartId, kind: 'markdown', content: '' };
    parts.push(part);
    return part;
  };

  /** The reasoning part, opened on the first reasoning delta of the turn. */
  const thinking = (): Bag => {
    const known = reasoningId === undefined ? undefined : partOf(reasoningId);
    if (known !== undefined) return known;
    reasoningId = `${turnId}:reasoning`;
    const part: Bag = { id: reasoningId, kind: 'reasoning', content: '' };
    parts.push(part);
    return part;
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

  return {
    settle,

    actions(event: RunEvent): MappedEvent {
      switch (event.type) {
        /*
         * `run.started` is already said: the session emits `chat/turnStarted`
         * before it calls `run()`, because the host has already dispatched
         * that action and AHP requires it before any part or delta. A second
         * one here would be the same turn announced twice.
         */
        case 'run.started':
        /*
         * A step boundary. Nothing on the wire means anything to a client: it
         * already sees the deltas, and the step number is facio's bookkeeping.
         * What it does mean is that the next step has not streamed anything
         * yet, which is what the `model.completed` fallback reads.
         */
        case 'model.started':
          textStreamed = false;
          reasoningStreamed = false;
          return only([]);
        /*
         * The step's reply, once it is whole. An adapter that streamed has
         * already sent every part as a delta, and facio's step usage arrives
         * with `run.finished` rather than here, so this is empty for one that
         * streamed. An adapter that did not stream never sent a delta at all,
         * and this is where its text and its reasoning reach the client -
         * otherwise the turn would finish having said nothing.
         */
        case 'model.completed': {
          const actions: Bag[] = [];
          for (const piece of event.message.parts) {
            if (piece.type === 'reasoning' && !reasoningStreamed && piece.text !== '') {
              // Opened here only if a delta never did: a later step whose
              // adapter did not stream still appends to the part the turn
              // already has, rather than announcing a second one.
              if (reasoningId === undefined) {
                actions.push({ type: 'chat/responsePart', turnId, part: { ...thinking() } });
              }
              const held = thinking();
              held.content = `${String(held.content ?? '')}${piece.text}`;
              actions.push({ type: 'chat/reasoning', turnId, partId: held.id, content: piece.text });
            }
            else if (piece.type === 'text' && !textStreamed && piece.text !== '') {
              const held = prose();
              held.content = `${String(held.content ?? '')}${piece.text}`;
              actions.push({ type: 'chat/delta', turnId, partId: held.id, content: piece.text });
            }
          }
          // The step is told, so a later step that did not stream is not
          // mistaken for this one having been silent.
          textStreamed = true;
          reasoningStreamed = true;
          return only(actions);
        }
        /* A steer is already in the transcript the client typed it into. */
        case 'run.steered':
        /* Compaction changes the stored history, which the transcript reads. */
        case 'context.compacted':
        /*
         * `run.paused` is the marker that the run is waiting on a person, and
         * the request itself already told the client what was wanted. There is
         * no action for "still waiting", so this is deliberately empty - and
         * deliberately not a completion.
         */
        case 'run.paused':
          return only([]);

        case 'model.delta': {
          if (event.kind === 'reasoning') {
            reasoningStreamed = true;
            const actions: Bag[] = [];
            /*
             * The thinking part is announced once, when it is opened, and every
             * delta after that is an append to it.
             *
             * Announcing it again on each delta is the same part to a client
             * that appends on `chat/responsePart`, and it draws the whole
             * thinking block again for every delta that arrives - four blocks
             * where the snapshot, built from the transcript, has one. The
             * announcement is a *copy*, because the object the deltas keep
             * writing into is the one the announcement would otherwise carry:
             * a client that applied both would read the text twice.
             */
            if (reasoningId === undefined) {
              actions.push({ type: 'chat/responsePart', turnId, part: { ...thinking() } });
            }
            const part = thinking();
            part.content = `${String(part.content ?? '')}${event.text}`;
            /*
             * `chat/reasoning`, not `chat/delta`: the reducer pairs each
             * append action with the kind of part it may append to, and a
             * delta naming a reasoning part is dropped.
             */
            actions.push({ type: 'chat/reasoning', turnId, partId: part.id, content: event.text });
            return only(actions);
          }
          textStreamed = true;
          const part = prose();
          part.content = `${String(part.content ?? '')}${event.text}`;
          return only([{ type: 'chat/delta', turnId, partId: part.id, content: event.text }]);
        }

        case 'tool.proposed': {
          const displayName = options.displayNameOf(event.name);
          const owner = options.ownerOf(event.name);
          const held: OpenCall = {
            name: event.name,
            input: event.input,
            owner,
            readied: false,
            awaited: false,
            invocation: undefined,
            part: toolCallPart(event.callId, event.name, displayName, owner),
          };
          open.set(event.callId, held);
          parts.push(held.part);
          return only([toolStartAction(turnId, event.callId, event.name, displayName, owner)]);
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
          const call: Bag = held === undefined
            ? { toolCallId: event.callId, toolName: event.name, displayName, ...contributorOf(owner) }
            : held.part.toolCall as Bag;
          call.status = 'pending-confirmation';
          call.confirmationTitle = prompt;
          call.invocationMessage = prompt;
          delete call.confirmed;
          const written = event.input === undefined ? undefined : JSON.stringify(event.input);
          if (written !== undefined) call.toolInput = written;

          const actions: Bag[] = [];
          /*
           * A call the run never proposed, which should not happen but would
           * otherwise be an entry naming a row no client has.
           */
          if (held === undefined) {
            parts.push({ id: event.callId, kind: 'toolCall', toolCall: call });
            actions.push(toolStartAction(turnId, event.callId, event.name, displayName, owner));
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
          });

          const entryId = `approval:${event.requestId}`;
          const entry: Bag = { id: entryId, chat: options.chatUri, kind: 'toolConfirmation', turnId, toolCall: call };
          const opened: OpenRequest = {
            requestId: event.requestId,
            kind: 'approval',
            callId: event.callId,
            entryId,
            entry,
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
          call.invocationMessage = held.invocation ?? held.name;
          call.confirmed = held.awaited ? 'user-action' : 'not-needed';
          const written = held.input === undefined ? undefined : JSON.stringify(held.input);
          if (written !== undefined) call.toolInput = written;
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
            invocationMessage: held.invocation ?? held.name,
            confirmed: held.awaited ? 'user-action' : 'not-needed',
            ...contributorOf(held.owner),
            ...(written !== undefined ? { toolInput: written } : {}),
          }]);
        }

        case 'tool.completed': {
          const held = open.get(event.callId);
          open.delete(event.callId);
          if (held !== undefined) {
            const call = held.part.toolCall as Bag;
            call.status = 'completed';
            call.success = !event.isError;
            call.pastTenseMessage = held.name;
            if (event.content !== '') call.content = [{ type: 'text', text: event.content }];
            if (event.isError) call.error = { message: event.content === '' ? 'The tool failed' : event.content };
          }
          return only([toolCompleteAction(turnId, event.callId, event.name, event.content, event.isError)]);
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
           * result facio appends; it is not a row a client was ever shown.
           */
          if (held === undefined) return only([]);
          open.delete(event.callId);
          const call = held.part.toolCall as Bag;
          call.status = 'completed';
          call.success = false;
          call.pastTenseMessage = held.name;
          call.error = { message: event.reason };
          // A refusal can land before the call ever reached `running`; the
          // ready action is what moves it there so the completion applies.
          const actions: Bag[] = held.readied
            ? []
            : [toolReadyAction(turnId, event.callId, event.name, held.input, held.owner)];
          actions.push(toolCompleteAction(turnId, event.callId, event.name, event.reason, true));
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
          actions.push({ type: 'chat/usage', turnId, usage: usageOf(outcome.usage, options.model) });
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
           * A new facio event is a compile error here rather than a silent
           * drop, which is the property this file exists to keep.
           */
          const unhandled: never = event;
          throw new Error(`facio event is not mapped: ${(unhandled as { type?: string }).type ?? 'unknown'}`);
        }
      }
    },
  };
}
