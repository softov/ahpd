import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { createHost } from '../../sdk/src/host.js';
import { describePlugin, loadPlugins, pluginIdsOf } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { anyone, signIn } from './people.js';
import type { Engine, AgentView, Bag } from '@ahpd/sdk';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';
import type { Peer } from '../../sdk/src/types/rpc.js';

/*
 * The package as a plugin: the manifest, the loader and a served turn.
 *
 * Every case goes through the real loader and the real host, and the server is
 * the scripted subprocess the other ACP tests use. What is under test is that
 * the manifest resolves the module, that `apply` contributes the `acp` engine and
 * no agent of its own, and that each record opened from that engine is a backend
 * the host serves.
 *
 * The source file is named rather than the package directory on purpose:
 * `pnpm test` does not build, and the loader applies a manifest's `ahpd.entry`
 * only when the package was resolved, so a file spec loads the file it names
 * rather than the `dist` build beside it.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-acp/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** A temporary directory removed after the one test that made it. */
let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
  vi.unstubAllEnvs();
});

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: async () => {},
  };
};

/**
 * Let the subprocess's work finish, up to a point; the fixture never sleeps.
 *
 * By the clock rather than by the count: a 1 ms timer is about 15 ms on
 * Windows, where three thousand of them outlast the test's own timeout.
 */
const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`still waiting after ${ms} ms`);
};

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> })
  .filter((e) => e.channel === channel);

/**
 * The types of the actions on one channel, in order.
 *
 * Without `chat/isReadChanged`, which the host sends after a turn's ending and
 * which says what a person has seen rather than what the turn did.
 */
const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type)).filter((type) => type !== 'chat/isReadChanged');

/** One backend the daemon would have had anyway, so the plugin's is provably extra. */
const base = (): HostOptions => ({
  path: '/tmp/plugin-acp',
  agents: [{ ...echo({ path: '/tmp/plugin-acp', pace: 0 }), provider: 'base', displayName: 'Base backend' }],
  /*
   * Somebody for the window in these cases to be. A backend is told which
   * folders are trusted only by a connection that owns the session, and a
   * connection owns nothing on a host with no people directory.
   */
  users: anyone(),
});

const load = (specs: PluginSpec[], over: Partial<HostOptions> = {}) =>
  loadPlugins(specs, { base: { ...base(), ...over }, configDir: REPO, cwd: REPO, log: () => {} });

/** The spec for the scripted server: no option, since each agent is a record. */
const SPEC: PluginSpec = { name: SOURCE, options: {} };

/** The `acp` engine a load registered, which is where a record's backend comes from. */
const engineOf = (options: { engines?: Record<string, Engine> }): Engine => {
  const engine = options.engines?.['acp'];
  if (engine === undefined) throw new Error('no acp engine was registered');
  return engine;
};

/** One record, as an engine is handed it: every field read at each call. */
const viewOf = (id: string, held: () => Bag, name = id): AgentView => ({
  id,
  engine: 'acp',
  owner: 'host',
  name,
  description: undefined,
  icon: undefined,
  model: undefined,
  get config() { return held(); },
});

const initialize = async (client: ReturnType<ReturnType<typeof createHost>['accept']>) => {
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  }) as { snapshots: { state: { agents: { provider: string }[] } }[] };
  await signIn(client);
  return ready;
};

/** Open one session on a provider and watch both of its channels. */
async function open(client: ReturnType<ReturnType<typeof createHost>['accept']>, provider: string, name: string) {
  const uri = `ahp-session:/${name}`;
  /*
   * The window's own answer about the folders it trusts. A session of a folder
   * nobody vouched for is refused rather than started - and this case
   * names no folder at all, so it is a window with workspace trust turned off:
   * `enabled: false` is VS Code's "there is no untrusted folder here".
   */
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: 'ahp-root://',
      action: { type: 'root/configChanged', config: { workspaceTrust: { enabled: false, trustedUris: [] } } },
    },
  });
  await client.handle({ method: 'createSession', params: { channel: uri, provider } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { uri, chatUri };
}

const begin = (
  client: ReturnType<ReturnType<typeof createHost>['accept']>,
  chatUri: string,
  turnId: string,
  text: string,
): void => {
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
  });
};

it('loads the package from its source file and serves a turn through the server a record names', async () => {
  const { options, loaded, problems } = await load([SPEC]);

  expect(problems).toEqual([]);
  expect(loaded).toHaveLength(1);
  expect(loaded[0]?.name).toBe('agent-acp');
  expect(loaded[0]?.title).toBe('Agent ACP');

  const agent = engineOf(options).open(viewOf('acp', () => ({ command: process.execPath, args: [FIXTURE] }), 'ACP'));
  const host = createHost({ ...options, agents: [...(options.agents ?? []), agent] });
  const said = peer();
  const client = host.accept(said);
  const ready = await initialize(client);
  expect(ready.snapshots[0]?.state.agents.map((one) => one.provider)).toEqual(['base', 'acp']);

  const { chatUri } = await open(client, 'acp', 'plugin');
  begin(client, chatUri, 't1', 'hello there');
  await until(() => types(said, chatUri).includes('chat/turnComplete'));
  expect(types(said, chatUri).at(-1)).toBe('chat/turnComplete');

  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: { content: string }[] }[] } };
  };
  expect(opened.snapshot.state.turns).toHaveLength(1);
  // The fixture streams `hello` and ` there`, so the turn proves the module the
  // loader resolved is this package and the server it spawned is the one the
  // record's `command` named.
  expect(opened.snapshot.state.turns[0]?.responseParts[0]?.content).toBe('hello there');
});

