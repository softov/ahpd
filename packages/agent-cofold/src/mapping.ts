/**
 * The one place a cofold `RunEvent` becomes an AHP `chat/*` action.
 *
 * Every event a run emits arrives here, and every decision about what it
 * means on the wire is made here, so a change in cofold's event union is one
 * edit in one file. `session.ts` iterates the run's stream and sends what
 * this returns; it makes no choices of its own about an event.
 *
 * A pause is a pair of things: what a client can draw and answer, which is a
 * `session/inputNeededSet` and, for a question, the `chat/inputRequested` that
 * puts it on the chat, and a marker that the run is waiting. The set is what
 * the session tracks, the answer comes back through `RunHandle.submit`, and
 * the resolution events take the entry down again. Nothing here reports a pause
 * as a finished turn, because a run nobody can continue is a conversation
 * that has stopped without saying so.
 */

import { ZERO_USAGE, addUsage } from '@cofold/agents';
import type { AskQuestion, RunEvent, Usage } from '@cofold/agents';
import type { Bag, CommandTerminal, PendingConfirmation } from '@ahpd/sdk';
import { bag, str, withToolCallDuration } from '@ahpd/sdk';
import { contributorOf, describe, intentionOf, pastTenseOf, toolCallPart, toolCompleteAction, toolInputOf, toolMetaOf, toolReadyAction, toolStartAction } from './tools.js';

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
  /**
   * The session's input request a client was told of, held so a subscription
   * snapshot can repeat it; its id is what the set and the removal carry.
   */
  request: Bag;
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
  /**
   * What the host decides a question about a call by, said beside its ready:
   * VS Code's pending confirmation fields.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1499-L1541
   */
  confirmationOf?(name: string, input: unknown): PendingConfirmation;
  /**
   * Whether the turn can be run again, the store truncated back to the turn
   * before it with cofold's own `Store.sessions.truncate`.
   *
   * Read when the run fails, so the error part says a resume is possible only
   * when there is a point to truncate to - or no turn before, for a
   * conversation's first turn, which starts over under its id. A replay passes
   * none: it rebuilds a paused run.
   */
  canTruncate?(): boolean;
  /**
   * Whether this turn is a failed one run again.
   *
   * A resume whose send fails can be asked for again, as VS Code's host ends
   * a failed resume resumable, where a new turn's failed send never reached
   * the runtime and cannot.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1854-L1872
   */
  resumed?: boolean;
  /**
   * The reference the host answered for an image a reply carried, by the
   * message's id and the image's place in it, once the host has kept it.
   */
  keptOf?(key: string): Bag | undefined;
}

