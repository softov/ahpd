/**
 * One cofold conversation, rebuilt as the AHP turns a client reads.
 *
 * `transcript(id)` is what makes a catalogue row openable and what a client
 * pages through before anything is started, so this is a read of the store and
 * nothing else: no model, no run and no session. cofold keeps a conversation as
 * `Message`s - a user message, then each assistant reply with its text, its
 * reasoning and its tool calls, and one tool message per result - while AHP
 * wants a turn per user message with every response part in the order it was
 * written. The translation lives here because it reads this backend's own
 * record, the way Claude's transcript reader reads Claude's.
 *
 * The run log is read beside the messages for the two facts a message does not
 * carry: how long a tool call ran, which its `tool.completed` event measured,
 * and the request a paused run is waiting on, which
 * `Store.requests` holds. Everything else comes from the messages themselves,
 * in the order cofold appended them, because a transcript that reorders a tool
 * call and its answer is a conversation read wrong.
 */

import { textOf } from '@cofold/agents';
import type { Message, RunEvent, Store, ToolCallPart, ToolResultPart, Usage } from '@cofold/agents';
import type { Agent, Bag } from '@ahpd/sdk';
import { bag, endedParts, str, withToolCallDuration } from '@ahpd/sdk';
import { compactionNotification } from './mapping.js';
import { describe, pastTenseOf, toolInputOf, toolMetaOf } from './tools.js';

/**
 * The turns `Agent.transcript` answers with.
 *
 * Named by query rather than imported from the protocol package: an agent
 * backend states its protocol shapes through `@ahpd/sdk`, and taking a second
 * dependency to repeat the same type would be a boundary this package does not
 * declare.
 */
type Transcript = NonNullable<Awaited<ReturnType<NonNullable<Agent['transcript']>>>>;
export type TranscriptTurn = Transcript[number];

/** The pieces of a turn, taken from the contract rather than repeated here. */
type WireMessage = TranscriptTurn['message'];
type WireUsage = NonNullable<TranscriptTurn['usage']>;
type WireState = TranscriptTurn['state'];

/** What a run is waiting on, by the call it is about. */
interface Waiting {
  prompt?: string;
}

/** The error a turn ends with when its run was cut off, as VS Code's reader words it. */
const INTERRUPTED: Bag = {
  kind: 'error',
  error: { errorType: 'executionInterrupted', message: 'The agent was interrupted before this request finished.' },
  resumable: true,
};

/**
 * cofold's token counts, in the protocol's spelling.
 *
 * `Turn.usage` is required and may be `undefined`, which is "not measured"
 * rather than "none", so a session with no run behind it answers `undefined`.
 * Cache writes and reasoning tokens have no protocol field; they ride `_meta`
 * exactly as the live mapping sends them, rather than being dropped.
 */
const usageOf = (usage: Usage): WireUsage => {
  const extra: Bag = {
    ...(usage.cacheWriteTokens !== undefined ? { 'ahpd.cacheWriteTokens': usage.cacheWriteTokens } : {}),
    ...(usage.reasoningTokens !== undefined ? { 'ahpd.reasoningTokens': usage.reasoningTokens } : {}),
  };
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(Object.keys(extra).length > 0 ? { _meta: extra } : {}),
  };
};

/**
 * What a call asks the model to say, in one line.
 *
 * The live mapping draws this from the subject the call was proposed with
 * until an approval supplies a better sentence, so a transcript read back says
 * the same thing. The subject comes off the run's own `tool.proposed` events,
 * which is where the live turn read it.
 */
const invocationOf = (call: ToolCallPart, waiting: Waiting | undefined, subject: string | undefined): string =>
  waiting?.prompt ?? describe(call.name, subject);

/**
 * The call's input as the live row wrote it: the command a shell call runs,
 * and the JSON the model produced for every other call.
 */
const inputOf = (call: ToolCallPart, subject: string | undefined): string | undefined => {
  try {
    return toolInputOf(call.name, call.input, subject);
  } catch {
    // An argument shape JSON cannot write is still a fact; the raw string the
    // model produced is the closest honest form of it.
    return call.raw;
  }
};

/**
 * The part a tool call holds between its proposal and its result.
 *
 * A call with no result and no open request is `running` while its turn is
 * read, and the turn's end cancels it as the reducer does (`sealed`). A call a
 * paused run is waiting on is `pending-confirmation`, which is what a client
 * draws a question from.
 *
 * `durationMs` is how long the call ran, as cofold's completion measured it,
 * for a call that completed.
 */
