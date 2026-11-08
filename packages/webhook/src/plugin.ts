import { randomUUID } from 'node:crypto';
import { reason } from '@ahpd/sdk';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import { WEBHOOK_TRIGGER } from './automation.js';
import { signatureOf, signingKey } from './auth.js';
import { botTarget, turnEnds } from './bot.js';
import { webhookAdapter } from './adapter.js';
import { DEFAULT_MAX_BODY_BYTES } from './call.js';
import { NAME, webhookRoute } from './route.js';
import type { Plugin, PluginHost, PluginPeer, TurnEndEvent, TurnStartEvent } from '@ahpd/sdk';
import type { BotSeams } from './bot.js';
import type { Endpoint } from './record.js';

/**
 * The package as a plugin.
 *
 * One route, `/plugins/webhook/<endpoint>`, and the `webhook` adapter whose
 * open connectors the route serves. Each endpoint holds its own secret, and a
 * call passes only with the proof its `auth` scheme names: a bearer token by
 * default, a header or query token, a generic hmac, or the scheme of GitHub,
 * Stripe, Slack or Standard Webhooks.
 *
 * A bot endpoint talks to its bot through the plugin's own connection to the
 * host, which is opened once the daemon listens. An endpoint naming an
 * automation starts that one, and an endpoint naming neither fires the
 * `webhook` trigger type, which the plugin offers.
 */

/** The plugin's id, unique among the plugins a daemon loads. */
export const name = NAME;

/** What a listing prints. */
export const title = 'Webhook';

/**
 * What an option falls back to.
 *
 * A sync call waits ten seconds, the window GitHub gives a receiver before it
 * counts the delivery failed; a sender with a shorter window holds the wait to
 * it (bot.ts). https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks#respond-within-10-seconds
 */
export const defaults = {
  syncTimeoutSeconds: 10,
  maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
} as const;

/** What the plugin's connection calls itself. */
const CLIENT = 'ahpd-webhook';

/** The provider a chat with a bot runs on, the bot plugin's. */
const BOT_CHAT = 'bot-chat';

/** How long a dispatch waits for the host's echo before its delivery is unconfirmed, in milliseconds. */
const ECHO_MS = 10_000;

/** What the host made of one dispatch: taken, refused with its reason, or never confirmed within the wait. */
export type Dispatched = { taken: true } | { refused: string } | { unconfirmed: true };

/** Dispatches actions on the plugin's connection, and hears whether the host took each one. */
export interface Dispatcher {
  /** Dispatch one action, and give what the host made of it. */
  dispatch(channel: string, action: Record<string, unknown>): Promise<Dispatched>;
}

/**
 * The dispatcher over one connection, which sets the connection's one `onMessage` handler.
 *
 * Each dispatch carries the next `clientSeq`. The host answers a dispatch with an
 * `action` frame whose `origin` names `clientId` and that `clientSeq`: with a
 * `rejectionReason` when it refused the action, and without one when it took it.
 * The host echoes a taken action only to the subscribers of its channel, so the
 * caller subscribes first. A dispatch that hears nothing in `waitMs` is
 * unconfirmed and calls `silent`, as VS Code's router reads a send the host
 * never confirmed: neither taken nor refused, since a held dispatch can still
 * be applied after the wait.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L283-L287
 */
export function dispatcher(conn: PluginPeer, clientId: string, waitMs = ECHO_MS, silent?: (channel: string) => void): Dispatcher {
  let seq = 0;
  const waiting = new Map<number, (said: Dispatched) => void>();
  conn.onMessage((message) => {
    if (message.method !== 'action') return;
    const params = message.params as { origin?: { clientId?: unknown; clientSeq?: unknown }; rejectionReason?: unknown } | undefined;
    const origin = params?.origin;
    if (origin?.clientId !== clientId || typeof origin.clientSeq !== 'number') return;
    const done = waiting.get(origin.clientSeq);
    if (done === undefined) return;
    waiting.delete(origin.clientSeq);
    done(typeof params?.rejectionReason === 'string' ? { refused: params.rejectionReason } : { taken: true });
  });
  return {
    dispatch: (channel, action) => {
      seq += 1;
      const clientSeq = seq;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(clientSeq);
          silent?.(channel);
          resolve({ unconfirmed: true });
        }, waitMs);
        timer.unref?.();
        waiting.set(clientSeq, (said) => {
          clearTimeout(timer);
          resolve(said);
        });
        conn.notify('dispatchAction', { channel, clientSeq, action });
      });
    },
  };
}

