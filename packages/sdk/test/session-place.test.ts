import { loggerOf } from '../src/log.js';
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { idOf } from '../src/sessions/catalog.js';
import { createHost } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { fileSessions, memorySessions } from '../src/sessions/sessions.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import { call, directory, hello, peer, signIn } from './users-gate-helpers.js';
import type { Agent, SessionPlace, Start } from '../src/types/agent.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { SessionStore } from '../src/types/sessions.js';
import type { Grant } from '../src/types/users.js';

/*
 * An agent that places the sessions a client creates on it.
 *
 * A bot's talk runs in the bot's folder, trusted, without the person's own
 * settings, whatever folder the client sent. The agent says so with
 * `placeSession`, and the host takes its answer before it picks a folder and
 * checks the config. A trusted folder needs `session:trust` on the entry of the
 * plugin that registered the agent.
 */

const DIR = mkdtempSync(join(tmpdir(), 'ahpd-session-place-'));
const BOT = join(DIR, 'bot');
const CLIENT = join(DIR, 'client');
/** A folder a plugin registers as its own, and one bot's folder under it. */
const ROOT = join(DIR, 'root');
const SLUG = join(ROOT, 'slug');
/** A link under the root that points out of it. */
const LINK = join(ROOT, 'out');
mkdirSync(BOT, { recursive: true });
mkdirSync(CLIENT, { recursive: true });
mkdirSync(SLUG, { recursive: true });
// A junction on Windows, which needs no privilege; a directory link elsewhere.
symlinkSync(CLIENT, LINK, process.platform === 'win32' ? 'junction' : 'dir');

/** What the last start of the backend was told. */
type Told = { folder?: string; trusted?: boolean; userSettings?: boolean; config?: Record<string, unknown> };

/** The context every plugin in this repository is handed, without a daemon. */
const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});

/**
 * One host, and one plugin whose entry grants `grants` and registers the echo
 * backend as `placed`, with `place` as its hook.
 */
function placing({
  grants, place, store, folders,
}: {
  grants: Grant[];
  place?: (settings: Readonly<Record<string, unknown>>) => SessionPlace | undefined;
  store?: SessionStore;
  /** The folders the plugin registers as its own, which its contracts then announce. */
  folders?: string[];
}) {
  const sessions = store ?? memorySessions();
  const base = echo({ path: DIR, pace: 0 });
  let told: Told = {};
  const agent: Agent = {
    ...base,
    provider: 'placed',
    create: (start: Start) => {
      told = {
        ...(start.workingDirectory === undefined ? {} : { folder: start.workingDirectory }),
        ...(start.trusted === undefined || start.workingDirectory === undefined ? {} : { trusted: start.trusted(start.workingDirectory) }),
        ...(start.userSettings === undefined ? {} : { userSettings: start.userSettings }),
        config: { ...start.settings },
      };
      return base.create(start);
    },
    ...(place === undefined ? {} : { placeSession: place }),
  };
  const contracts = folders === undefined ? undefined : { agents: ['placed'], folders: ['the bots\' workspaces'] };
  const { host: plugin, contribution } = pluginHost('bots', context(), { grants, ...(contracts === undefined ? {} : { contracts }) });
  plugin.registerAgent(agent);
  for (const folder of folders ?? []) plugin.registerFolder(folder);
  const { options } = foldHostOptions({ path: DIR, agents: [], sessions, users: directory({ soft: ['session:*'] }) }, [contribution]);
  return { host: createHost(options), sessions, told: () => told };
}

/** A client signed in as soft, who may make sessions and no machine. */
async function open(host: ReturnType<typeof createHost>) {
  const client = host.accept(peer());
  await hello(client);
  await signIn(client, 'soft');
  return client;
}

/** A client's create of a session on `placed`, in the client's own folder or `folder`. */
const create = (client: Awaited<ReturnType<typeof open>>, uri: string, config: Record<string, unknown> = {}, folder = CLIENT) =>
  call(client, 'createSession', { channel: uri, provider: 'placed', workingDirectories: [`file://${folder}`], config });

