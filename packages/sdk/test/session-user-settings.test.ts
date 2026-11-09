import { loggerOf } from '../src/log.js';
import { mkdtempSync } from 'node:fs';
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
 * A plugin's request that its session load no settings of the person who runs
 * the daemon.
 *
 * A plugin starts work as somebody else. A bot's back session is owned by the
 * person who chatted with it, but it is the bot working for them rather than
 * them at a keyboard, and what they put in `~/.claude` must not shape it. So a
 * request can say `userSettings: false`, the host puts it on `Start` for the
 * backend to read, and it is kept with the session so a restart keeps it.
 */

const DIR = mkdtempSync(join(tmpdir(), 'ahpd-session-user-settings-'));

/** The context every plugin in this repository is handed, without a daemon. */
const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});

/**
 * The echo backend, keeping what the last start was told about user settings.
 *
 * `undefined` is the default: a start that said nothing loads the person's
 * settings, as every session did before this flag existed.
 */
function backend(): { agent: Agent; told: () => boolean | undefined } {
  const base = echo({ path: DIR, pace: 0 });
  let told: boolean | undefined;
  const agent: Agent = {
    ...base,
    create: (start: Start) => {
      told = start.userSettings;
      return base.create(start);
    },
  };
  return { agent, told: () => told };
}

/**
 * One host, one plugin whose entry grants `grants`, and the backend behind it.
 *
 * The plugin is folded the way the loader folds it, because `startSession`
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

it('puts the flag a request asked for on Start', async () => {
  const { plugin, host, told } = starting({ grants: [], tokens: { soft: ['session:*'] } });
  await open(host, 'soft');

  await plugin.startSession({ owner: 'user:soft', workingDirectory: DIR, userSettings: false });
  await settle();

  // The backend reads it to decide what to load, so the flag is no use unless
  // it arrives with the start.
  expect(told()).toBe(false);
});

it('leaves Start saying nothing for a session that asked for nothing', async () => {
  const { plugin, host, told } = starting({ grants: [], tokens: { soft: ['session:*'] } });
  await open(host, 'soft');

  await plugin.startSession({ owner: 'user:soft', workingDirectory: DIR });
  await settle();

  // Absent is the default - the person's own settings load - and a start that
  // never said so is a session nothing was asked to change.
  expect(told()).toBeUndefined();
});

it('reads the flag back after a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-session-user-settings-store-'));
  const first = fileSessions({ dir });
  const one = starting({ grants: [], tokens: { soft: ['session:*'] }, store: first });
  await open(one.host, 'soft');

  const uri = await one.plugin.startSession({ owner: 'user:soft', workingDirectory: DIR, userSettings: false });
  // The row the next start reads, before the process that asked goes away.
  expect(first.userSettings?.(idOf(uri))).toBe(false);
  first.close?.();

  // The daemon again, reading the same folder: what it holds is what a start
  // after the restart puts on `Start`.
  const second = fileSessions({ dir });
  expect(second.userSettings?.(idOf(uri))).toBe(false);
});