/**
 * The waits before each attempt of one callback, Standard Webhooks' example
 * retry schedule: at once, then 5 seconds, 5 minutes, 30 minutes, 2 hours, 5
 * hours, 10 hours, 14 hours, 20 hours and 24 hours after the attempt before.
 * https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
 */
export const RETRY_SCHEDULE_MS = [0, 5_000, 300_000, 1_800_000, 7_200_000, 18_000_000, 36_000_000, 50_400_000, 72_000_000, 86_400_000];

/** How long one attempt waits for its answer: the top of the 15 to 30 seconds Standard Webhooks recommends. */
const ATTEMPT_TIMEOUT_MS = 30_000;

/** What a callback is sent with, so a test gives its own fetch and clock. */
export interface CallBackOptions {
  fetch?: typeof fetch;
  /** The waits before each attempt; `RETRY_SCHEDULE_MS` otherwise. */
  schedule?: readonly number[];
  /** Wait `ms`, and answer once it is over or the plugin closed. */
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * POST a JSON body to a callback URL as Standard Webhooks has a producer send
 * a message: signed with the endpoint's key under `webhook-id`,
 * `webhook-timestamp` and `webhook-signature`, the timestamp the attempt's
 * own, and tried again on the retry schedule until an answer is 2xx. A
 * redirect is not followed and counts as a failure, `410 Gone` ends the tries,
 * and a `retry-after` an answer gives is waited at the least.
 * https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
 */
export async function callBack(endpoint: Endpoint, url: string, id: string, body: Record<string, unknown>, options: CallBackOptions = {}): Promise<void> {
  const key = signingKey(endpoint);
  if (key === undefined) throw new Error(`the endpoint ${endpoint.id} holds no key to sign its callback with`);
  const payload = JSON.stringify(body);
  const schedule = options.schedule ?? RETRY_SCHEDULE_MS;
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms).unref?.(); }));
  let last = '';
  let floor = 0;
  for (const delay of schedule) {
    const waited = Math.max(delay, floor);
    if (waited > 0) await wait(waited);
    const timestamp = Math.floor(now() / 1000);
    let answered: Response;
    try {
      answered = await send(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'webhook-id': id,
          'webhook-timestamp': String(timestamp),
          'webhook-signature': signatureOf(key, id, timestamp, payload),
        },
        body: payload,
        redirect: 'manual',
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
    }
    catch (error) {
      last = reason(error);
      floor = 0;
      continue;
    }
    if (answered.ok) return;
    if (answered.status === 410) throw new Error('the callback answered 410 Gone, so it is not tried again');
    last = `it answered ${String(answered.status)}`;
    const after = Number(answered.headers.get('retry-after'));
    floor = Number.isFinite(after) && after > 0 ? after * 1000 : 0;
  }
  throw new Error(`the callback failed ${String(schedule.length)} times, the last time because ${last}`);
}

/** The plugin's connection to the host, and the dispatcher over it. */
export interface Opened {
  conn: PluginPeer;
  sender: Dispatcher;
}

/** The text of one turn in a chat's state: its `markdown` response parts, joined. */
const textOf = (state: unknown, turn: string): string => {
  const turns = (state as { turns?: unknown } | undefined)?.turns;
  if (!Array.isArray(turns)) return '';
  const found = turns.find((one: unknown) => (one as { id?: unknown }).id === turn) as { responseParts?: unknown } | undefined;
  const parts = Array.isArray(found?.responseParts) ? found.responseParts as { kind?: unknown; content?: unknown }[] : [];
  return parts.filter((part) => part.kind === 'markdown').map((part) => String(part.content ?? '')).join('');
};

