import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createHost, ROOT } from '../../sdk/src/host.js';
import { raise } from '../../sdk/src/plugins/plugins.js';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { memorySessions } from '../../sdk/src/sessions/sessions.js';
import { loadPlugins } from '../src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { ServedAdapter } from '../../sdk/src/types/connectors.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { Users } from '../../sdk/src/types/users.js';
import type { Vault } from '../../sdk/src/types/vault.js';

/*
 * A webhook call that talks to a bot, on a daemon with both plugins loaded.
 *
 * The daemon has a users directory, so each plugin's connection is answered
 * against the grants its entry names, and nothing else. A root client makes
 * the bot, which starts nothing. A `sync` call then makes the webhook plugin's
 * own session with the bot, a chat for the call's thread in it, and queues its
 * text there; the bot's wake hands it to its back session, whose answer is the
 * turn's, and the call is answered with it.
 */

const REPO = join(import.meta.dirname, '../../..');
const BOT = './packages/bot/src/index.ts';
const WEBHOOK = './packages/webhook/src/index.ts';

/** The grants the webhook plugin needs to make its session with a bot, open a thread's chat there and queue a message. */
const GRANTS = ['session:read', 'session:create', 'session:write', 'chat:create'];

/** The grants the bot plugin needs to start a back session in the bot's folder and send it a message. */
const BOT_GRANTS = ['session:read', 'session:write', 'session:trust'];

let loose: string[] = [];
afterEach(() => {
  for (const dir of loose) rmSync(dir, { recursive: true, force: true });
  loose = [];
});

const RECORD = { resource: 'ahpd://users', resource_name: 'ahpd users', authorization_servers: ['https://example.test'], required: false };

/** A directory that knows nobody: having one is what turns the gate on. */
const directory = (): Users => ({
  resource: RECORD,
  verify: async () => undefined,
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => '',
});

/** A vault in memory. */
const vault = (held: Record<string, string>): Vault => ({
  get: async (name) => held[name],
  set: async (name, value) => { held[name] = value; },
  delete: async (name) => delete held[name],
  list: async () => Object.keys(held).sort(),
});

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/** Yield between looks until `done` says so. */
const until = async (done: () => Promise<boolean>, what: string, tries = 600): Promise<void> => {
  for (let i = 0; i < tries; i++) {
    if (await done()) return;
    await new Promise((r) => { setTimeout(r, 5); });
  }
  throw new Error(`${what} never happened`);
};

/** A daemon with the bot and webhook plugins on it, up to the moment the socket is bound. */
async function started(grants: string[] = GRANTS) {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-webhook-'));
  loose.push(dir);
  const lines: string[] = [];
  const records = memoryRecords();
  const base: HostOptions = {
    path: dir,
    agents: [echo({ path: dir, pace: 0 })],
    sessions: memorySessions(),
    records,
    vault: vault({ 'host:connector/ci/secret': 'right-token' }),
    users: directory(),
  };
  const { options, problems, routes } = await loadPlugins([
    { name: BOT, options: { root: join(dir, 'bots') }, grants: BOT_GRANTS },
    { name: WEBHOOK, grants },
  ], { base, configDir: join(dir, 'config'), cwd: REPO, log: (line) => { lines.push(line); } });
  const host = createHost(options);
  for (const one of options.pluginConnects ?? []) one.host = host;
  await raise(
    options.events,
    { type: 'listening', runtime: 'node', host: '127.0.0.1', port: 0, guarded: false },
    (line) => { lines.push(line); },
  );
  return { host, lines, problems, routes, records, adapters: options.adapters ?? {} };
}

/**
 * Open the `ci` endpoint the way the host opens a connector.
 *
 * The connector channel is not served here, so the adapter is handed the config a
 * put would have resolved: the secret is its value, not a vault name.
 */
const openCi = (adapters: Record<string, ServedAdapter>, config: Record<string, unknown>): void => {
  const adapter = adapters['webhook'];
  if (adapter === undefined) throw new Error('the webhook plugin registered no adapter');
  adapter.open({ id: 'ci', adapter: 'webhook', owner: 'host', config: { bot: 'bot://motion', secret: 'right-token', ...config } });
};