const callPartOf = (
  call: ToolCallPart,
  durationMs: number | undefined,
  waiting: Waiting | undefined,
  subject: string | undefined,
): Bag => {
  const written = inputOf(call, subject);
  const meta: Bag = withToolCallDuration(toolMetaOf(call.name), durationMs) ?? {};
  const held: Bag = {
    toolCallId: call.callId,
    toolName: call.name,
    displayName: call.name,
    invocationMessage: invocationOf(call, waiting, subject),
    ...(written !== undefined ? { toolInput: written } : {}),
    /*
     * How long it ran rides the call's `_meta` under VS Code's key, as VS
     * Code's restored history carries it, and the kind goes with it: an
     * action's `_meta` replaces the whole bag, so a restored call that lost it
     * would draw as a generic tool.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1459
     */
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
  if (waiting !== undefined) {
    held.status = 'pending-confirmation';
    if (waiting.prompt !== undefined) held.confirmationTitle = waiting.prompt;
    return held;
  }
  held.status = 'running';
  held.confirmed = 'not-needed';
  return held;
};

/**
 * Close a call with the result cofold recorded.
 *
 * The mutation is deliberate: the part was pushed into the turn while the call
 * was still open, and a result arriving later moves the same object a
 * subscription already holds. `content` and `error` are where a client looks
 * for what happened, and a failed call keeps both.
 */
const completeCall = (held: Bag, result: ToolResultPart, pastTenseMessage: string | { markdown: string }): void => {
  held.status = 'completed';
  held.success = !result.isError;
  held.pastTenseMessage = pastTenseMessage;
  held.confirmed = held.confirmed ?? 'not-needed';
  if (result.content !== '') held.content = [{ type: 'text', text: result.content }];
  if (result.isError) held.error = { message: result.content === '' ? 'The tool failed' : result.content };
};

/** The turn being built, before it is pushed. */
interface Building {
  id: string;
  startedAt: string;
  message: WireMessage;
  parts: Bag[];
  /** The calls of this turn, by call id, so a result finds the part it closes. */
  calls: Map<string, Bag>;
  usage: WireUsage | undefined;
  state: WireState;
  duration: number | undefined;
  /** Whether a runtime command's typed line began this turn, which words its compaction as asked for. */
  commanded: boolean;
  /** Whether this turn holds a compaction notice, which stands for the command's own output. */
  compacted: boolean;
  /** The id of the last message read into this turn, which is where it ended. */
  end: string;
}

/**
 * One run's events, or nothing when the run is gone.
 *
 * A rewind truncates the conversation while a client may be reading it: the
 * store rewrites the messages and then removes the run folders one by one, so
 * a run listed a moment ago can be gone by the time its events are asked for.
 * `not_found` is that run, and the read goes on without it. Every other store
 * error is a store that would not answer, which is not a run that is gone, and
 * it still ends the read.
 */
const eventsOf = async (store: Store, sessionId: string, runId: string): Promise<RunEvent[] | undefined> => {
  try {
    return await store.runs.listEvents({ sessionId, runId });
  } catch (error) {
    if ((error as { code?: unknown }).code === 'not_found') return undefined;
    throw error;
  }
};

/**
 * One conversation as turns, in the order cofold wrote it.
 *
 * The store is the only input, so a session read here is the same conversation
 * a resumed session appends to rather than a second rendering of it.
 *
 * `ends` is given where each turn ended, by its id: the last message read into
 * it, which a fork copies through and a rewind keeps, as a live turn's run
 * records its last message. A paused run's turn has not ended and names none.
 */
export async function turnsOf(store: Store, sessionId: string, ends?: Map<string, string>): Promise<TranscriptTurn[]> {
  const messages = await store.sessions.listMessages({ sessionId });
  const runs = await store.runs.list({ sessionId });

  /** How long each completed call ran, by call id, gathered once from every run's events. */
  const durations = new Map<string, number>();
  /**
   * What each call acts on, by call id, from the `tool.proposed` that named it.
   *
   * The row is titled by this, exactly as the live turn titled it. A
   * `tool.proposed` that carries no `subject` names nothing, and its row is
   * titled by the tool's name.
   */
  const subject = new Map<string, string>();
  /** The request a paused run is waiting on, by the call it is about. */
  const waiting = new Map<string, Waiting>();
  /** The turns whose run a restart left paused, by their message's id. */
  const interrupted = new Set<string>();
  /**
   * What each compaction had folded, by the summary message it wrote.
   *
   * The numbers live on the `context.compacted` event and nowhere in the
   * message, so a transcript that wants the sentence a live turn showed reads
   * them from the run log. A summary whose event is not here - one written by
   * a store that has been trimmed, or by a version that wrote no event - is
   * still a compaction and still says so, without the numbers.
   */
  const compacted = new Map<string, { before: number; after: number }>();
  /** What each turn cost, how it ended and how long it took, by its first message. */
  const usage = new Map<string, WireUsage>();
  const ending = new Map<string, WireState>();
  const duration = new Map<string, number>();
  /** The model reference each turn's run was told to use, by its first message. */
  const model = new Map<string, string>();

  for (const run of runs) {
    /*
     * The events are read before anything about the run is recorded, so a run
     * that a rewind removed mid-read leaves nothing behind: no usage, no
     * ending, no model, no duration, and none of the call durations, subjects
     * or compaction numbers its events carried.
     */
    const events = await eventsOf(store, sessionId, run.runId);
    if (events === undefined) continue;

    if (run.inputMessageId !== undefined) {
      usage.set(run.inputMessageId, {
        ...usageOf(run.usage),
        ...(run.model !== undefined ? { model: run.model } : {}),
      });
      if (run.model !== undefined) model.set(run.inputMessageId, run.model);
      /*
       * A run a restart left paused reads back as VS Code reads a turn still
       * running when its agent went away: interrupted, an error a client may
       * resume, which continues the run on its question.
       */
      ending.set(
        run.inputMessageId,
        run.status === 'failed' || run.status === 'awaiting' ? 'error' : run.status === 'cancelled' ? 'cancelled' : 'complete',
      );
      if (run.status === 'awaiting') interrupted.add(run.inputMessageId);
      const spent = Date.parse(run.updatedAt) - Date.parse(run.createdAt);
      if (Number.isFinite(spent) && spent >= 0) duration.set(run.inputMessageId, spent);
    }

    for (const event of events) {
      if (event.type === 'tool.proposed' && event.subject !== undefined) subject.set(event.callId, event.subject);
      if (event.type === 'context.compacted') {
        compacted.set(event.messageId, { before: event.estimatedTokens, after: event.afterTokens });
      }
      if (event.type === 'tool.completed') durations.set(event.callId, event.durationMs);
    }

    if (run.status !== 'awaiting' || run.pendingRequestId === undefined) continue;
    const request = await store.requests.get({ sessionId, runId: run.runId, requestId: run.pendingRequestId });
    if (request?.callId === undefined) continue;
    const payload = bag(request.payload);
    const prompt = str(payload.prompt);
    waiting.set(request.callId, {
      ...(prompt !== undefined ? { prompt } : {}),
    });
  }

  /** The turns read so far, sealed once the read is over, so a result read later still reaches its call. */
  const closed: Building[] = [];
  /**
   * Every call read, by its id, so a result closes its call in whatever turn
   * holds it, as VS Code's reader applies a completion to its call by id.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L570-L572
   */
  const everyCall = new Map<string, Bag>();
  let open: Building | undefined;

  /**
   * The turn as the contract wants it, so a half-built one never leaves.
   *
   * A paused run's turn ends with VS Code's error for a turn cut off, after its
   * parts, marked resumable, since a resume continues the run.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts#L499-L500
   */
  /*
   * A finished turn's calls end as the reducer ends them at the turn's end: a
   * call with no result is cancelled as `skipped`, as the live settle holds
   * it. A paused run's turn keeps the call it waits on, which a resume
   * continues.
   */
  const sealed = (turn: Building): TranscriptTurn => ({
    id: turn.id,
    startedAt: turn.startedAt,
    message: turn.message,
    responseParts: interrupted.has(turn.id) ? [...turn.parts, { ...INTERRUPTED }] : endedParts(turn.parts),
    usage: turn.usage,
    state: turn.state,
    ...(turn.duration !== undefined ? { duration: turn.duration } : {}),
  });

  /** A finished turn into the read, and where it ended into `ends`, unless its run is paused. */
  const close = (turn: Building): void => {
    closed.push(turn);
    if (!interrupted.has(turn.id)) ends?.set(turn.id, turn.end);
  };

  /**
   * Open a turn for a message; the previous one is finished by definition.
   *
   * A person's message reads back as the words they typed, its first text part:
   * the turn's message is built from that text and then the parts its
   * attachments were read into, which the live turn said apart from it.
   */
  const begin = (message: Message, origin: 'user' | 'agent'): void => {
    if (open !== undefined) close(open);
    const ran = model.get(message.id);
    const typed = message.parts.find((part) => part.type === 'text');
    open = {
      id: message.id,
      startedAt: message.createdAt,
      message: {
        text: origin === 'user' ? (typed?.type === 'text' ? typed.text : '') : textOf(message),
        origin: { kind: origin },
        // The protocol's `Message.model`, which a client reopens the session on.
        ...(ran !== undefined ? { model: { id: ran } } : {}),
      },
      parts: [],
      calls: new Map(),
      usage: usage.get(message.id),
      state: ending.get(message.id) ?? 'complete',
      duration: duration.get(message.id),
      commanded: message.source === 'command',
      compacted: false,
      end: message.id,
    };
  };

  /** The open turn, opened for this message when a reply has no question in front of it. */
  const ensure = (message: Message): void => {
    if (open === undefined) begin(message, 'agent');
  };

  for (const message of messages) {
    /*
     * A user message the person typed begins a turn, including one cofold
     * appended as a steer part-way through a run: it is a thing somebody said,
     * and the reply that follows it is its answer.
     */
    // A prompt command's expanded text belongs to the turn its typed line began.
    if (message.source === 'skill') {
      if (open !== undefined) open.end = message.id;
      continue;
    }
    if (message.role === 'user' && message.source !== 'system' && message.source !== 'summary' && message.source !== 'notice') {
      begin(message, 'user');
      continue;
    }

    /*
     * The harness's own words - a cancel marker, a compaction summary or what
     * a runtime command returned - are not the person's. They are kept as a
     * system notification rather than dropped, because a transcript that
     * reads as if nothing happened between two turns is a conversation read
     * wrong.
     *
     * A summary is the one of those whose text is not what a person reads: it
     * was written for the model, and the sentence that says a compaction
     * happened is the same one the live turn sent. Every message it stands for
     * stays a turn of its own - `summarizes` says what a request no longer
     * carries, not what the conversation has lost.
     *
     * A summary in a turn a runtime command began is worded as asked for, and
     * that command's notice is left out of a turn that already holds the
     * compaction's, as the live turn drew them.
     */
    if (message.role === 'user' || message.role === 'system') {
      // A harness message before anything was asked opens the turn, and the
      // notification below carries its words: the message text stays empty so
      // the same sentence is not in two places.
      if (open === undefined) begin({ ...message, parts: [] }, 'agent');
      const live = open;
      if (live === undefined) continue;
      live.end = message.id;
      if (message.source === 'notice' && live.compacted) continue;
      const summary = message.source === 'summary';
      const said = summary ? compactionNotification(compacted.get(message.id), { asked: live.commanded }) : textOf(message);
      if (summary) live.compacted = true;
      if (said !== '') live.parts.push({ kind: 'systemNotification', content: said });
      continue;
    }

    if (message.role === 'assistant') {
      ensure(message);
      const live = open;
      if (live === undefined) continue;
      live.end = message.id;
      for (const [index, part] of message.parts.entries()) {
        const id = `${message.id}:${index}`;
        if (part.type === 'text') {
          // Any text is a part, whitespace included, as it is live.
          if (part.text !== '') live.parts.push({ id, kind: 'markdown', content: part.text });
        } else if (part.type === 'reasoning') {
          live.parts.push({ id, kind: 'reasoning', content: part.text });
        } else if (part.type === 'toolCall') {
          const held = callPartOf(part, durations.get(part.callId), waiting.get(part.callId), subject.get(part.callId));
          // Registered before the part is pushed, so the result that follows
          // finds the same object the snapshot holds.
          live.calls.set(part.callId, held);
          everyCall.set(part.callId, held);
          live.parts.push({ kind: 'toolCall', toolCall: held });
        } else if (part.type === 'image') {
          /*
           * AHP has no inline image response part. A system notification is the
           * closest honest shape: it says an image exists without pretending it
           * is model prose or a tool call.
           */
          live.parts.push({ kind: 'systemNotification', content: `[image: ${part.url ?? part.mimeType}]` });
        }
      }
      continue;
    }

    // A tool message is one result, and it closes the call it names.
    ensure(message);
    const live = open;
    if (live === undefined) continue;
    live.end = message.id;
    for (const part of message.parts) {
      if (part.type !== 'toolResult') continue;
      // A result closes its call in whatever turn holds it, and one with no
      // call is dropped, as VS Code's reader drops a completion it has no call for.
      const held = everyCall.get(part.callId);
      if (held === undefined) continue;
      // Worded as the live turn worded it.
      completeCall(held, part, pastTenseOf(String(held.toolName), String(held.displayName), subject.get(part.callId), !part.isError));
    }
  }

  if (open !== undefined) close(open);
  return closed.map(sealed);
}