/** The bot seams over the plugin's connection, which `peer` gives once it is open. */
export function botSeams(host: PluginHost, open: () => Promise<Opened>, timeout: number): BotSeams {
  const peer = async (): Promise<PluginPeer> => (await open()).conn;
  const ends = turnEnds();
  host.on('turn_start', (event: TurnStartEvent) => { ends.started(event); });
  host.on('turn_end', (event: TurnEndEvent) => {
    const { reason } = event;
    ends.heard({
      chat: event.channel,
      turn: event.turnId,
      ...(reason.kind === 'error' || reason.kind === 'rejected'
        ? { status: 'error' as const, error: reason.error.message }
        : { status: reason.kind === 'cancelled' ? 'cancelled' as const : 'complete' as const }),
    });
  });
  const problem = (line: string): void => { host.problem(`${name}: ${line}`); };
  /*
   * Each chat's subscription, counted by the turns that need it: taken for a
   * send's echo and held to read its end, then let go, as VS Code's router
   * takes a chat's subscription for one delivery through the connection's
   * counted getSubscription and releases it when it settles.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts
   */
  const subscriptions = new Map<string, { count: number; ready: Promise<unknown> }>();
  const hold = async (conn: PluginPeer, chat: string): Promise<void> => {
    const held = subscriptions.get(chat);
    if (held !== undefined) {
      held.count += 1;
      await held.ready;
      return;
    }
    const ready = conn.request('subscribe', { channel: chat });
    subscriptions.set(chat, { count: 1, ready });
    await ready;
  };
  const release = (conn: PluginPeer, chat: string): void => {
    const held = subscriptions.get(chat);
    if (held === undefined) return;
    held.count -= 1;
    if (held.count > 0) return;
    subscriptions.delete(chat);
    conn.notify('unsubscribe', { channel: chat });
  };
  /** The plugin's session with each bot, by the bot's URI, once one is asked for. */
  const withBot = new Map<string, Promise<string | undefined>>();
  // Each callback's wait for its next attempt, ended when the plugin closes.
  const waits = new Map<NodeJS.Timeout, (error: Error) => void>();
  host.registerClose(() => {
    for (const [timer, stop] of waits) {
      clearTimeout(timer);
      stop(new Error('the daemon stopped before the callback was delivered'));
    }
    waits.clear();
  });
  return {
    threads: host.records('webhook-threads'),
    /**
     * The plugin's own session with the bot, made as a client makes a chat
     * with one: `createSession` on the bot's chat provider, the bot named in
     * its config. Made the first time a call to the bot needs it, and again
     * where the host no longer holds it, a daemon that restarted among them.
     */
    session: async (bot): Promise<string | undefined> => {
      const kept = withBot.get(bot);
      if (kept !== undefined) {
        const session = await kept;
        if (session !== undefined && await host.sessionOwner(session) !== undefined) return session;
      }
      const made = (async (): Promise<string | undefined> => {
        let slug: string;
        try {
          slug = new URL(bot).host;
        }
        catch {
          problem(`${bot} is not a bot's URI`);
          return undefined;
        }
        const conn = await peer();
        const session = `ahp-session:/${randomUUID()}`;
        try {
          await conn.request('createSession', { channel: session, provider: BOT_CHAT, config: { bot: slug } });
        }
        catch (error) {
          problem(`could not open a session with ${bot}, which needs the grant session:create: ${reason(error)}`);
          return undefined;
        }
        return session;
      })();
      withBot.set(bot, made);
      return await made;
    },
    /**
     * A chat of one caller thread's own, opened as a client opens one: a
     * `createChat` naming a chat URI of the plugin's choosing, which the host
     * says to the session as `session/chatAdded`.
     */
    openChat: async (session): Promise<string | undefined> => {
      const conn = await peer();
      const chat = `ahp-chat:/${randomUUID()}`;
      try {
        await conn.request('createChat', { channel: session, chat });
      }
      catch (error) {
        problem(`could not open a chat in ${session}, which needs the grant chat:create: ${reason(error)}`);
        return undefined;
      }
      return chat;
    },
    send: async (chat, message, text) => {
      const { conn, sender } = await open();
      // The host echoes a taken message only to the subscribers of its chat.
      await hold(conn, chat);
      /*
       * Queued as VS Code's router sends a message into another session's
       * chat: a pending message whatever the chat is doing, since the host
       * takes queued messages up in the order they came, and an agent's.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L270-L282
       */
      return await sender.dispatch(chat, {
        type: 'chat/pendingMessageSet',
        kind: 'queued',
        id: message,
        message: { text, origin: { kind: 'agent' } },
      });
    },
    turnOf: (chat, message) => ends.turnOf(chat, message),
    forget: (chat, message) => {
      ends.forget(chat, message);
      void peer().then((conn) => { release(conn, chat); });
    },
    ended: async (chat, message) => {
      const ending = await ends.wait(chat, message);
      const conn = await peer();
      try {
        // Read through the subscription the message holds, then let it go.
        const opened = await conn.request('subscribe', { channel: chat }) as { snapshot?: { state?: unknown } };
        return { ...ending, text: textOf(opened.snapshot?.state, ending.turn) };
      }
      finally {
        release(conn, chat);
      }
    },
    post: (endpoint, url, id, body) => callBack(endpoint, url, id, body, {
      wait: (ms) => new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { waits.delete(timer); resolve(); }, ms);
        timer.unref?.();
        waits.set(timer, reject);
      }),
    }),
    syncTimeoutSeconds: timeout,
    problem,
  };
}

