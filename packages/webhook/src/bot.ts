import { randomUUID } from 'node:crypto';
import { reason } from '@ahpd/sdk';
import { parsed } from './record.js';
import { answer } from './route.js';
import { findThread, threadId } from './thread.js';
import type { RecordCollection } from '@ahpd/sdk';
import type { Call } from './call.js';
import type { Dispatched } from './plugin.js';
import type { Endpoint } from './record.js';
import type { Target } from './route.js';
import type { Thread } from './thread.js';

/** How one turn ended, and what the bot said in it. */
export interface TurnEnd {
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
  /** The plugin's session with the bot, which a read of the bot answers, or nothing when it answers none. */
  session(bot: string): Promise<string | undefined>;
  /**
   * Open a chat of its own in that session, as a client opens one with
   * `createChat`, and answer its URI, or nothing when the host refused it.
   */
  openChat(session: string): Promise<string | undefined>;
  /** Send one turn in a chat, and give what the host made of it: taken, refused with its reason, or unconfirmed. */
  send(chat: string, turn: string, text: string): Promise<Dispatched>;
  /** Wait for one turn to end. Asked before the turn is sent, so no end is missed. */
  ended(chat: string, turn: string): Promise<TurnEnd>;
  /** Stop the wait for one turn's end, for a turn the host refused. */
  forget(chat: string, turn: string): void;
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

/** What a reply says of a turn that ended: its status, its text, and its error when it failed. */
const ended = (done: TurnEnd): Record<string, unknown> => ({
  status: done.status,
  text: done.text,
  ...(done.error === undefined ? {} : { error: done.error }),
});

/**
 * Waits for the end of the turns a webhook sent.
 *
 * `heard` takes every `turn_end` the host raises, and `wait` gives the end of
 * one turn by chat and turn id. A wait is made before its turn is sent, and
 * `forget` drops it when the host refuses the turn.
 */
export function turnEnds() {
  const waiting = new Map<string, (ending: Ending) => void>();
  const key = (chat: string, turn: string): string => `${chat}\n${turn}`;
  return {
    heard(event: { chat: string; turn: string } & Ending): void {
      const done = waiting.get(key(event.chat, event.turn));
      if (done === undefined) return;
      waiting.delete(key(event.chat, event.turn));
      done(event.error === undefined ? { status: event.status } : { status: event.status, error: event.error });
    },
    wait(chat: string, turn: string): Promise<Ending> {
      return new Promise((resolve) => { waiting.set(key(chat, turn), resolve); });
    },
    forget(chat: string, turn: string): void {
      waiting.delete(key(chat, turn));
    },
  };
}

/**
 * The target of a bot endpoint.
 *
 * A call's text is a turn in its thread's own chat: each caller thread is a
 * conversation of its own with the bot, a chat the plugin opens in its session
 * with the bot, as the spec gives a separate conversation its own chat with
 * `session/chatAdded`. The endpoint's `reply` decides what the call is
 * answered with.
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
    const turn = randomUUID();
    const end = seams.ended(thread.chat, turn);
    end.catch((error: unknown) => { seams.problem(`webhooks/${endpoint.id} lost the end of turn ${turn}: ${reason(error)}`); });
    const sent = await seams.send(thread.chat, turn, askedFor.text);
    if ('refused' in sent) {
      seams.forget(thread.chat, turn);
      seams.problem(`webhooks/${endpoint.id} turn ${turn} was refused: ${sent.refused}`);
      return answer(409, { message: sent.refused });
    }
    /*
     * A send the host never confirmed is neither taken nor refused, and the
     * caller is told so in VS Code's words for it, never as accepted: the
     * turn may already be queued.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L283-L287
     */
    if ('unconfirmed' in sent) {
      seams.forget(thread.chat, turn);
      return answer(504, { thread: askedFor.thread, turn, message: 'Remote message delivery was not confirmed. It may already be queued; do not retry automatically.' });
    }
    const said = { thread: askedFor.thread, turn };

    if (endpoint.reply === 'sync') {
      const seconds = Math.min(
        endpoint.syncTimeoutSeconds ?? seams.syncTimeoutSeconds,
        SENDER_WINDOW_SECONDS[endpoint.auth ?? 'bearer'] ?? Number.POSITIVE_INFINITY,
      );
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<undefined>((resolve) => { timer = setTimeout(() => { resolve(undefined); }, seconds * 1000); });
      const done = await Promise.race([end, late]);
      clearTimeout(timer);
      if (done === undefined) return answer(202, { ...said, status: 'running' });
      return answer(done.status === 'error' ? 502 : 200, { ...said, ...ended(done) });
    }

    if (callback !== undefined) {
      const url = callback;
      end.then(async (done) => {
        try {
          // The turn is the event the callback is about, so its id is the
          // message id every attempt carries.
          await seams.post(endpoint, url, turn, { ...said, ...ended(done) });
        }
        catch (error) {
          seams.problem(`webhooks/${endpoint.id} could not call back ${url}: ${reason(error)}`);
        }
      }, () => undefined);
    }
    return answer(202, said);
  };
}