it('lists a manifest, its title, and the id its entry exports', async () => {
  /*
   * A manifest in its own directory rather than this package's: the loader
   * resolves a directory through `ahpd.entry`, and that names the `dist`
   * build, which is gitignored and so absent in a fresh checkout. A listing
   * imports the entry to read its id, and applies nothing.
   */
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-acp-listing-'));
  loose = dir;
  writeFileSync(join(dir, 'entry.js'), 'export const name = "agent-acp";\nexport const apply = () => { throw new Error("a listing applied the plugin"); };\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@ahpd/agent-acp',
    private: true,
    type: 'module',
    exports: { '.': './entry.js' },
    ahpd: { entry: './entry.js', title: 'Agent ACP' },
  }));

  // The list verb names every spec first, as this does.
  await pluginIdsOf([dir], { configDir: REPO, cwd: REPO });
  const row = await describePlugin(dir, { configDir: REPO, cwd: REPO });

  expect(row.state).toBe('ready');
  // The key is the id the entry exports; the package's own name is `module`.
  expect(row.name).toBe('agent-acp');
  expect(row.module).toBe('@ahpd/agent-acp');
  expect(row.title).toBe('Agent ACP');
  expect(row.path).toBe(join(dir, 'entry.js'));
});

it('contributes one backend per record, from one load', async () => {
  // The codex row signs in with a key when the daemon has one, and the scripted
  // server offers no sign-in: a key on the machine running the tests is not part
  // of the case.
  vi.stubEnv('CODEX_API_KEY', undefined);
  vi.stubEnv('OPENAI_API_KEY', undefined);
  const { options, loaded, problems } = await load([SPEC]);

  // One entry serves the engine, and each record opened from it is a backend of
  // its own: Copilot and Codex are two records rather than two specs of one
  // name.
  expect(problems).toEqual([]);
  expect(loaded).toHaveLength(1);
  expect(loaded.map((one) => one.name)).toEqual(['agent-acp']);

  const engine = engineOf(options);
  const copilot = engine.open(viewOf('copilot', () => ({ command: process.execPath, args: [FIXTURE] }), 'Copilot'));
  const codex = engine.open(viewOf('codex', () => ({ command: process.execPath, args: [FIXTURE] }), 'Codex'));
  const host = createHost({ ...options, agents: [...(options.agents ?? []), copilot, codex] });
  const p = peer();
  const client = host.accept(p);
  const ready = await initialize(client);
  expect(ready.snapshots[0]?.state.agents.map((one) => one.provider)).toEqual(['base', 'copilot', 'codex']);

  const first = await open(client, 'copilot', 'one');
  begin(client, first.chatUri, 't1', 'hi');
  await until(() => types(p, first.chatUri).includes('chat/turnComplete'));
  expect(types(p, first.chatUri).at(-1)).toBe('chat/turnComplete');

  const second = await open(client, 'codex', 'two');
  begin(client, second.chatUri, 't1', 'hi again');
  await until(() => types(p, second.chatUri).includes('chat/turnComplete'));
  expect(types(p, second.chatUri).at(-1)).toBe('chat/turnComplete');
});

it('refuses a record with nothing to spawn, and serves the records that open', async () => {
  const { options, loaded, problems } = await load([SPEC]);

  expect(loaded.map((one) => one.name)).toEqual(['agent-acp']);
  expect(problems).toEqual([]);

  // `command` is the one thing this package cannot default, and a record with
  // nothing to run is refused where it opens rather than failing on a turn.
  const engine = engineOf(options);
  expect(() => engine.open(viewOf('nope', () => ({})))).toThrow(
    'nope names no command, and an acp record names the program its sessions run',
  );

  const agent = engine.open(viewOf('acp', () => ({ command: process.execPath, args: [FIXTURE] })));
  const host = createHost({ ...options, agents: [...(options.agents ?? []), agent] });
  const client = host.accept(peer());
  const ready = await initialize(client);
  expect(ready.snapshots[0]?.state.agents.map((one) => one.provider)).toEqual(['base', 'acp']);
});

it('lists a spec with no options, or one naming hostTools, as ready', async () => {
  /*
   * The manifest declares no required option now: each agent is a record of the
   * engine, so a spec with nothing to say is a load with every shipped row
   * available. A listing says `ready` without importing the entry, which is what
   * the throwing entry here proves.
   *
   * The real `ahpd` block is copied into a directory whose entry exists, rather
   * than listing this package: `describePlugin` resolves `ahpd.entry`, which is
   * the `dist` build, and `pnpm test` runs before `pnpm build` - a listing of
   * the package directory itself is `missing` in a fresh checkout.
   */
  const real = JSON.parse(readFileSync(join(REPO, 'packages/agent-acp/package.json'), 'utf8')) as {
    ahpd: Record<string, unknown>;
  };
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-acp-options-'));
  loose = dir;
  writeFileSync(join(dir, 'entry.js'), 'throw new Error("a listing imported the entry");\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@ahpd/agent-acp',
    private: true,
    type: 'module',
    exports: { '.': './entry.js' },
    ahpd: { ...real.ahpd, entry: './entry.js' },
  }));

  const bare = await describePlugin(dir, { configDir: REPO, cwd: REPO });
  expect(bare.state).toBe('ready');

  const given = await describePlugin(
    { name: dir, options: { hostTools: true } },
    { configDir: REPO, cwd: REPO },
  );
  expect(given.state).toBe('ready');
});
