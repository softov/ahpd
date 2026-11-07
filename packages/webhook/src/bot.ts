import { randomUUID } from 'node:crypto';
import { reason } from '@ahpd/sdk';
import { parsed } from './record.js';
import { answer } from './route.js';
import { findThread, threadId } from './thread.js';
import type { RecordCollection, TurnEndEvent } from '@ahpd/sdk';
import type { Call } from './call.js';
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

/**
 * One bot's own chat, as the seams give it.
 *
 * A read of the bot answers the session, and the session's own state names the
 * chat a turn is said in. The two are kept separate because a session can be
 * started again under the same chat: what a thread record is about is the chat,
 * and the session is how that chat was found.
 */
export interface BotChat {
  /** The session the bot's read answered, which a thread record keeps. */
  session: string;
  /** The default chat of that session: where every turn of this bot is said. */
  chat: string;
}

/** What the bot target reads and calls, so a test gives each one. */
export interface BotSeams {
  /** The `webhook-threads` collection. */
  threads: RecordCollection;
  /** The bot's own chat, or nothing when the plugin is answered no chat for it. */
  chat(bot: string): Promise<BotChat | undefined>;
  /** Send one turn in a chat, and give the host's reason when it refused the turn, or `undefined` when it took it. */
  send(chat: string, turn: string, text: string): Promise<string | undefined>;
  /** Wait for one turn to end. Asked before the turn is sent, so no end is missed. */
  ended(chat: string, turn: string): Promise<TurnEnd>;
  /** Stop the wait for one turn's end, for a turn the host refused. */
  forget(chat: string, turn: string): void;
  /** POST a JSON body to a callback URL. */
  post(url: string, body: Record<string, unknown>): Promise<void>;
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
 *
 * A turn's end is said in the three words a reply says: a turn that
 * succeeded, or a `!` command the host ran, `complete`; one stopped
 * `cancelled`; one that failed, or whose start the host refused, `error` with
 * its error's message.
 */
export function turnEnds() {
  const waiting = new Map<string, (ending: Ending) => void>();
  const key = (chat: string, turn: string): string => `${chat}\n${turn}`;
  return {
    heard(event: TurnEndEvent): void {
      const done = waiting.get(key(event.channel, event.turnId));
      if (done === undefined) return;
      waiting.delete(key(event.channel, event.turnId));
      const { reason } = event;
      done(reason.kind === 'error' || reason.kind === 'rejected'
        ? { status: 'error', error: reason.error.message }
        : { status: reason.kind === 'cancelled' ? 'cancelled' : 'complete' });
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
 * A call's text is a turn in the bot's own chat: one conversation between this
 * plugin and this bot, which every thread of the endpoint says its turns in.
 * The endpoint's `reply` decides what the call is answered with.
 */
export function botTarget(seams: BotSeams): Target {
  /** The last lookup of each thread, so the lookups of one thread run one after another and keep one record. */
  const queued = new Map<string, Promise<Thread | undefined>>();

  const lookFor = async (endpoint: Endpoint, thread: string, bot: string): Promise<Thread | undefined> => {
    const own = await seams.chat(bot);
    if (own === undefined) return undefined;
    const kept = await findThread(seams.threads, endpoint.id, thread);
    // The bot's chat is the one it was, so the record already says where this
    // thread talks. A chat that moved - a session started again - is written
    // down again, and the record keeps the id it had.
    if (kept !== undefined && kept.session === own.session && kept.chat === own.chat) return kept;
    const record: Thread = { id: kept?.id ?? threadId(), endpoint: endpoint.id, thread, session: own.session, chat: own.chat };
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
    const refused = await seams.send(thread.chat, turn, askedFor.text);
    if (refused !== undefined) {
      seams.forget(thread.chat, turn);
      seams.problem(`webhooks/${endpoint.id} turn ${turn} was refused: ${refused}`);
      return answer(409, { message: refused });
    }
    const said = { thread: askedFor.thread, turn };

    if (endpoint.reply === 'sync') {
      const seconds = endpoint.syncTimeoutSeconds ?? seams.syncTimeoutSeconds;
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
          await seams.post(url, { ...said, ...ended(done) });
        }
        catch (error) {
          seams.problem(`webhooks/${endpoint.id} could not call back ${url}: ${reason(error)}`);
        }
      }, () => undefined);
    }
    return answer(202, said);
  };
}
