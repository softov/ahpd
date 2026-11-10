import { loggerOf } from '../src/log.js';
import { beforeEach, expect, it, vi } from 'vitest';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { sdkVersion } from '../src/version.js';
import {
  claude, createHost, machine, resetSdk, sdk,
} from './support/host.js';
import {
  directory, hello, peer, signIn,
} from './users-gate-helpers.js';
import type { HostOptions } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { Grant } from '../src/types/users.js';
import { WORK } from './support/work.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * Whose a session is, and whether there is one.
 *
 * The store keeps what was recorded about a session - its owner, its chats -
 * and a row outlives the session itself: a process that ran no turn leaves
 * nothing on a backend's disk, so after a restart the row is all there is and
 * a subscribe to that URI answers `No agent for session`.
 *
 * `sessionOwner` is what a plugin reusing a session asks, so it answers an
 * owner only where the host can open the session: running now, or in its
 * catalogue. Nothing means a session to start again, and that is the whole of
 * what a bot's wake and a bot's read need to hear.
 */

const DIR = WORK;

/** The context every plugin in this repository is handed, without a daemon. */
const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});

/**
 * A plugin folded into a host the way the loader folds one.
 *
 * The host is real rather than stubbed: `sessionOwner` reads the live
 * catalogue through the contribution, so a version of this that skipped the
 * fold would be asking a store and nothing else.
 */
function owned(tokens: Record<string, Grant[]> = { soft: ['session:*'] }) {
  const sessions = memorySessions();
  // The store the host keeps is the one the plugin reads its rows from, as the
  // daemon wires it: one store, reached from both sides.
  const { host: plugin, contribution } = pluginHost('bots', context(), { sessions: () => sessions });
  const base: HostOptions = {
    path: DIR,
    agents: [claude({ paths: [DIR] })],
    ...machine(),
    sessions,
    users: directory(tokens),
  };
  const { options } = foldHostOptions(base, [contribution]);
  const host = createHost(options);
  return { plugin, host, sessions };
}

it('answers nothing for a session only the store remembers', async () => {
  const { plugin, sessions } = owned();
  /*
   * The row a restart leaves behind: an owner, and nothing the host can open.
   * The backend has no transcript for this id and no process is running it, so
   * the answer is the one a plugin starts a new session on rather than the
   * owner that made it reuse a session `No agent for session` answers.
   */
  sessions.setOwner('gone', 'user:soft');
  sessions.setProvider('gone', 'claude');

  expect(await plugin.sessionOwner('claude:/gone')).toBeUndefined();
});

it('answers the owner of a session this host is running', async () => {
  const { plugin, host } = owned();
  const client = host.accept(peer());
  await hello(client, 'soft');
  await signIn(client, 'soft');

  // A session a plugin started, with nobody speaking in it: the process is
  // running, which is the first of the two answers that keeps the owner.
  const uri = await plugin.startSession({ owner: 'user:soft' });

  expect(await plugin.sessionOwner(uri)).toBe('user:soft');
});

it('answers the owner of a session on a backend\'s disk', async () => {
  const { plugin, sessions } = owned();
  /*
   * A transcript the backend wrote before this process started: nothing here
   * is running it, and a read of it is what a subscribe would serve. Its owner
   * is kept in the store, which is the row a restart reads back.
   */
  sdk.sessions.push({
    sessionId: 'kept', lastModified: Date.now(), cwd: DIR,
    createdAt: Date.now(), summary: 'Kept',
  });
  sessions.setOwner('kept', 'user:soft');

  // By the URI the row is listed under: a row this host keeps a record for
  // keeps its provider's scheme, and that is the one name it is answered by.
  expect(await plugin.sessionOwner('ahp-session:/kept')).toBeUndefined();
  expect(await plugin.sessionOwner('claude:/kept')).toBe('user:soft');
});

it('answers nothing for a session with no row at all', async () => {
  const { plugin } = owned();

  // No store row and nothing on disk: nobody owns a session this host has not.
  expect(await plugin.sessionOwner('claude:/nobody')).toBeUndefined();
});
