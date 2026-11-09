import { posix } from 'node:path';
import { Status, bag, idOf, reason, secretRef, str, translated } from '@ahpd/sdk';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import { WEB_PUSH_HOSTS, deviceStore, pushProvider } from './provider.js';
import { createSender } from './send.js';
import { loadVapid } from './vapid.js';
import { createWebSender } from './webpush.js';
import type { Device, DeviceStore } from './provider.js';
import type { PushMessage } from './send.js';
import type { Bag, Plugin, PluginPeer } from '@ahpd/sdk';
import type { LogLevel } from '@ahpd/sdk';

/**
 * The package as a plugin.
 *
 * One provider for the `push:` scheme, keeping its devices beside the daemon's
 * own configuration, and VS Code's sessions window notifier, carried to the
 * devices of the person a session is for.
 *
 * The notifier is a client of this host, as that window is. It holds the
 * host's session list, read with `listSessions` once the daemon listens and
 * kept by the root channel's `sessionAdded`, `sessionSummaryChanged` and
 * `sessionRemoved`, and it watches each session's status as the window reads
 * it. A session that moves into needing input or into failure is told at once.
 * One that moves into completed is told a second and a half later, and only if
 * it is still completed then, so a queued turn starting in between tells
 * nothing. Any move drops a completed notice still to come, and the status a
 * session is listed at is where it starts, never a move.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/sessions/browser/sessionsWindowNotifier.ts#L76-L101
 *
 * The words are that notifier's, in the language the device registered with:
 * `Session: <title>` above `Attention needed.`, `Session completed.` or
 * `Session failed.`, each naming the session's workspace where it has one.
 * Which session it is travels in `data`, which the app reads to open it.
 */

/** The plugin's id, unique among the plugins a daemon loads. */
export const name = 'push';

/** What a listing prints. */
export const title = 'Push';

/** What an option falls back to. */
export const defaults = {
  webPushHosts: [...WEB_PUSH_HOSTS],
} as const;

/** The client this plugin's connection names itself at `initialize`. */
const CLIENT = 'ahpd-push';

/** The channel whose notifications keep the session list. */
const ROOT = 'ahp-root://';

/**
 * How long a completed session waits before it is told, in milliseconds: VS
 * Code's delay, which swallows the gap between a turn ending and the next
 * queued turn starting.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/sessions/browser/sessionsWindowNotifier.ts#L58-L66
 */
export const COMPLETED_DELAY_MS = 1_500;

/** A session's status, as VS Code's sessions window reads it. */
type Shown = 'inProgress' | 'needsInput' | 'completed' | 'error';

/** The statuses a person is told about. */
type Told = Exclude<Shown, 'inProgress'>;

/**
 * VS Code's `mapProtocolStatus`: input needed over in progress over error,
 * and completed for every other status.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/providers/agentHost/browser/agentHostDiffs.ts#L21-L33
 */
const shownOf = (status: number): Shown => {
  if ((status & Status.InputNeeded) === Status.InputNeeded) return 'needsInput';
  if ((status & Status.InProgress) !== 0) return 'inProgress';
  if ((status & Status.Error) !== 0) return 'error';
  return 'completed';
};

/**
 * What VS Code titles a session: its summary's title, else `Session` and the
 * first eight characters of its id.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/providers/agentHost/browser/baseAgentHostSessionsProvider.ts#L1647
 */
const titleOf = (session: string, said: unknown): string =>
  (typeof said === 'string' && said !== '' ? said : `Session ${idOf(session).slice(0, 8)}`);

/**
 * The workspace a notice names: the project's name, else the last segment of
 * the first working directory, as VS Code labels an agent host session's
 * workspace on the machine it runs on.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/common/agentHostSessionWorkspace.ts#L260-L290
 */
const workspaceOf = (project: unknown, workingDirectories: unknown): string | undefined => {
  const named = str(bag(project)['displayName']);
  if (named !== undefined && named !== '') return named;
  const first = Array.isArray(workingDirectories) ? workingDirectories[0] : undefined;
  if (typeof first !== 'string') return undefined;
  let path: string;
  try {
    path = decodeURIComponent(new URL(first).pathname);
  }
  catch {
    return undefined;
  }
  return posix.basename(path) || path;
};

