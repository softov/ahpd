/**
 * One facio conversation, rebuilt as the AHP turns a client reads.
 *
 * `transcript(id)` is what makes a catalogue row openable and what a client
 * pages through before anything is started, so this is a read of the store and
 * nothing else: no model, no run and no session. facio keeps a conversation as
 * `Message`s - a user message, then each assistant reply with its text, its
 * reasoning and its tool calls, and one tool message per result - while AHP
 * wants a turn per user message with every response part in the order it was
 * written. The translation lives here because it reads this backend's own
 * record, the way Claude's transcript reader reads Claude's.
 *
 * The run log is read beside the messages for the two facts a message does not
 * carry: a tool call's timing, which is in its `tool.started` and
 * `tool.completed` events, and the request a paused run is waiting on, which
 * `Store.requests` holds. Everything else comes from the messages themselves,
 * in the order facio appended them, because a transcript that reorders a tool
 * call and its answer is a conversation read wrong.
 */

import { textOf } from '@facio/agents';
import type { Message, Store, ToolCallPart, ToolResultPart, Usage } from '@facio/agents';
import type { Agent, Bag } from '@ahpd/sdk';

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

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** How a tool call moved, as its events recorded it. */
interface Timing {
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
}

/** What a run is waiting on, by the call it is about. */
interface Waiting {
  prompt?: string;
}

/**
 * facio's token counts, in the protocol's spelling.
 *
 * `Turn.usage` is required and may be `undefined`, which is "not measured"
 * rather than "none", so a session with no run behind it answers `undefined`.
 * Cache writes and reasoning tokens have no protocol field; they ride `_meta`
 * exactly as the live mapping sends them, rather than being dropped.
 */
