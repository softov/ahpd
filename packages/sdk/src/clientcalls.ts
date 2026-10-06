/**
 * A call a client runs, held in one place.
 *
 * Every backend that takes a client's tools needs the same thing: the call
 * raised on the session so a client watching only the session finds it, a
 * promise the harness blocks on, one answer from the client that owns the
 * call, and an end for every way a call can go - answered, abandoned, released
 * or timed out. Three backends grew a copy of that and none of them timed a
 * call out; this is the one copy, with no backend in it.
 *
 * The holder owns the session entry, not the chat's own state: the backend
 * still emits `chat/toolCallStart` and whatever else it says about the call,
 * and still reports the completion from what the harness wrote. What moves
 * here is the entry and the wait.
 */

import type { ToolResultContent } from '@microsoft/agent-host-protocol';
import type { Bag } from './types/common.js';
import type { Emit } from './types/session.js';
import type { OnWire } from './types/wire.js';

/**
 * What a client said its own tool did.
 *
 * `content` is the client's own blocks as it sent them, and `text` is the text
 * blocks joined, which is what a harness that takes only text reads. Both,
 * because a harness that can take an image takes `content` and one that cannot
 * must still be handed something.
 *
 * `OnWire` because the protocol types a block's `type` as a `const enum`, and
 * what a client sent is the string - see `types/wire.ts`.
 */
export interface ClientCallAnswer {
  ok: boolean;
  text: string;
  content: OnWire<ToolResultContent>[];
}

/** One call a client is running, as a backend reports it. */
export interface ClientCall {
  /** The turn the call belongs to, which the entry id names. */
  turnId: string;
  /**
   * The call, as the protocol's `ToolCallRunningState` less what this fills in.
   *
   * `status` and `contributor` are the holder's: it marks the call running and
   * attributes it to `owner`, so a backend reports what it knows and nothing
   * about this. `toolName` is the tool's name *as the client announced it* -
   * the bare name, not the `<clientId>__<name>` the model is offered - because
   * that is the name the failure text uses and the name `providers` answers to.
   */
  toolCall: Bag;
  /** The client that must answer, and the only one that may. */
  owner: string;
}

/** What a holder was built from. */
export interface ClientCallsOptions {
  /** The chat the calls belong to, which the entry carries. */
  chat: string;
  /** Where the entry goes. The backend's own emitter, so it routes as always. */
  emit: Emit;
  /**
   * How long a call may wait, in milliseconds.
   *
   * Absent is {@link DEFAULT_CLIENT_TOOL_TIMEOUT_MS}; zero is no limit at all,
   * which is what a deployment that would rather wait than cut a slow client
   * off asks for.
   */
  timeoutMs?: number;
  /**
   * Which clients offer a tool, by the name the client announced it under.
   *
   * Asked only when a client goes, to tell the model that somebody else has
   * the tool the call was for. A backend with no way to answer returns nothing
   * and the failure says only what happened.
   */
  providers?(name: string): string[];
}

/** The calls one chat has out with its clients. */
export interface ClientCalls {
  /** Hold a call and raise its entry. Answers the entry's id. */
  open(call: ClientCall): string;
  /**
   * Wait for the owner's answer.
   *
   * Rejects for a call that was never opened, which is a backend out of step
   * rather than a tool that failed: an id nobody holds is a turn that would
   * wait for ever on a promise nothing owns.
   */
  wait(toolCallId: string): Promise<ClientCallAnswer>;
  /** Settle a call from the client that owns it. False for anybody else. */
  complete(toolCallId: string, clientId: string, answer: ClientCallAnswer): boolean;
  /** The client a call is out with. */
  owner(toolCallId: string): string | undefined;
  /** Fail one client's calls, because that client is no longer here. */
  gone(clientId: string): void;
  /** Fail every call, for a turn that was stopped or a session that is closing. */
  release(why: string): void;
  /** What is still open, as the snapshot's `inputNeeded` entries. */
  entries(): Bag[];
  /** The same, in the shapes `Session` declares them. */
  methods: {
    toolCallOwner(toolCallId: string): string | undefined;
    completeToolCall(toolCallId: string, clientId: string, result: ClientCallAnswer): boolean;
    clientGone(clientId: string): void;
  };
}

/** How long a call waits when the deployment said nothing: ten minutes. */
export const DEFAULT_CLIENT_TOOL_TIMEOUT_MS = 10 * 60 * 1000;

/** One held call, and everything needed to end it exactly once. */
interface Held {
  id: string;
  /** The model's own id for the call, which is the key it is held under. */
  toolCallId: string;
  entry: Bag;
  owner: string;
  /** The tool's name as the client announced it. */
  name: string;
  answer: Promise<ClientCallAnswer>;
  settle: (answer: ClientCallAnswer) => void;
  timer?: ReturnType<typeof setTimeout>;
  /** Answered, abandoned, released or timed out. Kept only so a late `wait` finds it. */
  finished: boolean;
}

/**
 * How many finished calls are kept for a `wait` that arrives after the answer.
 *
 * A call is reported running before the harness runs the tool, so the owner's
 * answer can land in the gap between the two and the wait comes second. A
 * handful covers a gap that is never long; keeping every answer a chat ever
 * received would hold one record per client tool call for as long as the chat
 * lives.
 */
const KEEP_FINISHED = 32;

