import { loggerOf } from '../src/log.js';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { idOf } from '../src/sessions/catalog.js';
import { createHost } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { fileSessions, memorySessions } from '../src/sessions/sessions.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import { directory, hello, peer, signIn } from './users-gate-helpers.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { HostOptions } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { SessionStore } from '../src/types/sessions.js';
import type { Grant } from '../src/types/users.js';

/*
 * A plugin's request to have its folder trusted.
 *
 * Trust normally arrives on a person's connection, from a window that vouched
 * for the folder it has open. A back session has no window: the bot starts it,
 * the folder is the bot's own, and the rules it works by are in a file there.
 * So the plugin asks for it with `trusted: true` on its request, the host
 * answers only where the plugin's entry holds `session:trust`, and the answer
 * is kept with the session so a restart still has it.
 */

const DIR = mkdtempSync(join(tmpdir(), 'ahpd-session-trust-'));
const FOLDER = join(DIR, 'bot');
const INSIDE = join(FOLDER, 'inside');
const ELSEWHERE = join(DIR, 'elsewhere');
mkdirSync(INSIDE, { recursive: true });
mkdirSync(ELSEWHERE, { recursive: true });

/** What one start was told about each folder it was asked about. */
type Told = { folder: string; trusted: boolean | undefined }[];

/** The context every plugin in this repository is handed, without a daemon. */
const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});

/**
 * The echo backend, keeping what the last start was told.
 *
 * Every folder is asked, not only the session's: what a backend gates its
 * project files on is the answer for whatever folder it is about to read, and
 * the point of the grant is that it reaches one of them.
 */
function backend(): { agent: Agent; told: () => Told } {
  const base = echo({ path: DIR, pace: 0 });
  let told: Told = [];
  const agent: Agent = {
    ...base,
    create: (start: Start) => {
      told = [FOLDER, INSIDE, ELSEWHERE].map((folder) => ({ folder, trusted: start.trusted?.(folder) }));
      return base.create(start);
    },
  };
  return { agent, told: () => told };
}

/**
 * One host, one plugin whose entry grants `grants`, and the backend behind it.
 *
 * The plugin is folded in the way the loader folds it, because `startSession`
 * reaches a live host through the contribution rather than through a host
 * built by hand.
 */
function starting({
  grants, tokens, store,
}: {
  grants: Grant[];
  tokens: Record<string, Grant[]>;
  store?: SessionStore;
}) {
  const sessions = store ?? memorySessions();
  const { agent, told } = backend();
  const { host: plugin, contribution } = pluginHost('bots', context(), { grants });
  const base: HostOptions = {
    path: DIR,
    agents: [agent],
    sessions,
    users: directory(tokens),
  };
  const { options, problems } = foldHostOptions(base, [contribution]);
  return { plugin, host: createHost(options), sessions, told, problems };
}

/** A client signed in as `who`, which is what puts them in the host's book. */
async function open(host: ReturnType<typeof createHost>, who: string) {
  const client = host.accept(peer());
  await hello(client);
  await signIn(client, who);
  return client;
}

/** Yield between looks until a fast run is not timed by ticks. */
const settle = async (times = 20): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** What the last start was told about one folder. */
const about = (told: Told, folder: string): boolean | undefined =>
  told.find((one) => one.folder === folder)?.trusted;

it('trusts the folder a plugin with session:trust asked for, and none other', async () => {
  const { plugin, host, told } = starting({ grants: ['session:trust'], tokens: { soft: ['session:*'] } });
  await open(host, 'soft');

  await plugin.startSession({ owner: 'user:soft', workingDirectory: FOLDER, trusted: true });
  await settle();

  // The one folder named, and only it: a folder under it is a different folder
  // the plugin never asked about, and a sibling is not one either.
  expect(about(told(), FOLDER)).toBe(true);
  expect(about(told(), INSIDE)).toBe(false);
  expect(about(told(), ELSEWHERE)).toBe(false);
});

it('refuses a trusted start from a plugin without the grant, naming it', async () => {
  const { plugin, host, told } = starting({ grants: ['session:create'], tokens: { soft: ['session:*'] } });
  await open(host, 'soft');

  const refused = await plugin
    .startSession({ owner: 'user:soft', workingDirectory: FOLDER, trusted: true })
    .then(() => undefined, (error: { code?: number; message: string }) => error);

  // The grant is what an operator has to add, so it is the word in the answer.
  expect(refused?.code).toBe(-32009);
  expect(refused?.message).toContain('session:trust');
  // Nothing was started, and so nothing was told any folder was trusted.
  expect(told()).toEqual([]);
});

it('reads the trusted folder back after a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-session-trust-store-'));
  const first = fileSessions({ dir });
  const one = starting({ grants: ['session:trust'], tokens: { soft: ['session:*'] }, store: first });
  await open(one.host, 'soft');

  const uri = await one.plugin.startSession({ owner: 'user:soft', workingDirectory: FOLDER, trusted: true });
  // The row the start reads when it is told about a folder, before the process
  // that asked goes away.
  expect(first.trustedFolder?.(idOf(uri))).toBe(FOLDER);
  first.close?.();

  // The daemon again, reading the same folder: what it holds is what a start
  // after the restart answers `trusted` from.
  const second = fileSessions({ dir });
  expect(second.trustedFolder?.(idOf(uri))).toBe(FOLDER);
});
