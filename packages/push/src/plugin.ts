import { reason, secretRef, str } from '@ahpd/sdk';
import { WEB_PUSH_HOSTS, deviceStore, pushProvider } from './provider.js';
import { createSender } from './send.js';
import { loadVapid } from './vapid.js';
import { createWebSender } from './webpush.js';
import type { Device, DeviceStore } from './provider.js';
import type { PushMessage } from './send.js';
import type { InputNeededSetEvent, Plugin, TurnEndEvent } from '@ahpd/sdk';

/**
 * The package as a plugin.
 *
 * One provider for the `push:` scheme, keeping its devices beside the daemon's
 * own configuration, and one subscription to the host's own moments: a device
 * hears about a session its person owns, or one that the client which
 * registered it created or opened, and about nothing else by default.
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
export const name = 'push';

/** What a listing prints. */
export const title = 'Push';

/** What an option falls back to. */
export const defaults = {
  webPushHosts: [...WEB_PUSH_HOSTS],
} as const;

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

/** What a notification says when a session's own chat finished a turn. */
const FINISHED = 'A session finished';

/** The prefix of a worker's chat, whose turns are the session's work and not its end. */
const WORKER_CHAT = 'ahp-chat://subagent/';

/** One device that should hear about a session. */
interface Reachable {
  id: string;
  device: Device;
}

export const apply: Plugin['apply'] = (host, options) => {
  // A record that is not a device is left out with a line to the log, as VS
  // Code's host drops a malformed stored entry with a warning.
  // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L1298-L1299
  const store: DeviceStore = deviceStore(host.configDir, (line) => { host.log(`${name}: ${line}`); });
  const vapid = loadVapid(host.configDir, (line) => { host.log(`${name}: ${line}`); });
  const webPushHosts = Array.isArray(options['webPushHosts'])
    ? options['webPushHosts'].filter((one): one is string => typeof one === 'string' && one.trim() !== '')
    : [...WEB_PUSH_HOSTS];
  host.registerResourceProvider('push', pushProvider({ store, webPushHosts, ...(vapid === undefined ? {} : { vapid }) }));

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

  /**
   * Every device that should hear about this session.
   *
   * A device hears it when its client created or opened the session, which is
   * the rule it had before a device could choose. A device set to `person`, or
   * left without a setting, also hears every session whose owner the host
   * names as the device's own person. A device with no person has no owner to
   * match, so it keeps the rule of its client alone.
   */
  const audience = async (session: string): Promise<Reachable[]> => {
    const clients = opened.get(session);
    const owner = await host.sessionOwner(session);
    const reachable: Reachable[] = [];
    for (const id of store.ids()) {
      const device = store.get(id);
      if (device === undefined) continue;
      const byClient = device.client !== undefined && clients?.has(device.client) === true;
      const byOwner = device.audience !== 'device' && device.owner !== undefined && owner !== undefined && device.owner === owner;
      if (byClient || byOwner) reachable.push({ id, device });
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
        const device = store.get(id);
        if (device !== undefined && device.platform !== 'web' && device.token === token) store.remove(id);
      }
    },
  });
  host.registerClose(() => { sender.close(); });

  const contact = str(options['contact']);
  const webSender = vapid === undefined ? undefined : createWebSender({
    log: (line) => { host.log(`${name}: ${line}`); },
    gone: (id) => { store.remove(id); },
    vapid,
    ...(contact === undefined || contact.trim() === '' ? {} : { contact: contact.trim() }),
  });

  /** Send `body` to every device in the session, naming the session and why in `data`. */
  const notify = async (session: string, body: string, kind: string): Promise<void> => {
    const reachable = await audience(session);
    if (reachable.length === 0) return;

    const phones = reachable.flatMap((one) => (one.device.platform === 'web' ? [] : [one.device]));
    const browsers = reachable.flatMap((one) => (one.device.platform === 'web' ? [{ id: one.id, device: one.device }] : []));

    if (phones.length > 0) {
      let token: string | undefined;
      let sent = true;
      try {
        token = await tokenNow();
      }
      catch (error) {
        host.log(`${name}: accessToken could not be read, so no phone was sent to: ${reason(error)}`);
        sent = false;
      }
      if (sent) {
        const messages: PushMessage[] = phones.map((device) => ({
          to: device.token,
          title,
          body,
          data: { uri: session, kind },
        }));
        await sender.send(messages, token);
      }
    }

    // A host with no VAPID pair has already said so once, at load, and has no
    // way to sign a request, so a browser is skipped rather than failed.
    if (browsers.length > 0 && webSender !== undefined) {
      await webSender.send(browsers.map((one) => ({
        id: one.id,
        endpoint: one.device.endpoint,
        keys: one.device.keys,
        title,
        body,
        data: { uri: session, kind },
        session,
        urgency: kind === 'turnComplete' ? 'normal' : 'high',
      })));
    }
  };

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
    await notify(event.session, wording(event.kind), event.kind);
  });

  /**
   * A session's own chat finished a turn, so the phones of the clients in it
   * are told it is done. A worker's chat ends many turns inside one of the
   * session's, and a turn somebody stopped was stopped by a person who knows.
   */
  host.on('turn_end', async (event: TurnEndEvent) => {
    if (event.status !== 'complete' || event.chat.startsWith(WORKER_CHAT)) return;
    await notify(event.session, FINISHED, 'turnComplete');
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
