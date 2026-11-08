import { randomUUID } from 'node:crypto';
import { reason } from '@ahpd/sdk';
import { parsed } from './record.js';
import { answer } from './route.js';
import { findThread, threadId } from './thread.js';
import type { RecordCollection, TurnEndEvent } from '@ahpd/sdk';
import type { Call } from './call.js';
import type { Dispatched } from './plugin.js';
import type { Endpoint } from './record.js';
import type { Target } from './route.js';
import type { Thread } from './thread.js';

/** How the turn a call's message became ended, and what the bot said in it. */
export interface TurnEnd {
  /** The turn the host started for the message. */
  turn: string;
  status: 'complete' | 'cancelled' | 'error';
  /** The turn's `markdown` response parts, joined. */
  text: string;
  /** The message of the error that ended the turn, on `error` only. */
  error?: string;
}

/** How one turn ended, as the host's `turn_end` says it. */
type Ending = Omit<TurnEnd, 'text'>;

/** What the bot target reads and calls, so a test gives each one. */
export interface BotSeams {
  /** The `webhook-threads` collection. */
  threads: RecordCollection;
  /** The plugin's session with the bot, made with `createSession` where it has none, or nothing when the host made none. */
  session(bot: string): Promise<string | undefined>;
  /**
   * Open a chat of its own in that session, as a client opens one with
   * `createChat`, and answer its URI, or nothing when the host refused it.
   */
  openChat(session: string): Promise<string | undefined>;
  /**
   * Queue one message in a chat under the id `message`, and give what the host
   * made of it: taken, refused with its reason, or unconfirmed.
   */
  send(chat: string, message: string, text: string): Promise<Dispatched>;
  /**
   * Wait for the end of the turn one queued message becomes. Asked before the
   * message is sent, so neither the turn's start nor its end is missed.
   */
  ended(chat: string, message: string): Promise<TurnEnd>;
  /** The turn the host started for one queued message, once it has, while its end is waited for. */
  turnOf(chat: string, message: string): string | undefined;
  /** Stop the wait for one message's turn, for a message the host refused. */
  forget(chat: string, message: string): void;
  /**
   * POST a JSON body to a callback URL, signed for the endpoint under the
   * message id `id`, and settle once it is delivered or given up.
   */
  post(endpoint: Endpoint, url: string, id: string, body: Record<string, unknown>): Promise<void>;
  /** How long a `sync` call waits when its endpoint names no time. */
  syncTimeoutSeconds: number;
  /** Say what went wrong, for the operator to read. */
  problem(line: string): void;
}

/** What one call asks for, read from its body and its query. */
interface Asked {
  thread?: string;
  text?: string;
  callback?: string;
}

/** A non-empty string, or nothing. */
const text = (said: unknown): string | undefined => (typeof said === 'string' && said !== '' ? said : undefined);

/**
 * The thread, text and callback of one call.
 *
 * A body that is an object with a string `text` gives `{ thread, text,
 * callback }` - a JSON object and a form alike, because both arrive as an
 * object. Any other body is the text as it came. The query gives `thread` and
 * `callback` where the body does not.
 */
function asked(call: Call): Asked {
  const kept = typeof call.body === 'object' && call.body !== null && !Array.isArray(call.body)
    ? call.body as Record<string, unknown>
    : undefined;
  const body = typeof kept?.['text'] === 'string' ? kept : undefined;
  const thread = text(body?.['thread']) ?? text(call.query['thread']);
  const callback = text(body?.['callback']) ?? text(call.query['callback']);
  const said = body === undefined ? text(new TextDecoder().decode(call.raw)) : text(body['text']);
  return {
    ...(thread === undefined ? {} : { thread }),
    ...(said === undefined ? {} : { text: said }),
    ...(callback === undefined ? {} : { callback }),
  };
}

/**
 * The callback URL a call may use, or the sentence that refuses it.
 *
 * The URL is compared in the form `new URL` gives it, so a URL whose host only
 * begins with the prefix's host does not pass.
 */
function checkCallback(endpoint: Endpoint, callback: string | undefined): { url: string } | { refused: string } {
  if (endpoint.callbackPrefix === undefined) return { refused: 'This endpoint has no callbackPrefix, so it cannot call back.' };
  if (callback === undefined) return { refused: 'The call needs a callback URL.' };
  const url = parsed(callback);
  if (url === undefined || !url.href.startsWith(endpoint.callbackPrefix)) {
    return { refused: 'The callback URL is outside the endpoint callbackPrefix.' };
  }
  return { url: url.href };
}