/** One turn's event translation. */
export interface TurnMapping {
  /** What one event means. */
  actions(event: RunEvent): MappedEvent;
  /**
   * Put a terminal a host tool opened on its call, and answer the action.
   *
   * The call's own change, as a `!` command's call carries one, so a client
   * watches the output arrive. The block is kept for the completion, which
   * replaces the call's whole content.
   */
  opened(callId: string, terminal: CommandTerminal): Bag[];
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
 * What a compaction is said as, in a live turn and in a transcript alike, in
 * cofold's own app's words, papo's `compactedNotice`: the tokens before the
 * summary and after it where cofold estimated them, and else what the summary
 * is.
 * https://github.com/softov/cofold/blob/ee4819644696b88e83e63c56ed7bdf426d32cfb9/packages/papo/src/blocks.ts#L50-L55
 */
export const compactionNotification = (tokens?: { before: number; after: number }): string =>
  tokens === undefined
    ? 'Context compacted: the conversation so far was folded into this summary; the model continues from it.'
    : `Context compacted: ${String(tokens.before)} tokens to ${String(tokens.after)}.`;

/**
 * The spec's reference for an image a reply carries: the one the host answered
 * for the bytes it keeps, else the image's own URL where it names one. Nothing
 * for bytes the host keeps nothing of, which no client is shown, as VS Code's
 * host leaves out content it could not keep.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L1045-L1053
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L148-L183
 */
export const imageRefOf = (image: { mimeType: string; url?: string }, kept: Bag | undefined): Bag | undefined =>
  kept ?? (image.url !== undefined && image.url !== '' ? { uri: image.url, contentType: image.mimeType } : undefined);

/**
 * The stages a turn's send fails at before the runtime runs it, by the error
 * types VS Code's host gives them: a model nothing resolves, and every other
 * failure to send.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2564-L2574
 */
export const SEND_FAILURES = ['modelSelectionFailed', 'sendFailed'] as const;

/** A stage a turn's send fails at. */
export type SendFailure = typeof SEND_FAILURES[number];

/**
 * The part that ends a turn which failed, in the shape `chat/error` carries:
 * the spec's error part.
 *
 * `resumable` says a client may ask for the turn again. It is set only for a
 * failure the session can put back: a model call, the store truncated back to
 * the turn before, or a conversation's first turn, which is started over.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L1133-L1146
 */
export const errorPart = (errorType: string, message: string, resumable = false): Bag => ({
  kind: 'error',
  error: { errorType, message },
  ...(resumable ? { resumable: true } : {}),
});

/** One tool call as it is held between its proposal and its result. */
interface OpenCall {
  name: string;
  /**
   * The name the call's row draws: a client's tool by the name the client
   * announced, off the `<clientId>__<name>` the model was offered, as VS Code's
   * agents strip their client tool server's prefix.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L637-L638
   */
  shown: string;
  input: unknown;
  /**
   * What the call acts on, as cofold resolved it.
   *
   * The tool's own answer for the input the call runs with, which is what the
   * row is titled by. A tool that declares no subject leaves this undefined,
   * and the row is titled by the tool's name.
   */
  subject: string | undefined;
  /** The client that runs it, by its id, when one does: the spec's `contributor` of a client's call; undefined for a host tool. */
  contributor: string | undefined;
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

/** A call's row name: a client's tool by the name the client announced, off the `<clientId>__<name>` it was offered as. */
const shownName = (name: string, owner: string | undefined): string =>
  (owner !== undefined && name.startsWith(`${owner}__`) ? name.slice(owner.length + 2) : name);

export function mapTurn(options: TurnMappingOptions): TurnMapping {
  const { turnId, parts } = options;
  /**
   * The step a part's id names, or nothing for a part that is not numbered.
   *
   * A resumed turn keeps the parts its failed run opened and gets a mapping of
   * its own on top of them. Numbering the new run from zero again would open a
   * part under an id the turn already holds, and a delta naming that id would
   * append to the failed run's text rather than open the new run's own.
   */
  const stepOf = (part: Bag): number => {
    const id = str(part.id);
    if (id === undefined) return 0;
    const numbered = Number(id.split(':').at(-2));
    return Number.isInteger(numbered) && numbered > 0 ? numbered : 0;
  };
  /** How many model steps this turn has started, which numbers the one streaming. */
  let step = parts.reduce((high, part) => Math.max(high, stepOf(part)), 0);
  /**
   * The current step's reasoning and text parts, by kind.
   *
   * cofold's adapters gather a step's reasoning into one part and its text
   * into another, and its deltas name neither a message nor a block, so a
   * step holds at most one of each here too.
   */
  const blocks = new Map<'reasoning' | 'text', Bag>();
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
  let usage: Usage = ZERO_USAGE;
  /** Tool calls waiting on a result, by the id the model gave them. */
  const open = new Map<string, OpenCall>();
  /*
   * A call a reopened turn still holds waiting on a person, known by its own
   * row: the run that resumes the turn raises its question again, and that
   * request has to find the call it asks about rather than open a second row.
   * The input stays on the row, which already carries it.
   */
  for (const part of parts) {
    const call = part.kind === 'toolCall' && typeof part.toolCall === 'object' && part.toolCall !== null ? part.toolCall as Bag : undefined;
    if (call === undefined || call.status !== 'pending-confirmation') continue;
    const contributor = bag(call.contributor);
    const owner = contributor.kind === 'client' ? str(contributor.clientId) : undefined;
    const shown = String(call.toolName);
    open.set(String(call.toolCallId), {
      name: owner === undefined ? shown : `${owner}__${shown}`,
      shown,
      input: undefined,
      subject: undefined,
      contributor: owner,
      readied: false,
      awaited: false,
      invocation: undefined,
      part,
    });
  }
  /**
   * The terminals a call showed while it ran, by the call's id.
   *
   * Held apart from the call so one that opens a terminal before its proposal
   * is mapped still shows it, and so the completion keeps the block after it
   * replaces the call's whole content.
   */
  const terminals = new Map<string, Bag[]>();
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
   * because its deltas are already on the wire. An image the reply carries is
   * held as the reference it is said by, which no step streams.
   */
  let held: ({ kind: 'reasoning' | 'text'; text: string } | { kind: 'ref'; ref: Bag })[] = [];
  /** How many compactions this turn has reported, after which a command's own output says nothing new. */
  let compactions = 0;

  /** Write what the last step's reply was held for, if anything. */
  const flush = (): Bag[] => {
    const actions: Bag[] = [];
    for (const piece of held) {
      if (piece.kind !== 'ref') {
        actions.push(...write(piece.kind, piece.text));
        continue;
      }
      const part: Bag = { kind: 'contentRef', ...piece.ref };
      parts.push(part);
      actions.push({ type: 'chat/responsePart', turnId, part: { ...part } });
    }
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
   * Any text opens its part, whitespace included, as VS Code's agents open a
   * part for whatever text their runtime sends.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L593-L605
   */
  const write = (kind: 'reasoning' | 'text', text: string): Bag[] => {
    if (text === '') return [];
    const { part, opened } = blockOf(kind);
    part.content = `${String(part.content ?? '')}${text}`;
    return [...opened, {
      type: kind === 'text' ? 'chat/delta' : 'chat/reasoning', turnId, partId: part.id, content: text,
    }];
  };

  /**
   * Take a request down, once.
   *
   * The id is the one the set used, so a client matches the two by it; a
   * request that is already gone answers nothing, which is what stops the
   * session's own removal and the resolution event's from being two.
   */
  const settle = (requestId: string): Bag | undefined => {
    const held = requests.get(requestId);
    if (held === undefined) return undefined;
    requests.delete(requestId);
    return { type: 'session/inputNeededRemoved', id: String(held.request.id) };
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
          const pieces: typeof held = [];
          for (const [index, piece] of event.message.parts.entries()) {
            if (piece.type === 'reasoning' && !reasoningStreamed && piece.text !== '') {
              pieces.push({ kind: 'reasoning', text: piece.text });
            }
            else if (piece.type === 'text' && !textStreamed && piece.text !== '') {
              pieces.push({ kind: 'text', text: piece.text });
            }
            else if (piece.type === 'image') {
              const ref = imageRefOf(piece, options.keptOf?.(`${event.message.id}:${String(index)}`));
              if (ref !== undefined) pieces.push({ kind: 'ref', ref });
            }
          }
          held = pieces;
          // The step is told, so a later step that did not stream is not
          // mistaken for this one having been silent.
          textStreamed = true;
          reasoningStreamed = true;
          usage = addUsage(usage, event.usage);
          return only([{ type: 'chat/usage', turnId, usage: usageOf(usage, options.model) }]);
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
            kind: 'systemNotification',
            content: compactionNotification({ before: event.estimatedTokens, after: event.afterTokens }),
          };
          parts.push(part);
          return only([{ type: 'chat/responsePart', turnId, part: { ...part } }]);
        }
        /*
         * A slash command the run took as its own rather than as a prompt.
         * The line the person typed is already the turn's message, so the
         * start says nothing on the wire. What the command returned is a
         * notice in the turn, as the transcript reads it back; a command that
         * returned nothing leaves the turn with no part, and so does one whose
         * turn already drew a compaction notice, which says what `/compact`'s
         * own output would say again.
         */
        case 'command.started':
          return only([]);
        case 'command.finished': {
          if (event.output === undefined || event.output === '' || compactions > 0) return only([]);
          const part: Bag = { kind: 'systemNotification', content: event.output };
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
          const shown = shownName(event.name, owner);
          /*
           * The kind a client routes by and the line it draws, both off the
           * tool's name: a shell call is a terminal running a command rather
           * than a generic tool with an input. They go out with the part and
           * the action together, so a subscription after the fact and a
           * client watching the stream see the same row.
           */
          const meta = toolMetaOf(event.name);
          const intention = intentionOf(event.name, event.subject);
          const held: OpenCall = {
            name: event.name,
            shown,
            input: event.input,
            subject: event.subject,
            contributor: owner,
            readied: false,
            awaited: false,
            invocation: undefined,
            part: toolCallPart(event.callId, shown, displayName, owner, meta, intention),
          };
          open.set(event.callId, held);
          parts.push(held.part);
          return only([toolStartAction(turnId, event.callId, shown, displayName, owner, meta, intention)]);
        }

        /*
         * A tool call the policy picked out for a person to allow.
         *
         * The call is moved to `pending-confirmation` and said back with a
         * ready action that carries no `confirmed`, which is the reducer's
         * word for "waiting on somebody", and what the host decides it by
         * beside it, with no options of its own: the host puts VS Code's, as
         * VS Code's agents raise a pending confirmation for their host's chain.
         * The entry beside it is what a client that is not watching this chat
         * answers from.
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L167-L178
         */
        case 'approval.requested': {
          const displayName = options.displayNameOf(event.name);
          const prompt = event.prompt ?? `Run ${displayName}?`;
          const held = open.get(event.callId);
          const owner = held?.contributor ?? options.ownerOf(event.name);
          const shown = held?.shown ?? shownName(event.name, owner);
          const meta = toolMetaOf(event.name);
          // The ask carries the input but not the subject, so the one the
          // proposal resolved is what the row keeps, as the live title does.
          const subject = held?.subject;
          const intention = intentionOf(event.name, subject);
          const call: Bag = held === undefined
            ? {
                toolCallId: event.callId,
                toolName: shown,
                displayName,
                ...(intention !== undefined ? { intention } : {}),
                ...(meta !== undefined ? { _meta: meta } : {}),
                ...contributorOf(owner),
              }
            : held.part.toolCall as Bag;
          const confirmation = options.confirmationOf?.(event.name, event.input) ?? {};
          call.status = 'pending-confirmation';
          call.confirmationTitle = prompt;
          call.invocationMessage = prompt;
          delete call.confirmed;
          const written = toolInputOf(event.name, event.input, subject);
          if (written !== undefined) call.toolInput = written;

          const actions: Bag[] = [];
          /*
           * A call the run never proposed, which should not happen but would
           * otherwise be an entry naming a row no client has.
           */
          if (held === undefined) {
            parts.push({ kind: 'toolCall', toolCall: call });
            actions.push(toolStartAction(turnId, event.callId, shown, displayName, owner, meta, intention));
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
            ...confirmation,
          });

          const request: Bag = { id: `approval:${event.requestId}`, chat: options.chatUri, kind: 'toolConfirmation', turnId, toolCall: call };
          const opened: OpenRequest = {
            requestId: event.requestId,
            kind: 'approval',
            callId: event.callId,
            request,
          };
          requests.set(event.requestId, opened);
          actions.push({ type: 'session/inputNeededSet', request });
          return { actions, opened };
        }