const usageOf = (usage: Usage): WireUsage => {
  const extra: Bag = {
    ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
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
 * The live mapping draws this from the call's own name until an approval
 * supplies a better sentence, so a transcript read back says the same thing
 * rather than inventing a summary from an argument shape it does not know.
 */
const invocationOf = (call: ToolCallPart, waiting: Waiting | undefined): string =>
  waiting?.prompt ?? call.name;

/** The call's arguments as the wire carries them, which is the JSON the model produced. */
const inputOf = (call: ToolCallPart): string | undefined => {
  if (call.input === undefined) return undefined;
  try {
    return JSON.stringify(call.input);
  } catch {
    // An argument shape JSON cannot write is still a fact; the raw string the
    // model produced is the closest honest form of it.
    return call.raw;
  }
};

/**
 * The part a tool call holds between its proposal and its result.
 *
 * A call with no result and no open request is left `running`: nothing in the
 * store says it finished, and inventing a completion would draw a spinner that
 * stopped for a reason nobody recorded. A call a paused run is waiting on is
 * `pending-confirmation`, which is what a client draws a question from.
 */
const callPartOf = (call: ToolCallPart, timing: Timing | undefined, waiting: Waiting | undefined): Bag => {
  const written = inputOf(call);
  const meta: Bag = {
    ...(timing?.durationMs !== undefined ? { durationMs: timing.durationMs } : {}),
    ...(timing?.startedAt !== undefined ? { startedAt: timing.startedAt } : {}),
    ...(timing?.endedAt !== undefined ? { endedAt: timing.endedAt } : {}),
  };
  const held: Bag = {
    toolCallId: call.callId,
    toolName: call.name,
    displayName: call.name,
    invocationMessage: invocationOf(call, waiting),
    ...(written !== undefined ? { toolInput: written } : {}),
    // AHP's tool-call states have no field for how long a call took, and the
    // events measured it, so it rides the provider metadata rather than being
    // dropped or flattened into a field that means something else.
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
 * Close a call with the result facio recorded.
 *
 * The mutation is deliberate: the part was pushed into the turn while the call
 * was still open, and a result arriving later moves the same object a
 * subscription already holds. `content` and `error` are where a client looks
 * for what happened, and a failed call keeps both.
 */
const completeCall = (held: Bag, result: ToolResultPart): void => {
  held.status = 'completed';
  held.success = !result.isError;
  held.pastTenseMessage = result.name;
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
}

/**
 * One conversation as turns, in the order facio wrote it.
 *
 * The store is the only input, so a session read here is the same conversation
 * a resumed session appends to rather than a second rendering of it.
 */
export async function turnsOf(store: Store, sessionId: string): Promise<TranscriptTurn[]> {
  const messages = await store.sessions.listMessages({ sessionId });
  const runs = await store.runs.list({ sessionId });

  /** When each call ran, by call id, gathered once from every run's events. */
  const timing = new Map<string, Timing>();
  /** The request a paused run is waiting on, by the call it is about. */
  const waiting = new Map<string, Waiting>();
  /** What each turn cost, how it ended and how long it took, by its first message. */
  const usage = new Map<string, WireUsage>();
  const ending = new Map<string, WireState>();
  const duration = new Map<string, number>();

  for (const run of runs) {
    if (run.inputMessageId !== undefined) {
      usage.set(run.inputMessageId, usageOf(run.usage));
      // An `awaiting` run has not ended, and AHP's three states have no word
      // for that; the turn reads complete while its open call says the rest.
      ending.set(
        run.inputMessageId,
        run.status === 'failed' ? 'error' : run.status === 'cancelled' ? 'cancelled' : 'complete',
      );
      const spent = Date.parse(run.updatedAt) - Date.parse(run.createdAt);
      if (Number.isFinite(spent) && spent >= 0) duration.set(run.inputMessageId, spent);
    }

    const events = await store.runs.listEvents({ sessionId, runId: run.runId });
    /** The moment each call started, so its completion can carry a start too. */
    const started = new Map<string, string>();
    for (const event of events) {
      if (event.type === 'tool.started') started.set(event.callId, event.at);
      if (event.type !== 'tool.completed') continue;
      const at = started.get(event.callId);
      timing.set(event.callId, {
        ...(at !== undefined ? { startedAt: at } : {}),
        endedAt: event.at,
        durationMs: event.durationMs,
      });
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

  const turns: TranscriptTurn[] = [];
  let open: Building | undefined;

  /** The turn as the contract wants it, so a half-built one never leaves. */
  const sealed = (turn: Building): TranscriptTurn => ({
    id: turn.id,
    startedAt: turn.startedAt,
    message: turn.message,
    responseParts: turn.parts,
    usage: turn.usage,
    state: turn.state,
    ...(turn.duration !== undefined ? { duration: turn.duration } : {}),
  });

  /** Open a turn for a message; the previous one is finished by definition. */
  const begin = (message: Message, origin: 'user' | 'agent'): void => {
    if (open !== undefined) turns.push(sealed(open));
    open = {
      id: message.id,
      startedAt: message.createdAt,
      message: { text: textOf(message), origin: { kind: origin } },
      parts: [],
      calls: new Map(),
      usage: usage.get(message.id),
      state: ending.get(message.id) ?? 'complete',
      duration: duration.get(message.id),
    };
  };

  /** The open turn, opened for this message when a reply has no question in front of it. */
  const ensure = (message: Message): void => {
    if (open === undefined) begin(message, 'agent');
  };

  for (const message of messages) {
    /*
     * A user message the person typed begins a turn, including one facio
     * appended as a steer part-way through a run: it is a thing somebody said,
     * and the reply that follows it is its answer.
     */
    if (message.role === 'user' && message.source !== 'system' && message.source !== 'summary') {
      begin(message, 'user');
      continue;
    }

    /*
     * The harness's own words - a cancel marker or a compaction summary - are
     * not the person's. They are kept as a system notification rather than
     * dropped, because a transcript that reads as if nothing happened between
     * two turns is a conversation read wrong.
     */
    if (message.role === 'user' || message.role === 'system') {
      // A harness message before anything was asked opens the turn, and the
      // notification below carries its words: the message text stays empty so
      // the same sentence is not in two places.
      if (open === undefined) begin({ ...message, parts: [] }, 'agent');
      const said = textOf(message);
      if (said !== '' && open !== undefined) open.parts.push({ kind: 'systemNotification', content: said });
      continue;
    }

    if (message.role === 'assistant') {
      ensure(message);
      const live = open;
      if (live === undefined) continue;
      for (const [index, part] of message.parts.entries()) {
        const id = `${message.id}:${index}`;
        if (part.type === 'text') {
          live.parts.push({ id, kind: 'markdown', content: part.text });
        } else if (part.type === 'reasoning') {
          live.parts.push({ id, kind: 'reasoning', content: part.text });
        } else if (part.type === 'toolCall') {
          const held = callPartOf(part, timing.get(part.callId), waiting.get(part.callId));
          // Registered before the part is pushed, so the result that follows
          // finds the same object the snapshot holds.
          live.calls.set(part.callId, held);
          live.parts.push({ id: part.callId, kind: 'toolCall', toolCall: held });
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
    for (const part of message.parts) {
      if (part.type !== 'toolResult') continue;
      const held = live.calls.get(part.callId);
      if (held === undefined) {
        // A result whose call is not in this turn, which a cancel can leave
        // behind: kept as a notification rather than dropped silently.
        live.parts.push({ kind: 'systemNotification', content: part.content });
        continue;
      }
      completeCall(held, part);
    }
  }

  if (open !== undefined) turns.push(sealed(open));
  return turns;
}
