import { reason } from '@ahpd/sdk';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import { WEBHOOK_TRIGGER } from './automation.js';
import { botTarget, turnEnds } from './bot.js';
import { webhookAdapter } from './adapter.js';
import { DEFAULT_MAX_BODY_BYTES } from './call.js';
import { NAME, webhookRoute } from './route.js';
import type { Bag, Plugin, PluginHost, PluginPeer, TurnEndEvent } from '@ahpd/sdk';
import type { BotChat, BotSeams } from './bot.js';
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

/** What an option falls back to. */
export const defaults = {
  syncTimeoutSeconds: 60,
  maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
} as const;

/** What the plugin's connection calls itself. */
const CLIENT = 'ahpd-webhook';

/** How long a dispatch waits for the host's echo before it goes on as taken, in milliseconds. */
const ECHO_MS = 10_000;

/** Dispatches actions on the plugin's connection, and hears whether the host took each one. */
export interface Dispatcher {
  /** Dispatch one action, and give the host's refusal reason, or `undefined` when the host took it or said nothing. */
  dispatch(channel: string, action: Record<string, unknown>): Promise<string | undefined>;
}

/**
 * The dispatcher over one connection, which sets the connection's one `onMessage` handler.
 *
 * Each dispatch carries the next `clientSeq`. The host answers a dispatch with an
 * `action` frame whose `origin` names `clientId` and that `clientSeq`: with a
 * `rejectionReason` when it refused the action, and without one when it took it.
 * The host echoes a taken action only to the subscribers of its channel, so the
 * caller subscribes first. A dispatch that hears nothing in `waitMs` gives
 * `undefined` and calls `silent`: only a refusal the host sent is a refusal, since
 * a held dispatch can still be applied after the wait.
 */
export function dispatcher(conn: PluginPeer, clientId: string, waitMs = ECHO_MS, silent?: (channel: string) => void): Dispatcher {
  let seq = 0;
  const waiting = new Map<number, (refused: string | undefined) => void>();
  conn.onMessage((message) => {
    if (message.method !== 'action') return;
    const params = message.params as { origin?: { clientId?: unknown; clientSeq?: unknown }; rejectionReason?: unknown } | undefined;
    const origin = params?.origin;
    if (origin?.clientId !== clientId || typeof origin.clientSeq !== 'number') return;
    const done = waiting.get(origin.clientSeq);
    if (done === undefined) return;
    waiting.delete(origin.clientSeq);
    done(typeof params?.rejectionReason === 'string' ? params.rejectionReason : undefined);
  });
  return {
    dispatch: (channel, action) => {
      seq += 1;
      const clientSeq = seq;
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(clientSeq);
          silent?.(channel);
          resolve(undefined);
        }, waitMs);
        timer.unref?.();
        waiting.set(clientSeq, (refused) => {
          clearTimeout(timer);
          resolve(refused);
        });
        conn.notify('dispatchAction', { channel, clientSeq, action });
      });
    },
  };
}

/** POST a JSON body to a callback URL. A redirect is not followed, and fails as any answer that is not 2xx. */
export async function callBack(url: string, body: Record<string, unknown>): Promise<void> {
  const answered = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  if (!answered.ok) throw new Error(`the callback answered ${answered.status}`);
}

/** The plugin's connection to the host, and the dispatcher over it. */
interface Opened {
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
function botSeams(host: PluginHost, open: () => Promise<Opened>, timeout: number): BotSeams {
  const peer = async (): Promise<PluginPeer> => (await open()).conn;
  const ends = turnEnds();
  host.on('turn_end', (event: TurnEndEvent) => { ends.heard(event); });
  const problem = (line: string): void => { host.problem(`${name}: ${line}`); };
  return {
    threads: host.records('webhook-threads'),
    /**
     * The plugin's own chat with the bot, read the way a client reads one.
     *
     * The read answers `chat` only to a reader who may chat - a holder of
     * `bot:chat`, or the bot's owner - and the session is started there if it
     * is not one this host holds, so the two grants the plugin needs are named
     * in one problem line when the read answers the record without it. The chat
     * a turn goes in is then the session's own default chat rather than a name
     * of this plugin's: it is the one the session says is current.
     */
    chat: async (bot): Promise<BotChat | undefined> => {
      const conn = await peer();
      let said: Bag;
      try {
        const read = await conn.request('resourceRead', { uri: bot });
        said = JSON.parse(String((read as { data?: unknown }).data)) as Bag;
      }
      catch (error) {
        problem(`${bot} cannot be read: ${reason(error)}`);
        return undefined;
      }
      const session = said['chat'];
      if (typeof session !== 'string' || session === '') {
        problem(`needs the grants bot:chat and session:create to be answered a chat by ${bot}`);
        return undefined;
      }
      // A chat's state is read off a session the host has loaded, and a subscribe loads it.
      let opened: { snapshot?: { state?: unknown } };
      try {
        opened = await conn.request('subscribe', { channel: session }) as { snapshot?: { state?: unknown } };
      }
      catch (error) {
        problem(`${session} cannot be read: ${reason(error)}`);
        return undefined;
      }
      const chat = ((opened.snapshot?.state ?? {}) as Bag)['defaultChat'];
      if (typeof chat !== 'string' || chat === '') {
        problem(`${session} names no chat to send a turn to`);
        return undefined;
      }
      return { session, chat };
    },
    send: async (chat, turn, text) => {
      const { conn, sender } = await open();
      // The host echoes a taken turn only to the subscribers of its chat.
      await conn.request('subscribe', { channel: chat });
      /*
       * Sent as VS Code's client sends a turn: the time it starts and a
       * person's message, which the host says as it came.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L3717-L3726
       */
      return await sender.dispatch(chat, {
        type: 'chat/turnStarted',
        turnId: turn,
        startedAt: new Date().toISOString(),
        message: { text, origin: { kind: 'user' } },
      });
    },
    forget: (chat, turn) => { ends.forget(chat, turn); },
    ended: async (chat, turn) => {
      const ending = await ends.wait(chat, turn);
      const conn = await peer();
      const opened = await conn.request('subscribe', { channel: chat }) as { snapshot?: { state?: unknown } };
      return { ...ending, text: textOf(opened.snapshot?.state, turn) };
    },
    post: callBack,
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
