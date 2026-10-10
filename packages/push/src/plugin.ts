import { reason, secretRef, str } from '@ahpd/sdk';
import { deviceStore, pushProvider } from './provider.js';
import { createSender } from './send.js';
import type { DeviceStore } from './provider.js';
import type { PushMessage } from './send.js';
import type { InputNeededSetEvent, Plugin } from '@ahpd/sdk';

/**
 * The package as a plugin.
 *
 * One provider for the `push:` scheme, keeping its devices beside the daemon's
 * own configuration, and one subscription to the host's own moments: a device
 * hears about a session that the client which registered it created or opened,
 * and about nothing else.
 *
 * Which clients those are is what `session_start` and `session_opened` say, and
 * they are the reason this plugin needs no view of a session at all: the host
 * names the client that created a session, the client that wrote a resource and
 * the client that subscribed, and everything here is a set of ids.
 *
 * What a notification says is deliberately thin - the host's name and that a
 * session waits, never what it asks - because the text of a push passes through
 * Expo's service and a phone's lock screen, and neither is where a prompt
 * belongs. Which session it is travels in `data`, which only the app reads.
 */

/** The plugin's id, unique among the plugins a daemon loads. */
export const name = 'ahpd-push';

/** What a listing prints. */
export const title = 'Push';

/** What an option falls back to. */
export const defaults = {} as const;

/**
 * The options `apply` receives, as a JSON Schema the daemon checks them against.
 *
 * `accessToken` is `secretAtUse` so a `{ "$secret": "<name>" }` reaches this
 * plugin as written rather than being read at load, and `writeOnly` so reading
 * the options back answers `<set>` rather than the token - the same shape the
 * computer's machine needs take.
 */
export const optionsSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: "What a notification is titled. The daemon's own name when absent." },
    accessToken: { type: 'string', writeOnly: true, secretAtUse: true, description: 'An Expo access token, where the project has push security on. A name may be given instead of the token, as {"$secret": "host:expo"}.' },
  },
};

/**
 * The kinds of waiting that are a person being asked something.
 *
 * `toolClientExecution` is left out on purpose: the call has cleared its
 * confirmation gate and a client is running it, which the protocol's own
 * reducer does not count as waiting on a person - so a phone that buzzed for
 * one would be a phone woken for work nobody is being asked to do.
 */
const AWAITS_PERSON = ['chatInput', 'toolConfirmation', 'toolAuthentication'];

/** What a notification says, in the words the plan fixed. */
const wording = (kind: string): string =>
  (kind === 'toolConfirmation' ? 'A session is waiting for your approval' : 'A session is waiting for your answer');

/** One device that should hear about a session, and the token to reach it. */
interface Reachable {
  id: string;
  token: string;
}

export const apply: Plugin['apply'] = (host, options) => {
  const store: DeviceStore = deviceStore(host.configDir, (line) => { host.problem(`${name}: ${line}`); });
  host.registerResourceProvider('push', pushProvider({ store }));

  const named = str(options['title']);
  const title = named === undefined || named.trim() === '' ? host.hostName : named;
  const accessToken = options['accessToken'];

  /** The clients that created or opened each session. */
  const opened = new Map<string, Set<string>>();
  /** The `(session, id)` pairs a device has already been told about. */
  const told = new Set<string>();

  const keyOf = (session: string, id: string): string => `${session}\u0000${id}`;

  const remember = (session: string, client: string): void => {
    if (client === '') return;
    const held = opened.get(session);
    if (held === undefined) opened.set(session, new Set([client]));
    else held.add(client);
  };

  /** Every device whose client created or opened this session. */
  const audience = (session: string): Reachable[] => {
    const clients = opened.get(session);
    if (clients === undefined || clients.size === 0) return [];
    const reachable: Reachable[] = [];
    for (const id of store.ids()) {
      const device = store.get(id);
      if (device === undefined || device.client === undefined) continue;
      if (clients.has(device.client)) reachable.push({ id, token: device.token });
    }
    return reachable;
  };

  /** The token for this send, read now rather than kept. */
  const tokenNow = async (): Promise<string | undefined> => {
    const secret = secretRef(accessToken);
    if (secret !== undefined) return await host.secret(secret);
    return str(accessToken);
  };

  const sender = createSender({
    log: (line) => { host.log(`${name}: ${line}`); },
    gone: (token) => {
      for (const id of store.ids()) {
        if (store.get(id)?.token === token) store.remove(id);
      }
    },
  });

  host.on('session_start', (event) => {
    if (event.client !== undefined) remember(event.session, event.client);
  });

  host.on('session_opened', (event) => { remember(event.session, event.client); });

  /**
   * A session began waiting, so the phones of the clients in it are told.
   *
   * The pair is remembered before anything is sent, because the protocol's own
   * action is an upsert that raises this event again for the same entry: what a
   * phone must not get is the same notification twice, and a send that failed
   * is a cost of that rule rather than a reason to break it.
   */
  host.on('input_needed_set', async (event: InputNeededSetEvent) => {
    const pair = keyOf(event.session, event.id);
    if (told.has(pair)) return;
    told.add(pair);
    if (!AWAITS_PERSON.includes(event.kind)) return;
    const reachable = audience(event.session);
    if (reachable.length === 0) return;

    let token: string | undefined;
    try {
      token = await tokenNow();
    }
    catch (error) {
      host.log(`${name}: accessToken could not be read, so nothing was sent: ${reason(error)}`);
      return;
    }

    const messages: PushMessage[] = reachable.map((one) => ({
      to: one.token,
      title,
      body: wording(event.kind),
      data: { uri: event.session, kind: event.kind },
    }));
    await sender.send(messages, token);
  });

  /**
   * The wait is over, and nothing is sent to say so.
   *
   * A second message that clears the first would be two notifications for one
   * question, and a phone that has to be told what it no longer has to do is a
   * phone being made to work for no reason. The pair is forgotten, so a session
   * that asks the same thing again is a new wait and is sent.
   */
  host.on('input_needed_removed', (event) => { told.delete(keyOf(event.session, event.id)); });
};
