import { loggerOf } from '../src/log.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import { call, directory, hello, peer, signIn } from './users-gate-helpers.js';
import type { Bag } from './users-gate-helpers.js';
import type { LoaderContext, PluginPeer } from '../src/types/plugin.js';

/*
 * A plugin's own connection on the sessions of its own agents.
 *
 * On a host with users, a plugin's connection is `plugin:<name>` and may do
 * what its entry grants. A session of an agent the plugin registered is its
 * own, as a bot's talk is the bot plugin's, so its `session:` and `chat:`
 * grants are excused there. Nothing else is: a session of another agent, and
 * a grant about something other than a session or a chat.
 */

const DIR = mkdtempSync(join(tmpdir(), 'ahpd-plugin-own-sessions-'));

/** The context every plugin in this repository is handed, without a daemon. */
const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});

/** A session of the plugin's own agent, and one of the host's other agent. */
const MINE = 'mine:/one';
const OTHER = 'other:/two';

/**
 * A host with users, one plugin with no grants that registers `mine`, and the
 * host's own `other`. soft, a person, makes one session of each.
 */
async function hosting() {
  const sessions = memorySessions();
  const { host: plugin, contribution } = pluginHost('bots', context(), { grants: [] });
  plugin.registerAgent({ ...echo({ path: DIR, pace: 0 }), provider: 'mine', displayName: 'Mine' });
  const { options } = foldHostOptions({
    path: DIR,
    agents: [{ ...echo({ path: DIR, pace: 0 }), provider: 'other', displayName: 'Other' }],
    sessions,
    users: directory({ soft: ['session:*', 'chat:*'] }),
  }, [contribution]);
  const host = createHost(options);
  for (const one of options.pluginConnects ?? []) one.host = host;
  const person = host.accept(peer());
  await hello(person);
  await signIn(person, 'soft');
  await call(person, 'createSession', { channel: MINE, provider: 'mine' });
  await call(person, 'createSession', { channel: OTHER, provider: 'other' });
  return { host, plugin };
}

/** The plugin's connection, opened, with what the host said on it kept. */
async function connected(plugin: Awaited<ReturnType<typeof hosting>>['plugin']): Promise<{ conn: PluginPeer; heard: Bag[] }> {
  const conn = plugin.connect();
  const heard: Bag[] = [];
  conn.onMessage((message) => { heard.push(message as Bag); });
  await conn.request('initialize', { clientId: 'bots', protocolVersions: ['0.9.0'] });
  return { conn, heard };
}

/** What a request answered, or the message of its refusal. */
const outcome = (asked: Promise<unknown>): Promise<unknown> =>
  asked.then((result) => ({ result }), (error: { message: string }) => ({ refused: error.message }));

/** The default chat of a session, read off its state. */
const chatOf = async (conn: PluginPeer, session: string): Promise<string> =>
  String(((await conn.request('subscribe', { channel: session })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat);

/** The refusals the host sent on the connection, as `channel: reason`. */
const refusals = (heard: Bag[]): string[] => heard
  .filter((one) => one.method === 'action' && typeof one.params?.rejectionReason === 'string')
  .map((one) => `${String(one.params.channel)}: ${String(one.params.rejectionReason)}`);

it('lets a plugin with no grants subscribe to a session of its own agent and its chat', async () => {
  const { plugin } = await hosting();
  const { conn } = await connected(plugin);

  const chat = await chatOf(conn, MINE);

  expect(await outcome(conn.request('subscribe', { channel: chat }))).toMatchObject({ result: { snapshot: {} } });
});

it('lets a plugin with no grants send a turn on a chat of its own agent', async () => {
  const { plugin } = await hosting();
  const { conn, heard } = await connected(plugin);
  const chat = await chatOf(conn, MINE);
  await conn.request('subscribe', { channel: chat });

  conn.notify('dispatchAction', {
    channel: chat,
    clientSeq: 1,
    action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(refusals(heard)).toEqual([]);
  expect(heard.some((one) => one.method === 'action' && one.params?.action?.type === 'chat/turnStarted')).toBe(true);
});

it('refuses a plugin with no grants on a session of another agent', async () => {
  const { plugin } = await hosting();
  const { conn } = await connected(plugin);

  const refused = await outcome(conn.request('subscribe', { channel: OTHER }));

  expect(refused).toMatchObject({ refused: expect.stringContaining('plugin:bots may not') });
});

it('excuses no grant that is not a session\'s or a chat\'s on its own agent\'s session', async () => {
  const { plugin } = await hosting();
  const { conn } = await connected(plugin);

  // A terminal is something else's, so its grant is asked as it is of anybody.
  const refused = await outcome(conn.request('createTerminal', { channel: 'ahp-terminal:/t', session: MINE }));

  expect(refused).toMatchObject({ refused: expect.stringContaining('plugin:bots may not terminal:') });
});