/**
 * Each status's body, alone and naming a workspace: VS Code's
 * `_getNotificationBody`, by the keys its `localize` calls name.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/sessions/browser/sessionsWindowNotifier.ts#L176-L194
 */
const BODIES: Record<Told, { key: string; english: string; inKey: string; inEnglish: string }> = {
  needsInput: {
    key: 'sessions.notification.needsInput',
    english: 'Attention needed.',
    inKey: 'sessions.notification.needsInputWithWorkspace',
    inEnglish: 'Attention needed in {0}.',
  },
  completed: {
    key: 'sessions.notification.completed',
    english: 'Session completed.',
    inKey: 'sessions.notification.completedWithWorkspace',
    inEnglish: 'Completed in {0}.',
  },
  error: {
    key: 'sessions.notification.failed',
    english: 'Session failed.',
    inKey: 'sessions.notification.failedWithWorkspace',
    inEnglish: 'Failed in {0}.',
  },
};

/** One session the list holds. */
interface Listed {
  /** What it is called, as VS Code titles it. */
  title: string;
  /** Its summary's project, which the workspace label reads first. */
  project: unknown;
  /** Its summary's working directories, which the workspace label reads after. */
  workingDirectories: unknown;
  /** Its status, as VS Code's sessions window reads it. */
  status: Shown;
  /** The completed notice still to come, which any move drops. */
  completed?: ReturnType<typeof setTimeout>;
}

