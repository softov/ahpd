import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { fileResources } from '../packages/sdk/src/resources.js';
import { describePlugin, loadPlugins } from '../packages/server/src/plugins.js';
import { echo } from '../examples/echo/agent.js';
import type { HostOptions, HostTool, ToolCall } from '../packages/sdk/src/types/host.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * The package as a plugin: the loader, the scheme and the tools.
 *
 * The `docker` the runtime spawns is the scripted fixture, so what is under
 * test is that the provider and the tools reach a command at all and that the
 * host serves what came back. No daemon is asked for anything.
 */

const REPO = join(import.meta.dirname, '..');
const SOURCE = './packages/computer/src/index.ts';
const FIXTURE = fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url));

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(() => {
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
});

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/** One backend the daemon would have had anyway, so the provider is provably extra. */
const base = (): HostOptions => ({
  path: '/tmp/computer',
  agents: [{ ...echo({ path: '/tmp/computer', pace: 0 }), provider: 'base', displayName: 'Base backend' }],
  resources: fileResources(),
});

const load = (options: Record<string, unknown>) => loadPlugins(
  [{ name: SOURCE, options }],
  { base: base(), configDir: REPO, cwd: REPO, log: () => {} },
);

const at = {} as ToolCall;
const tool = (tools: HostTool[], name: string) => tools.find((one) => one.definition.name === name) as HostTool;

it('serves computer: through the host and offers the three tools', async () => {
  loose = mkdtempSync(join(tmpdir(), 'ahpd-computer-'));
  const state = join(loose, 'docker.json');
  const { options, loaded, problems } = await load({
    command: process.execPath,
    args: [FIXTURE],
    env: { DOCKER_FAKE_STATE: state },
  });

  expect(problems).toEqual([]);
  expect(loaded.map((one) => one.name)).toEqual(['ahpd-computer']);
  expect(Object.keys(options.resourceProviders ?? {})).toEqual(['computer']);
  const tools = options.tools ?? [];
  expect(tools.map((one) => one.definition.name)).toEqual([
    'request_disposable_computer', 'release_computer', 'computer_exec',
  ]);

  // A machine is made by the tool, which is the only thing that makes one.
  expect(String(await tool(tools, 'request_disposable_computer').run({ name: 'box' }, at))).toContain('computer://box');

  const host = createHost(options);
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });

  const listed = await client.handle({
    method: 'resourceList', params: { channel: 'ahp-root://', uri: 'computer://' },
  }) as { entries: { name: string }[] };
  expect(listed.entries.map((one) => one.name)).toEqual(['box']);

  const status = await client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'computer://box/status' },
  }) as { data: string; contentType?: string };
  expect(status.contentType).toBe('application/json');
  expect(JSON.parse(status.data)).toMatchObject({ Name: '/box', Image: 'debian:bookworm-slim' });

  // The commands the provider ran are in the fixture's own record, which is the
  // proof it spawned something rather than answering from a stub.
  const record = JSON.parse(readFileSync(state, 'utf8')) as { calls: string[][] };
  expect(record.calls.some((one) => one[0] === 'run')).toBe(true);
  expect(record.calls.some((one) => one[0] === 'ps')).toBe(true);
  expect(record.calls.some((one) => one[0] === 'inspect')).toBe(true);

  expect(String(await tool(tools, 'release_computer').run({ id: 'box' }, at))).toContain('gone');
  const after = await client.handle({
    method: 'resourceList', params: { channel: 'ahp-root://', uri: 'computer://' },
  }) as { entries: unknown[] };
  expect(after.entries).toEqual([]);
});

it('reports a runtime it does not have at load, rather than failing later', async () => {
  const { loaded, problems } = await load({ runtime: 'kvm' });
  expect(loaded).toEqual([]);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('kvm');
});

it('lists its manifest and title without importing the entry', async () => {
  /*
   * A manifest in its own directory rather than this package's: `describePlugin`
   * resolves `ahpd.entry`, which names the `dist` build, and `pnpm test` runs
   * before `pnpm build`. The entry here throws if it is ever imported, which is
   * what a listing must not do.
   */
  const real = JSON.parse(readFileSync(join(REPO, 'packages/computer/package.json'), 'utf8')) as {
    ahpd: Record<string, unknown>;
  };
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-computer-listing-'));
  loose = dir;
  writeFileSync(join(dir, 'entry.js'), 'throw new Error("a listing imported the entry");\n');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: '@ahpd/computer',
    private: true,
    type: 'module',
    exports: { '.': './entry.js' },
    ahpd: { ...real.ahpd, entry: './entry.js' },
  }));

  const row = await describePlugin(dir, { configDir: REPO, cwd: REPO });
  expect(row.state).toBe('ready');
  expect(row.name).toBe('@ahpd/computer');
  expect(row.title).toBe('Computer');
});
