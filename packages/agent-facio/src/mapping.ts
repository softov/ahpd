/**
 * The one place a facio `RunEvent` becomes an AHP `chat/*` action.
 *
 * Every event a run emits arrives here, and every decision about what it
 * means on the wire is made here, so a change in facio's event union is one
 * edit in one file. `session.ts` iterates the run's stream and sends what
 * this returns; it makes no choices of its own about an event.
 *
 * Three things are deliberately not mapped yet, and throw rather than pass
 * silently: an approval request, a question, and the `run.paused` that
 * follows either. Task 03 turns those into `session/inputNeededSet` and a
 * route back into the run's `submit`. A test that reaches one must fail
 * loudly, because a paused run reported complete is a turn nobody can
 * continue.
 */

import type { RunEvent, Usage } from '@facio/agents';
import type { Bag } from '@ahpd/sdk';
import { toolCallPart, toolCompleteAction, toolReadyAction, toolStartAction } from './tools.js';

/** The event types that wait for a person, and so belong to task 03. */
const PAUSING = [
  'approval.requested',
  'approval.resolved',
  'input.requested',
  'input.resolved',
  'input.declined',
  'run.paused',
  'run.resumed',
] as const;

/** One of the events that waits for a person rather than meaning something on the wire. */
type PausingEvent = Extract<RunEvent, { type: typeof PAUSING[number] }>;

/**
 * Whether this event is a pause.
 *
 * A type predicate rather than a plain check, so the switch below narrows to
 * the events that are left. That is what makes a new facio event a compile
 * error here rather than a silent drop.
 */
const isPausing = (event: RunEvent): event is PausingEvent =>
  (PAUSING as readonly string[]).includes(event.type);

/** What one turn's mapping was told, and what it reads as the turn runs. */
export interface TurnMappingOptions {
  /** The turn the client began. */
  turnId: string;
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
  /** The actions one event means, in the order they must be sent. */
  actions(event: RunEvent): Bag[];
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
  /** Whether `chat/toolCallReady` has gone out yet. */
  readied: boolean;
  /** The part held in the turn's snapshot, updated as the call moves. */
  part: Bag;
}

export function mapTurn(options: TurnMappingOptions): TurnMapping {
  const { turnId, markdownPartId, parts } = options;
  /** One reasoning part per turn, opened the first time the model thinks. */
  let reasoningId: string | undefined;
  /** Tool calls waiting on a result, by the id the model gave them. */
  const open = new Map<string, OpenCall>();

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

  return {
    actions(event: RunEvent): Bag[] {
      /*
       * The pausing events. Named one by one rather than matched by a prefix,
       * so a new pausing event in facio is a compile error here and not a
       * silent turn end.
       */
      if (isPausing(event)) {
        throw new Error(
          `facio ${event.type} is not mapped yet: approval and questions arrive with task 03, `
          + 'and a paused run must not be reported complete',
        );
      }

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
         */
        case 'model.started':
        /*
         * The step's own usage. The turn's total arrives with `run.finished`,
         * which is where `chat/usage` is sent from. A usage action per step
         * would report a running total as if it were the whole turn's.
         */
        case 'model.completed':
        /* A steer is already in the transcript the client typed it into. */
        case 'run.steered':
        /* Compaction changes the stored history, which the transcript reads. */
        case 'context.compacted':
          return [];

        case 'model.delta': {
          if (event.kind === 'reasoning') {
            const part = thinking();
            const actions: Bag[] = [{ type: 'chat/responsePart', turnId, part }];
            part.content = `${String(part.content ?? '')}${event.text}`;
            /*
             * `chat/reasoning`, not `chat/delta`: the reducer pairs each
             * append action with the kind of part it may append to, and a
             * delta naming a reasoning part is dropped.
             */
            actions.push({ type: 'chat/reasoning', turnId, partId: part.id, content: event.text });
            return actions;
          }
          const part = prose();
          part.content = `${String(part.content ?? '')}${event.text}`;
          return [{ type: 'chat/delta', turnId, partId: part.id, content: event.text }];
        }

        case 'tool.proposed': {
          const displayName = options.displayNameOf(event.name);
          const held: OpenCall = {
            name: event.name,
            input: event.input,
            readied: false,
            part: toolCallPart(event.callId, event.name, displayName),
          };
          open.set(event.callId, held);
          parts.push(held.part);
          return [toolStartAction(turnId, event.callId, event.name, displayName)];
        }

        case 'tool.started': {
          const held = open.get(event.callId);
          if (held === undefined) return [];
          held.readied = true;
          const call = held.part.toolCall as Bag;
          call.status = 'running';
          call.invocationMessage = held.name;
          call.confirmed = 'not-needed';
          const written = held.input === undefined ? undefined : JSON.stringify(held.input);
          if (written !== undefined) call.toolInput = written;
          return [toolReadyAction(turnId, event.callId, event.name, held.input)];
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
          return [toolCompleteAction(turnId, event.callId, event.name, event.content, event.isError)];
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
          if (held === undefined) return [];
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
            : [toolReadyAction(turnId, event.callId, event.name, held.input)];
          actions.push(toolCompleteAction(turnId, event.callId, event.name, event.reason, true));
          return actions;
        }

        case 'run.finished': {
          const outcome = event.outcome;
          /*
           * The awaiting outcome is a pause: the request and `run.paused`
           * events have already thrown above, and this is the belt to that
           * pair of braces. `chat/turnComplete` here would tell a client the
           * turn was over when the run is actually waiting on a person.
           */
          if (outcome.status === 'awaiting') {
            throw new Error(
              'facio run.finished carries the awaiting outcome, which task 03 maps: a paused run is not complete',
            );
          }
          const cancelled = outcome.status === 'cancelled' || options.cancelled();
          const actions: Bag[] = [];
          if (cancelled) {
            actions.push({ type: 'chat/turnCancelled', turnId, duration: Date.now() - options.startedAt });
            return actions;
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
            return actions;
          }
          /*
           * `stopped` as well as `completed`: the run ended on purpose at a
           * limit, a policy or a hook, and there is no separate action for a
           * deliberate stop. The turn is over either way.
           */
          actions.push({ type: 'chat/turnComplete', turnId, duration });
          return actions;
        }
      }
    },
  };
}