/**
 * The window a sender gives a receiver before it counts a delivery failed, in
 * seconds, by the endpoint's scheme: GitHub's ten and Microsoft Graph's three.
 * A sync call's wait is held within it, since an answer after it reaches a
 * sender that has already given up.
 * https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks#respond-within-10-seconds
 * https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks#http-codes-and-retry-logic
 */
const SENDER_WINDOW_SECONDS: Partial<Record<string, number>> = { github: 10, graph: 3 };

/** What a reply says of a turn that ended: the turn, its status, its text, and its error when it failed. */
const ended = (done: TurnEnd): Record<string, unknown> => ({
  turn: done.turn,
  status: done.status,
  text: done.text,
  ...(done.error === undefined ? {} : { error: done.error }),
});

/**
 * Waits for the turns a webhook's messages become, and for their ends.
 *
 * `started` takes every `turn_start` the host raises and keeps the turn each
 * waited message became, as VS Code's router knows the turn the host started
 * for a message it queued by the turn's `queuedMessageId`; `heard` takes
 * every `turn_end`. `wait` gives the end of the turn one message becomes, by
 * chat and message id, and `turnOf` that turn once it began. A wait is made
 * before its message is sent, and `forget` drops it when the host refuses the
 * message.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L250-L259
 */
export function turnEnds() {
  const waiting = new Map<string, { turn?: string; done: (ending: Ending) => void }>();
  /** The message each started turn took up, by chat and turn id. */
  const taken = new Map<string, string>();
  const key = (chat: string, id: string): string => `${chat}\n${id}`;
  return {
    started(event: { chat: string; turn: string; queuedMessageId?: string }): void {
      if (event.queuedMessageId === undefined) return;
      const held = waiting.get(key(event.chat, event.queuedMessageId));
      if (held === undefined) return;
      held.turn = event.turn;
      taken.set(key(event.chat, event.turn), event.queuedMessageId);
    },
    heard(event: Pick<TurnEndEvent, 'channel' | 'turnId' | 'reason'>): void {
      const message = taken.get(key(event.channel, event.turnId));
      if (message === undefined) return;
      taken.delete(key(event.channel, event.turnId));
      const held = waiting.get(key(event.channel, message));
      waiting.delete(key(event.channel, message));
      const { reason: why } = event;
      held?.done(why.kind === 'error' || why.kind === 'rejected'
        ? { turn: event.turnId, status: 'error', error: why.error.message }
        : { turn: event.turnId, status: why.kind === 'cancelled' ? 'cancelled' : 'complete' });
    },
    wait(chat: string, message: string): Promise<Ending> {
      return new Promise((resolve) => { waiting.set(key(chat, message), { done: resolve }); });
    },
    turnOf(chat: string, message: string): string | undefined {
      return waiting.get(key(chat, message))?.turn;
    },
    forget(chat: string, message: string): void {
      const turn = waiting.get(key(chat, message))?.turn;
      waiting.delete(key(chat, message));
      if (turn !== undefined) taken.delete(key(chat, turn));
    },
  };
}

/**
 * The target of a bot endpoint.
 *
 * A call's text is a message queued in its thread's own chat: each caller
 * thread is a conversation of its own with the bot, a chat the plugin opens in
 * its session with the bot, as the spec gives a separate conversation its own
 * chat with `session/chatAdded`. The host takes the message up as a turn once
 * the chat runs nothing, so calls of one thread are answered in the order they
 * came. The endpoint's `reply` decides what the call is answered with.
 */