it('answers a sync call with the turn the bot answered it in, in the plugin\'s own chat', async () => {
  const { host, problems, routes, records, adapters } = await started();
  expect(problems).toEqual([]);

  // The host's own key makes the bot, which starts nothing: the plugin makes
  // its own session with the bot when a call first needs one.
  const root = host.accept(peer(), undefined, true);
  await root.handle({ method: 'initialize', params: { clientId: 'root', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  await root.handle({ method: 'resourceWrite', params: { uri: 'bot://motion', data: JSON.stringify({ name: 'Motion', provider: 'echo' }) } });

  openCi(adapters, { reply: 'sync', syncTimeoutSeconds: 10 });

  const route = routes['webhook'];
  expect(route).toBeDefined();
  const call = (text: string) => route!(new Request('http://127.0.0.1:1/plugins/webhook/ci', {
    method: 'POST',
    headers: { authorization: 'Bearer right-token', 'content-type': 'application/json' },
    body: JSON.stringify({ thread: 'pr-12', text }),
  }));

  /** What one chat holds now, read the way a client reads a chat. */
  const turns = async (chat: string): Promise<{ message: { text: string } }[]> => {
    const opened = await root.handle({ method: 'subscribe', params: { channel: chat } }) as {
      snapshot?: { state?: { turns?: { message: { text: string } }[] } };
    };
    return opened.snapshot?.state?.turns ?? [];
  };

  const first = await call('hello there');
  const said = await first.json() as Bag;
  expect({ status: first.status, said }).toMatchObject({ status: 200, said: { thread: 'pr-12', status: 'complete' } });
  // The turn's answer is the back session's last words, which the echo agent says.
  expect(String(said['text'])).not.toBe('');

  const second = await call('once more');
  expect(second.status).toBe(200);

  // One thread and one chat: both calls are turns in the thread's chat, in the
  // session the plugin made with the bot, which is a chat with that bot.
  const threads = await (await records.collection('webhook-threads')).list();
  expect(threads).toHaveLength(1);
  expect(threads[0]).toMatchObject({ endpoint: 'ci', thread: 'pr-12' });
  const session = String(threads[0]?.['session']);
  const opened = await root.handle({ method: 'subscribe', params: { channel: session } }) as { snapshot: { state: Bag } };
  expect(opened.snapshot.state['_meta']).toMatchObject({ 'ahpd.bot': { id: 'motion' } });
  const chat = String(threads[0]?.['chat']);
  await until(async () => (await turns(chat)).length === 2, 'both turns to reach the plugin chat');
  expect((await turns(chat)).map((one) => one.message.text)).toEqual(['hello there', 'once more']);
});

it('answers 409 when the plugin may not make a session', async () => {
  const { host, routes, adapters } = await started([]);
  const root = host.accept(peer(), undefined, true);
  await root.handle({ method: 'initialize', params: { clientId: 'root', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  await root.handle({ method: 'resourceWrite', params: { uri: 'bot://motion', data: JSON.stringify({ name: 'Motion', provider: 'echo' }) } });
  openCi(adapters, { reply: 'none' });

  const answer = await routes['webhook']!(new Request('http://127.0.0.1:1/plugins/webhook/ci?thread=pr-12', {
    method: 'POST',
    headers: { authorization: 'Bearer right-token' },
    body: 'hello',
  }));
  expect(answer.status).toBe(409);
});

it('answers 409 and names the grant when the host makes the plugin no session', async () => {
  const { host, lines, routes, records, adapters } = await started(['session:read']);
  const root = host.accept(peer(), undefined, true);
  await root.handle({ method: 'initialize', params: { clientId: 'root', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  await root.handle({ method: 'resourceWrite', params: { uri: 'bot://motion', data: JSON.stringify({ name: 'Motion', provider: 'echo' }) } });
  openCi(adapters, { reply: 'none' });

  const answer = await routes['webhook']!(new Request('http://127.0.0.1:1/plugins/webhook/ci?thread=pr-12', {
    method: 'POST',
    headers: { authorization: 'Bearer right-token' },
    body: 'hello',
  }));
  expect(answer.status).toBe(409);
  expect(lines.some((line) => line.startsWith('webhook: ') && line.includes('session:create'))).toBe(true);
  expect(await (await records.collection('webhook-threads')).list()).toEqual([]);
});