it('runs a client\'s session where its agent places it, trusted and without user settings', async () => {
  const { host, told } = placing({ grants: ['session:trust'], place: () => ({ workingDirectory: BOT, trusted: true, userSettings: false }) });
  const client = await open(host);

  const made = await create(client, 'placed:/one');

  expect(made).toEqual({ result: null });
  expect(told()).toMatchObject({ folder: BOT, trusted: true, userSettings: false });
});

it('admits the computer an agent places a session on, as a client\'s', async () => {
  const { host, told } = placing({ grants: ['session:trust'], place: () => ({ computer: 'disposable:s' }) });
  const client = await open(host);

  const refused = await create(client, 'placed:/two') as { code?: number; message?: string };

  // soft may make sessions and no machine, so the source the agent named, a
  // machine to make, is refused at the admission check before any backend
  // starts.
  expect(refused).toMatchObject({ code: -32009, message: 'soft may not computer:write here' });
  expect(told()).toEqual({});
});

it('refuses a trusted place from a plugin without session:trust, naming it', async () => {
  const { host, told } = placing({ grants: ['session:create'], place: () => ({ workingDirectory: BOT, trusted: true }) });
  const client = await open(host);

  const refused = await create(client, 'placed:/three') as { code?: number; message?: string };

  expect(refused.code).toBe(-32009);
  expect(refused.message).toContain('session:trust');
  expect(told()).toEqual({});
});

it('keeps the folder an agent trusted for a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-session-place-store-'));
  const first = fileSessions({ dir });
  const { host } = placing({ grants: ['session:trust'], place: () => ({ workingDirectory: BOT, trusted: true, userSettings: false }), store: first });
  const client = await open(host);

  await create(client, 'placed:/four');
  first.close?.();

  const second = fileSessions({ dir });
  expect(second.trustedFolder?.(idOf('placed:/four'))).toBe(BOT);
  expect(second.userSettings?.(idOf('placed:/four'))).toBe(false);
});

it('runs a session in the client\'s folder when its agent has no hook', async () => {
  const { host, told } = placing({ grants: ['session:trust'] });
  const client = await open(host);

  await create(client, 'placed:/five');

  expect(told().folder).toBe(CLIENT);
  expect(told().userSettings).toBeUndefined();
});

it('trusts a place under a folder the plugin registered, with no grant', async () => {
  const { host, told } = placing({ grants: [], folders: [ROOT], place: () => ({ workingDirectory: SLUG, trusted: true, userSettings: false }) });
  const client = await open(host);

  const made = await create(client, 'placed:/six');

  expect(made).toEqual({ result: null });
  expect(told()).toMatchObject({ folder: SLUG, trusted: true });
});

it('refuses a trusted place outside the folder the plugin registered, naming session:trust', async () => {
  const { host, told } = placing({ grants: [], folders: [ROOT], place: () => ({ workingDirectory: BOT, trusted: true }) });
  const client = await open(host);

  const refused = await create(client, 'placed:/seven') as { code?: number; message?: string };

  expect(refused).toMatchObject({ code: -32009, message: 'plugin:bots may not session:trust here' });
  expect(told()).toEqual({});
});

it('refuses a trusted place through a link that leaves the registered folder', async () => {
  const { host, told } = placing({ grants: [], folders: [ROOT], place: () => ({ workingDirectory: LINK, trusted: true }) });
  const client = await open(host);

  const refused = await create(client, 'placed:/eight') as { code?: number; message?: string };

  expect(refused.message).toContain('session:trust');
  expect(told()).toEqual({});
});

it('does not trust a plain session a client opens in the registered folder', async () => {
  const { host, told } = placing({ grants: [], folders: [ROOT] });
  const client = await open(host);

  await create(client, 'placed:/nine', {}, SLUG);

  expect(told()).toMatchObject({ folder: SLUG, trusted: false });
});

it('refuses a folder the manifest does not announce, and a relative one', () => {
  const none = pluginHost('bare', context(), {}).host;
  expect(() => { none.registerFolder(ROOT); }).toThrow(/contracts declare folders/);

  const other = pluginHost('other', context(), { contracts: { agents: ['placed'] } }).host;
  expect(() => { other.registerFolder(ROOT); }).toThrow(/contracts\.folders/);

  const announced = pluginHost('announced', context(), { contracts: { folders: ['its own'] } }).host;
  expect(() => { announced.registerFolder('relative/folder'); }).toThrow(/an absolute path/);
});