export function botTarget(seams: BotSeams): Target {
  /** The last lookup of each thread, so the lookups of one thread run one after another and keep one record. */
  const queued = new Map<string, Promise<Thread | undefined>>();

  const lookFor = async (endpoint: Endpoint, thread: string, bot: string): Promise<Thread | undefined> => {
    const session = await seams.session(bot);
    if (session === undefined) return undefined;
    const kept = await findThread(seams.threads, endpoint.id, thread);
    // The session is the one it was, so the record already says where this
    // thread talks. A session started again is a new chat for the thread,
    // written down under the record's own id.
    if (kept !== undefined && kept.session === session) return kept;
    const chat = await seams.openChat(session);
    if (chat === undefined) return undefined;
    const record: Thread = { id: kept?.id ?? threadId(), endpoint: endpoint.id, thread, session, chat };
    await seams.threads.put({ ...record });
    return record;
  };

  const threadOf = (endpoint: Endpoint, thread: string, bot: string): Promise<Thread | undefined> => {
    const key = `${endpoint.id}\n${thread}`;
    const before = queued.get(key) ?? Promise.resolve(undefined);
    const next = before.catch(() => undefined).then(() => lookFor(endpoint, thread, bot));
    queued.set(key, next);
    const forget = (): void => { if (queued.get(key) === next) queued.delete(key); };
    next.then(forget, forget);
    return next;
  };

  return async (endpoint, call) => {
    const askedFor = asked(call);
    if (askedFor.thread === undefined) return answer(400, { message: 'The call needs a thread id.' });
    if (askedFor.text === undefined) return answer(400, { message: 'The call needs a text.' });

    let callback: string | undefined;
    if (endpoint.reply === 'callback') {
      const checked = checkCallback(endpoint, askedFor.callback);
      if ('refused' in checked) return answer(400, { message: checked.refused });
      callback = checked.url;
    }

    const bot = endpoint.bot ?? '';
    const thread = await threadOf(endpoint, askedFor.thread, bot);
    if (thread === undefined) return answer(409, { message: 'The plugin has no chat with the bot.' });
    const message = randomUUID();
    const end = seams.ended(thread.chat, message);
    end.catch((error: unknown) => { seams.problem(`webhooks/${endpoint.id} lost the end of message ${message}: ${reason(error)}`); });
    // The end as soon as it is heard, so a reply after it still names its turn.
    let over: TurnEnd | undefined;
    end.then((done) => { over = done; }, () => undefined);
    const sent = await seams.send(thread.chat, message, askedFor.text);
    if ('refused' in sent) {
      seams.forget(thread.chat, message);
      seams.problem(`webhooks/${endpoint.id} message ${message} was refused: ${sent.refused}`);
      return answer(409, { message: sent.refused });
    }
    const said = { thread: askedFor.thread, queuedMessageId: message };
    /*
     * A send the host never confirmed is neither taken nor refused, and the
     * caller is told so in VS Code's words for it, never as accepted: the
     * message may already be queued.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L283-L287
     */
    if ('unconfirmed' in sent) {
      seams.forget(thread.chat, message);
      return answer(504, { ...said, message: 'Remote message delivery was not confirmed. It may already be queued; do not retry automatically.' });
    }
    /** The turn the message became, where it has become one. */
    const turnNow = (): string | undefined => over?.turn ?? seams.turnOf(thread.chat, message);

    if (endpoint.reply === 'sync') {
      const seconds = Math.min(
        endpoint.syncTimeoutSeconds ?? seams.syncTimeoutSeconds,
        SENDER_WINDOW_SECONDS[endpoint.auth ?? 'bearer'] ?? Number.POSITIVE_INFINITY,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<undefined>((resolve) => { timer = setTimeout(() => { resolve(undefined); }, seconds * 1000); });
      const done = await Promise.race([end, late]);
      clearTimeout(timer);
      if (done === undefined) {
        const turn = turnNow();
        return answer(202, turn === undefined ? { ...said, status: 'queued' } : { ...said, turn, status: 'running' });
      }
      return answer(done.status === 'error' ? 502 : 200, { ...said, ...ended(done) });
    }

    if (callback !== undefined) {
      const url = callback;
      end.then(async (done) => {
        try {
          // The message is what the callback answers, so its id is the
          // message id every attempt carries.
          await seams.post(endpoint, url, message, { ...said, ...ended(done) });
        }
        catch (error) {
          seams.problem(`webhooks/${endpoint.id} could not call back ${url}: ${reason(error)}`);
        }
      }, () => undefined);
    }
    /*
     * Answered as VS Code's router answers a message it queued in another
     * session's chat: sent where the host has started its turn, queued where
     * the message still waits.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L299
     */
    const turn = turnNow();
    return answer(202, turn === undefined ? { ...said, status: 'queued' } : { ...said, turn, status: 'sent' });
  };
}