export const apply: Plugin['apply'] = (host, options) => {
  // A record that is not a device is left out with a line to the log, as VS
  // Code's host drops a malformed stored entry with a warning.
  // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L1298-L1299
  const store: DeviceStore = deviceStore(host.configDir, (line: string, level?: LogLevel) => { host.log(`${name}: ${line}`, level); });
  const vapid = loadVapid(host.configDir, (line: string, level?: LogLevel) => { host.log(`${name}: ${line}`, level); });
  const webPushHosts = Array.isArray(options['webPushHosts'])
    ? options['webPushHosts'].filter((one): one is string => typeof one === 'string' && one.trim() !== '')
    : [...WEB_PUSH_HOSTS];
  host.registerResourceProvider('push', pushProvider({ store, webPushHosts, ...(vapid === undefined ? {} : { vapid }) }));

  const accessToken = options['accessToken'];

  /** The session list, as this plugin's connection keeps it. */
  const listed = new Map<string, Listed>();
  /** Whether the connection has been opened, which happens once. */
  let connected = false;

  /** The token for this send, read now rather than kept. */
  const tokenNow = async (): Promise<string | undefined> => {
    const secret = secretRef(accessToken);
    if (secret !== undefined) return await host.secret(secret);
    return str(accessToken);
  };

  const sender = createSender({
    log: (line: string, level?: LogLevel) => { host.log(`${name}: ${line}`, level); },
    gone: (token) => {
      for (const id of store.ids()) {
        const device = store.get(id);
        if (device !== undefined && device.platform !== 'web' && device.token === token) store.remove(id);
      }
    },
  });

  const contact = str(options['contact']);
  const webSender = vapid === undefined ? undefined : createWebSender({
    log: (line: string, level?: LogLevel) => { host.log(`${name}: ${line}`, level); },
    gone: (id) => { store.remove(id); },
    vapid,
    ...(contact === undefined || contact.trim() === '' ? {} : { contact: contact.trim() }),
  });

  /** The clients that created or opened each session, as the host says them. */
  const opened = new Map<string, Set<string>>();
  host.on('session_start', (event) => {
    if (event.client === undefined || event.client === '') return;
    opened.set(event.session, (opened.get(event.session) ?? new Set()).add(event.client));
  });
  host.on('session_opened', (event) => {
    if (event.client === '') return;
    opened.set(event.session, (opened.get(event.session) ?? new Set()).add(event.client));
  });
  host.on('session_end', (event) => { opened.delete(event.session); });

  /**
   * The devices that hear about a session, as each registration chose
   * (Softov 2026-10-31: "A setting per device").
   *
   * Every device hears the sessions its own client created or opened. A
   * `person` device, which is one that says nothing, also hears every session
   * of its person: on a host with people the ones the session's owner
   * registered, and on a host with none every session, its one person's.
   */
  const audience = async (session: string): Promise<{ id: string; device: Device }[]> => {
    const owner = host.hasUsers === true ? await host.sessionOwner(session) : undefined;
    const clients = opened.get(session);
    return store.ids().flatMap((id) => {
      const device = store.get(id);
      if (device === undefined) return [];
      const byClient = device.client !== undefined && clients?.has(device.client) === true;
      const byPerson = device.audience !== 'device'
        && (host.hasUsers !== true || (owner !== undefined && device.owner === owner));
      return byClient || byPerson ? [{ id, device }] : [];
    });
  };

  /**
   * One notice's words in the language a device registered with, `{0}` filled
   * and backticks made plain quotes, as VS Code makes an OS toast's text.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/sessions/browser/sessionsWindowNotifier.ts#L196-L198
   */
  const say = (key: string, english: string, lang: string | undefined, value: string): string =>
    translated(['messages', key], english, lang, host.i18n).replace('{0}', () => value).replaceAll('`', '\'');

  /**
   * Tell a session's devices it reached `status`, if it is still there.
   *
   * `kind` in `data` is VS Code's notification kind for the status, which its
   * toast is deduplicated by: `needsInput`, or `idle` for a session that
   * completed or failed. A wait goes to a browser at high urgency, and the
   * other two at normal, RFC 8030's urgencies for an alert and a message.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/sessions/browser/sessionsWindowNotifier.ts#L132-L139
   */
  const notify = async (session: string, status: Told): Promise<void> => {
    const held = listed.get(session);
    if (held === undefined || held.status !== status) return;
    const reachable = await audience(session);
    if (reachable.length === 0) return;

    const workspace = workspaceOf(held.project, held.workingDirectories);
    const words = BODIES[status];
    const shown = (device: Device): { title: string; body: string } => ({
      title: say('sessions.notification.title', 'Session: {0}', device.lang, held.title),
      body: workspace === undefined
        ? say(words.key, words.english, device.lang, '')
        : say(words.inKey, words.inEnglish, device.lang, workspace),
    });
    const data = { uri: session, kind: status === 'needsInput' ? 'needsInput' : 'idle' };

    const phones = reachable.flatMap((one) => (one.device.platform === 'web' ? [] : [one.device]));
    if (phones.length > 0) {
      let token: string | undefined;
      let sent = true;
      try {
        token = await tokenNow();
      }
      catch (error) {
        host.log.error(`${name}: accessToken could not be read, so no phone was sent to: ${reason(error)}`);
        sent = false;
      }
      if (sent) {
        const messages: PushMessage[] = phones.map((device) => ({ to: device.token, ...shown(device), data }));
        await sender.send(messages, token);
      }
    }

    // A host with no VAPID pair has already said so once, at load, and has no
    // way to sign a request, so a browser is skipped.
    const browsers = reachable.flatMap((one) => (one.device.platform === 'web' ? [{ id: one.id, device: one.device }] : []));
    if (browsers.length > 0 && webSender !== undefined) {
      await webSender.send(browsers.map((one) => ({
        id: one.id,
        endpoint: one.device.endpoint,
        keys: one.device.keys,
        ...shown(one.device),
        data,
        session,
        urgency: status === 'needsInput' ? 'high' : 'normal',
      })));
    }
  };

  const tell = (session: string, status: Told): void => {
    notify(session, status).catch((error: unknown) => { host.log.error(`${name}: ${session} could not be told: ${reason(error)}`); });
  };

  /** A session the list no longer holds, with its completed notice dropped. */
  const drop = (session: string): void => {
    const held = listed.get(session);
    if (held?.completed !== undefined) clearTimeout(held.completed);
    listed.delete(session);
  };

  /** A session the list now holds, at the status it starts from. */
  const track = (summary: Bag): void => {
    const session = str(summary['resource']);
    if (session === undefined || session === '') return;
    drop(session);
    listed.set(session, {
      title: titleOf(session, summary['title']),
      project: summary['project'],
      workingDirectories: summary['workingDirectories'],
      status: shownOf(Number(summary['status'])),
    });
  };

  /**
   * One status move, as VS Code's notifier takes it: a pending completed
   * notice dropped, a completed one scheduled, a wait or a failure told now.
   */
  const moved = (session: string, held: Listed, next: Shown): void => {
    if (held.status === next) return;
    held.status = next;
    if (held.completed !== undefined) {
      clearTimeout(held.completed);
      delete held.completed;
    }
    if (next === 'completed') {
      const timer = setTimeout(() => {
        if (held.completed === timer) delete held.completed;
        tell(session, 'completed');
      }, COMPLETED_DELAY_MS);
      timer.unref?.();
      held.completed = timer;
    }
    if (next === 'needsInput' || next === 'error') tell(session, next);
  };

  /**
   * What the root channel says about the list. A change to a session the list
   * does not hold is let go, as the spec lets a client with no cached entry
   * ignore it.
   * https://github.com/microsoft/agent-host-protocol/blob/spec/v1.0.0/types/channels-root/notifications.ts#L107-L108
   */
  const take = (message: Record<string, unknown>): void => {
    const params = bag(message['params']);
    if (message['method'] === 'root/sessionAdded') {
      track(bag(params['summary']));
      return;
    }
    if (message['method'] === 'root/sessionRemoved') {
      drop(String(params['session'] ?? ''));
      return;
    }
    if (message['method'] !== 'root/sessionSummaryChanged') return;
    const session = String(params['session'] ?? '');
    const held = listed.get(session);
    if (held === undefined) return;
    const changes = bag(params['changes']);
    if ('title' in changes) held.title = titleOf(session, changes['title']);
    if ('project' in changes) held.project = changes['project'];
    if ('workingDirectories' in changes) held.workingDirectories = changes['workingDirectories'];
    if (typeof changes['status'] === 'number') moved(session, held, shownOf(changes['status']));
  };

  /**
   * The connection, opened when the daemon listens, which is the first moment
   * a plugin may connect.
   *
   * The root channel is subscribed before the list is read, so a session made
   * while it is read is already held; a listed session the channel brought in
   * first is kept as the channel said it. A list that cannot be read is one
   * line to the log, and the sessions the channel adds from then on are still
   * told: on a host with people, the list is `session:list`, which this
   * plugin's entry in the configuration grants.
   */
  host.on('listening', () => {
    if (connected) return;
    connected = true;
    let conn: PluginPeer;
    try {
      conn = host.connect();
    }
    catch (error) {
      host.log.warn(`${name}: no connection to this host, so no session is told: ${reason(error)}`);
      return;
    }
    conn.onMessage(take);
    void (async () => {
      await conn.request('initialize', { clientId: CLIENT, protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS] });
      await conn.request('subscribe', { channel: ROOT });
      let cursor: string | undefined;
      do {
        const page = bag(await conn.request('listSessions', { channel: ROOT, ...(cursor === undefined ? {} : { cursor }) }));
        for (const item of Array.isArray(page['items']) ? page['items'] : []) {
          const summary = bag(item);
          const session = str(summary['resource']);
          if (session !== undefined && !listed.has(session)) track(summary);
        }
        cursor = str(page['nextCursor']);
      } while (cursor !== undefined && cursor !== '');
    })().catch((error: unknown) => { host.log.error(`${name}: the host's session list could not be read: ${reason(error)}`); });
  });

  host.registerClose(() => {
    for (const session of [...listed.keys()]) drop(session);
    sender.close();
  });
};
