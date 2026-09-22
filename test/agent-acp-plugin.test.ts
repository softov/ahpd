import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { describePlugin, loadPlugins } from '../packages/server/src/plugins.js';
import { echo } from '../examples/echo/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { PluginSpec } from '../packages/sdk/src/types/plugin.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * The package as a plugin: the manifest, the loader and a served turn.
 *
 * Every case goes through the real loader and the real host, and the server is
 * the scripted subprocess the other ACP tests use. What is under test is that
 * the manifest resolves the module, that `apply` contributes a provider from
 * its own options, that two specs with two commands are two backends, and that
 * a spec with nothing to spawn is reported rather than started.
 *
 * The source file is named rather than the package directory on purpose:
 * `pnpm test` does not build, and the loader applies a manifest's `ahpd.entry`
 * only when the package was resolved, so a file spec loads the file it names
 * rather than the `dist` build beside it.
 */

const REPO = join(import.meta.dirname, '..');
const SOURCE = './packages/agent-acp/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** A temporary directory removed after the one test that made it. */
let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

/** Let the subprocess's work finish, up to a point; the fixture never sleeps. */
const until = async (check: () => boolean, times = 3000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
};

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> })
  .filter((e) => e.channel === channel);

const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type));

/** One backend the daemon would have had anyway, so the plugin's is provably extra. */
const base = (): HostOptions => ({
  path: '/tmp/plugin-acp',
  agents: [{ ...echo({ path: '/tmp/plugin-acp', pace: 0 }), provider: 'base', displayName: 'Base backend' }],
});

const load = (specs: PluginSpec[], over: Partial<HostOptions> = {}) =>
  loadPlugins(specs, { base: { ...base(), ...over }, configDir: REPO, cwd: REPO, log: () => {} });

/** The spec for the scripted server, under whatever provider the case wants. */
const spec = (provider: string, over: Record<string, unknown> = {}): PluginSpec => ({
  name: SOURCE,
  options: { command: process.execPath, args: [FIXTURE], provider, ...over },
});

const initialize = async (client: ReturnType<ReturnType<typeof createHost>['accept']>) => await client.handle({
  method: 'initialize',
  params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
}) as { snapshots: { state: { agents: { provider: string }[] } }[] };

/** Open one session on a provider and watch both of its channels. */
async function open(client: ReturnType<ReturnType<typeof createHost>['accept']>, provider: string, name: string) {
  const uri = `ahp-session:/${name}`;
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
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text } } },
  });
};

it('loads the package from its source file and serves a turn through the server it names', async () => {
  const { options, loaded, problems } = await load([spec('acp')]);

  expect(problems).toEqual([]);
  expect(loaded).toHaveLength(1);
  expect(loaded[0]?.name).toBe('@ahpd/agent-acp');
  expect(loaded[0]?.title).toBe('ACP');

  const host = createHost(options);
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
  // spec's `command` named.
  expect(opened.snapshot.state.turns[0]?.responseParts[0]?.content).toBe('hello there');
});

it('lists a manifest, and its title, without importing the entry', async () => {
  /*
   * A manifest in its own directory rather than this package's: the loader
   * resolves a directory through `ahpd.entry`, and that names the `dist`
   * build, which is gitignored and so absent in a fresh checkout. The entry
   * here throws if it is ever imported, which is what a listing must not do.
   */
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-acp-listing-'));
  loose = dir;
  writeFileSync(join(dir, 'entry.js'), 'throw new Error("a listing imported the entry");\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@ahpd/agent-acp',
    private: true,
    type: 'module',
    exports: { '.': './entry.js' },
    ahpd: { entry: './entry.js', title: 'ACP' },
  }));

  const row = await describePlugin(dir, { configDir: REPO, cwd: REPO });

  expect(row.state).toBe('ready');
  expect(row.name).toBe('@ahpd/agent-acp');
  expect(row.title).toBe('ACP');
  expect(row.path).toBe(join(dir, 'entry.js'));
});

it('contributes two backends for two specs that name different commands', async () => {
  const { options, loaded, problems } = await load([
    spec('copilot', { displayName: 'Copilot' }),
    spec('codex', { displayName: 'Codex' }),
  ]);

  expect(problems).toEqual([]);
  expect(loaded).toHaveLength(2);
  // One package, two backends: the command is the difference, so nothing here
  // needs a second package per ACP server.
  expect(loaded.map((one) => one.name)).toEqual(['@ahpd/agent-acp', '@ahpd/agent-acp']);

  const host = createHost(options);
  const p = peer();
  const client = host.accept(p);
  const ready = await initialize(client);
  expect(ready.snapshots[0]?.state.agents.map((one) => one.provider)).toEqual(['base', 'copilot', 'codex']);

  const first = await open(client, 'copilot', 'one');
  begin(client, first.chatUri, 't1', 'hi');
  await until(() => types(p, first.chatUri).includes('chat/turnComplete'));

  const second = await open(client, 'codex', 'two');
  begin(client, second.chatUri, 't1', 'hi');
  await until(() => types(p, second.chatUri).includes('chat/turnComplete'));
  expect(types(p, second.chatUri).at(-1)).toBe('chat/turnComplete');
});

it('reports a spec with nothing to spawn, and loads nothing for it', async () => {
  const { loaded, problems } = await load([{ name: SOURCE, options: { provider: 'acp' } }]);

  // `command` is the one option this package cannot default, and a backend with
  // nothing to run is worth a line at load rather than a failure on the first
  // turn.
  expect(loaded).toEqual([]);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('command');
});

it('lists a spec with no command as unconfigured, naming what it needs', async () => {
  /*
   * The manifest declares `command` required, so a listing says what is wrong
   * before anything is imported or spawned. Without the declaration the same
   * spec lists as `ready` and the problem only appears when a turn is asked
   * for, which is the failure this is here to prevent.
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

  const missing = await describePlugin(dir, { configDir: REPO, cwd: REPO });
  expect(missing.state).toBe('unconfigured');
  expect(missing.problem).toContain('command');

  const given = await describePlugin(
    { name: dir, options: { command: 'copilot', args: ['--acp'] } },
    { configDir: REPO, cwd: REPO },
  );
  expect(given.state).toBe('ready');
});
