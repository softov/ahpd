import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { fileResources } from '../packages/sdk/src/resources.js';
import { describePlugin, loadPlugins } from '../packages/server/src/plugins.js';
import { echo } from '../examples/echo/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * A scheme, through the whole path: a plugin on disk to a URI a client reads.
 *
 * The fixture is a real plugin and the loader is the daemon's own, because
 * what is under test is that a plugin can serve a host-owned scheme at all,
 * beside the filesystem store rather than in place of it.
 */

const REPO = join(import.meta.dirname, '..');
const SPEC = './test/fixtures/plugin-uri-resources';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-uri-plugin-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/** One backend the daemon would have had anyway, so the provider is provably extra. */
const base = (): HostOptions => ({
  path: root,
  agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base backend' }],
  resources: fileResources(),
});

const load = () => loadPlugins([SPEC], { base: base(), configDir: REPO, cwd: REPO, log: () => {} });

async function open(options: HostOptions) {
  const client = createHost(options).accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  return client;
}

it('lists the fixture from its manifest as ready, without importing it', async () => {
  const row = await describePlugin(SPEC, { configDir: REPO, cwd: REPO });
  expect(row.state).toBe('ready');
  expect(row.name).toBe('plugin-uri-resources');
  expect(row.title).toBe('Machine status plugin');
});

it('serves a computer: read through the real loader while file: still lists', async () => {
  writeFileSync(join(root, 'on-disk.txt'), 'a file');
  const { options, loaded, problems } = await load();
  expect(problems).toEqual([]);
  expect(loaded.map((one) => one.name)).toEqual(['uri-resources-plugin']);
  expect(Object.keys(options.resourceProviders ?? {})).toEqual(['computer']);

  const client = await open(options);
  const status = await client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'computer://local/status' },
  }) as { data: string; contentType?: string };
  expect(status.contentType).toBe('application/json');
  expect(JSON.parse(status.data)).toMatchObject({ runtime: 'docker' });

  // The plugin took a scheme, not the port: the daemon's filesystem store is
  // still the one answering `file:`.
  const listing = await client.handle({
    method: 'resourceList', params: { channel: 'ahp-root://', uri: `file://${root}` },
  }) as { entries: { name: string }[] };
  expect(listing.entries.map((one) => one.name)).toEqual(['on-disk.txt']);
});

it('refuses a list and a write on the scheme, which the provider does not implement', async () => {
  const { options } = await load();
  const client = await open(options);
  await expect(client.handle({
    method: 'resourceList', params: { channel: 'ahp-root://', uri: 'computer://local' },
  })).rejects.toMatchObject({ code: -32601 });
  await expect(client.handle({
    method: 'resourceWrite',
    params: { channel: 'ahp-root://', uri: 'computer://local/status', data: 'x', encoding: 'utf-8' },
  })).rejects.toMatchObject({ code: -32601 });
});