export const apply: Plugin['apply'] = (host, options) => {
  const asked = options.syncTimeoutSeconds;
  const timeout = typeof asked === 'number' && asked > 0 ? asked : defaults.syncTimeoutSeconds;
  const askedBytes = options.maxBodyBytes;
  const maxBodyBytes = typeof askedBytes === 'number' && askedBytes > 0
    ? Math.floor(askedBytes)
    : defaults.maxBodyBytes;

  /**
   * The connection, once the daemon listens and the host has answered `initialize`.
   *
   * The handshake offers every version the package speaks, most preferred
   * first, as the spec has a client offer them (docs/specification/versioning.md
   * at spec/v1.0.0, "Negotiation").
   */
  let opened: Promise<Opened> | undefined;
  host.on('listening', () => {
    opened = (async () => {
      const conn = host.connect();
      const sender = dispatcher(conn, CLIENT, ECHO_MS, (channel) => {
        host.problem(`${name}: the host did not echo a turn in ${channel} in ${ECHO_MS / 1000} seconds`);
      });
      await conn.request('initialize', { clientId: CLIENT, protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS] });
      return { conn, sender };
    })();
    opened.catch((error: unknown) => { host.problem(`${name}: the connection to the host failed: ${reason(error)}`); });
  });
  const open = async (): Promise<Opened> => {
    if (opened === undefined) throw new Error('the plugin has no connection to the host yet');
    return await opened;
  };

  host.registerTriggerType(WEBHOOK_TRIGGER);
  const endpoints = new Map<string, Endpoint>();
  host.registerAdapter(webhookAdapter(endpoints));
  host.registerRoute(webhookRoute({
    endpoint: (id) => endpoints.get(id),
    bot: botTarget(botSeams(host, open, timeout)),
    run: (automation, data, owner) => { host.runAutomation(automation, data, owner); },
    fire: (data, owner) => { host.fireTrigger(WEBHOOK_TRIGGER.type, 'call', data, owner); },
    maxBodyBytes,
  }));
};