export function createClientCalls(options: ClientCallsOptions): ClientCalls {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CLIENT_TOOL_TIMEOUT_MS;
  /** Held by the call id the protocol names the call by, which is not the entry's. */
  const held = new Map<string, Held>();

  /** A call that ended without an answer, in the shape every answer takes. */
  const failed = (text: string): ClientCallAnswer => ({ ok: false, text, content: [{ type: 'text', text }] });

  /**
   * The entry's id, which the removal names and the upsert keys on.
   *
   * Opaque to a client, which only matches it against the removal - so what
   * matters is that one call has one id, and that opening it twice is the same
   * entry rather than a second one.
   */
  const entryId = (turnId: string, toolCallId: string): string =>
    `toolClientExecution:${options.chat}:${turnId}:${toolCallId}`;

  /**
   * End a call, once.
   *
   * One place, because every ending owes the same three things: the entry
   * removed, the timer stopped and the promise settled - and a call that ended
   * twice would emit a removal for an entry that is already gone.
   */
  const end = (call: Held, answer: ClientCallAnswer): void => {
    if (call.finished) return;
    call.finished = true;
    if (call.timer !== undefined) clearTimeout(call.timer);
    options.emit('session', { type: 'session/inputNeededRemoved', id: call.id });
    call.settle(answer);
  };

  /** Forget the finished calls once enough of them have piled up. */
  const prune = (): void => {
    if (held.size <= KEEP_FINISHED) return;
    for (const [key, record] of held) {
      if (held.size <= KEEP_FINISHED) break;
      if (record.finished) held.delete(key);
    }
  };

  const open = (call: ClientCall): string => {
    const toolCallId = String(call.toolCall.toolCallId ?? '');
    const id = entryId(call.turnId, toolCallId);
    // An upsert keyed by id: the second announcement of a call is the call
    // again, and the first one is the one holding the answer.
    const already = held.get(toolCallId);
    if (already !== undefined && !already.finished) return id;

    const entry: Bag = {
      id,
      kind: 'toolClientExecution',
      chat: options.chat,
      turnId: call.turnId,
      clientId: call.owner,
      toolCall: {
        ...call.toolCall,
        status: 'running',
        contributor: { kind: 'client', clientId: call.owner },
      },
    };
    /*
     * The promise is made here, at the open, and not when somebody waits.
     *
     * A call is reported running before the harness runs the tool, so the
     * owner's answer can arrive first. Waiting then finds an answer already
     * given rather than refusing one that came too early.
     */
    let settle!: (answer: ClientCallAnswer) => void;
    const answer = new Promise<ClientCallAnswer>((resolve) => { settle = resolve; });
    const record: Held = {
      id,
      toolCallId,
      entry,
      owner: call.owner,
      name: String(call.toolCall.toolName ?? toolCallId),
      answer,
      settle,
      finished: false,
    };
    held.set(toolCallId, record);
    prune();

    if (timeoutMs > 0) {
      const seconds = Math.round(timeoutMs / 1000);
      record.timer = setTimeout(() => {
        end(record, failed(`${record.name} got no answer from ${record.owner} in ${seconds} s`));
      }, timeoutMs);
    }
    options.emit('session', { type: 'session/inputNeededSet', request: entry });
    return id;
  };

  const wait = (toolCallId: string): Promise<ClientCallAnswer> => {
    const record = held.get(toolCallId);
    return record === undefined
      ? Promise.reject(new Error(`${toolCallId} is not a call a client is running here`))
      : record.answer;
  };

  const complete = (toolCallId: string, clientId: string, answer: ClientCallAnswer): boolean => {
    const record = held.get(toolCallId);
    // False either way - nobody waiting, or somebody else's call - because a
    // client that does not own the call is out of step and the caller says so.
    if (record === undefined || record.finished || record.owner !== clientId) return false;
    end(record, { ok: answer.ok, text: answer.text, content: answer.content ?? [] });
    return true;
  };

  const owner = (toolCallId: string): string | undefined => {
    const record = held.get(toolCallId);
    return record === undefined || record.finished ? undefined : record.owner;
  };

  const gone = (clientId: string): void => {
    for (const record of [...held.values()]) {
      if (record.finished || record.owner !== clientId) continue;
      /*
       * Somebody else may have the same tool, and the model is the one that
       * has to know: the call it made is not one this host can finish, and
       * the tool under that other client's name is.
       */
      const elsewhere = (options.providers?.(record.name) ?? [])
        .filter((one) => one !== clientId)
        .map((one) => `${one}__${record.name}`);
      const hint = elsewhere.length === 0 ? '' : `. ${elsewhere.join(', ')} provides the same tool`;
      end(record, failed(`The client ${clientId} that was running ${record.name} is no longer here${hint}`));
    }
  };

  const release = (why: string): void => {
    for (const record of [...held.values()]) {
      if (!record.finished) end(record, failed(why));
    }
  };

  /** What is still open. A finished call is kept for `wait` and is not an entry. */
  const entries = (): Bag[] => [...held.values()].filter((record) => !record.finished).map((record) => record.entry);

  return {
    open,
    wait,
    complete,
    owner,
    gone,
    release,
    entries,
    methods: {
      toolCallOwner: owner,
      completeToolCall: complete,
      clientGone: gone,
    },
  };
}