        /*
         * The ask tool's questions, which are not about a tool call a client
         * confirms but about what somebody types. The request goes on the
         * chat, where the reducer inserts the part a client answers, and the
         * entry carries the questions and their options, so a composer draws
         * the form from the session channel alone. The questions say what is
         * asked, as VS Code's Claude agent puts a model's questions with no
         * message of its own.
         * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/elicitation.md#L25-L33
         * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L292-L295
         */
        case 'input.requested': {
          const chatRequest: Bag = {
            id: event.requestId,
            questions: event.questions.map(questionOf),
          };
          const request: Bag = { id: `input:${event.requestId}`, chat: options.chatUri, kind: 'chatInput', request: chatRequest };
          const opened: OpenRequest = {
            requestId: event.requestId,
            kind: 'input',
            callId: event.callId,
            request,
          };
          requests.set(event.requestId, opened);
          return {
            actions: [{ type: 'chat/inputRequested', request: chatRequest }, { type: 'session/inputNeededSet', request }],
            opened,
          };
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
          // A client's call reads as its row is titled, by the title its tool
          // was offered under, as the entry asking its client to run it reads.
          const line = held.invocation ?? describe(held.contributor === undefined ? held.shown : options.displayNameOf(held.name), held.subject);
          call.invocationMessage = line;
          call.confirmed = held.awaited ? 'user-action' : 'not-needed';
          const written = toolInputOf(held.name, held.input, held.subject);
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
            invocationMessage: line,
            confirmed: held.awaited ? 'user-action' : 'not-needed',
            ...contributorOf(held.contributor),
            ...(written !== undefined ? { toolInput: written } : {}),
            ...(call._meta === undefined ? {} : { _meta: bag(call._meta) }),
          }]);
        }

        case 'tool.completed': {
          const held = open.get(event.callId);
          open.delete(event.callId);
          const shownTerminals = terminals.get(event.callId) ?? [];
          terminals.delete(event.callId);
          let meta: Bag | undefined;
          if (held !== undefined) {
            const call = held.part.toolCall as Bag;
            call.status = 'completed';
            call.success = !event.isError;
            call.pastTenseMessage = pastTenseOf(held.name, held.shown, held.subject, !event.isError);
            const shown = [...shownTerminals, ...(event.content === '' ? [] : [{ type: 'text', text: event.content }])];
            if (shown.length > 0) call.content = shown;
            if (event.isError) call.error = { message: event.content === '' ? 'The tool failed' : event.content };
            // How long it ran, as cofold measured it from its start.
            call._meta = withToolCallDuration(call._meta === undefined ? undefined : bag(call._meta), event.durationMs);
            meta = call._meta === undefined ? undefined : bag(call._meta);
          }
          return only([toolCompleteAction(turnId, event.callId, held?.name ?? event.name, held?.shown ?? event.name, event.content, event.isError, held?.subject, meta, shownTerminals)]);
        }

        /*
         * A call the run refused, for an unknown tool or arguments that did
         * not validate. It was already announced by `tool.proposed`, so it is
         * closed as a failed call rather than left open for ever; the reason
         * is the result the model is given.
         */
        case 'tool.denied': {
          const held = open.get(event.callId);
          terminals.delete(event.callId);
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
          call.pastTenseMessage = pastTenseOf(held.name, held.shown, held.subject, false);
          call.error = { message: event.reason };
          // A refusal can land before the call ever reached `running`; the
          // ready action is what moves it there so the completion applies.
          const actions: Bag[] = held.readied
            ? []
            : [toolReadyAction(turnId, event.callId, held.shown, held.input, held.contributor, held.subject)];
          actions.push(toolCompleteAction(turnId, event.callId, held.name, held.shown, event.reason, true, held.subject));
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
             *
             * Its type is the stage a send failed at, for a turn the runtime
             * never ran, as VS Code's host types a failed send, and the
             * runtime's own code for a run that failed, as VS Code's Copilot
             * agent carries its SDK's error type.
             * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSdkChatError.ts#L54-L64
             *
             * A new turn's failed send - an agent that could not be built, a
             * prompt with nothing to run on - is not one a resume can put
             * back, and neither is a failure with no point to truncate to.
             */
            const sent = (SEND_FAILURES as readonly string[]).includes(outcome.error.code);
            const resumable = (!sent || options.resumed === true) && options.canTruncate?.() === true;
            actions.push({ type: 'chat/error', turnId, duration, part: errorPart(outcome.error.code, outcome.error.message, resumable) });
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
           * An event cofold's types name and this file does not map is a
           * compile error here, which is the property this file exists to
           * keep. One a newer cofold sends at run time that the types do not
           * name maps to nothing, as VS Code's Claude mapper maps a message
           * type it does not know.
           * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L292-L298
           */
          event satisfies never;
          return only([]);
        }
      }
  };

  return {
    settle,

    opened(callId: string, terminal: CommandTerminal): Bag[] {
      const block: Bag = {
        type: 'terminal',
        resource: terminal.uri,
        title: 'Terminal',
        ...(terminal.isPty === undefined ? {} : { isPty: terminal.isPty }),
      };
      const content = [...(terminals.get(callId) ?? []), block];
      terminals.set(callId, content);
      const part = open.get(callId);
      if (part !== undefined) (part.part.toolCall as Bag).content = [...content];
      return [{ type: 'chat/toolCallContentChanged', turnId, toolCallId: callId, content }];
    },

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
