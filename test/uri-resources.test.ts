import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { fileResources } from '../packages/sdk/src/resources.js';
import { echo } from '../examples/echo/agent.js';
import type { ResourceProvider } from '../packages/sdk/src/types/resources.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * A host-owned URI scheme, beside files.
 *
 * A resource command is routed by the scheme in the URI: `file:` to the store
 * the host was given, a registered scheme to its provider, and a URI a client
 * published to that client before any of this is consulted.
 *
 * What a provider leaves out is `-32601`, the same answer a read-only store's
 * missing write half gets, and a scheme nobody serves is explained as somebody
 * else's rather than read as a path.
 */

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-uri-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/** A read-only `computer:` provider: no list, no watch and no writes. */
const computer = (): ResourceProvider => ({
  read: async (uri) => ({ data: `status of ${uri}`, encoding: 'utf-8' }),
  resolve: async (uri) => ({
    uri,
    type: 'file',
    size: 3,
    mtime: new Date(0).toISOString(),
    ctime: new Date(0).toISOString(),
  }),
});

const host = (providers: Record<string, ResourceProvider> = { computer: computer() }) => createHost({
  path: root,
  agents: [echo({ path: root, pace: 0 })],
  resources: fileResources(),
  resourceProviders: providers,
});

async function open(one: ReturnType<typeof host>) {
  const client = one.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  return client;
}

it('reads a file while a provider is registered, and reaches the provider by scheme', async () => {
  writeFileSync(join(root, 'a.txt'), 'on disk');
  const client = await open(host());

  // `file:` did not move: the daemon's own store answers it as it always did.
  expect(await client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: `file://${root}/a.txt` },
  })).toMatchObject({ data: 'on disk' });

  expect(await client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'computer://local/status' },
  })).toEqual({ data: 'status of computer://local/status', encoding: 'utf-8' });

  expect(await client.handle({
    method: 'resourceResolve', params: { channel: 'ahp-root://', uri: 'computer://local/status' },
  })).toMatchObject({ uri: 'computer://local/status', type: 'file' });
});

it('answers -32601 for a method the provider left out, as a read-only store does', async () => {
  const client = await open(host());
  await expect(client.handle({
    method: 'resourceList', params: { channel: 'ahp-root://', uri: 'computer://local' },
  })).rejects.toMatchObject({ code: -32601 });
  await expect(client.handle({
    method: 'resourceWrite',
    params: { channel: 'ahp-root://', uri: 'computer://local/status', data: 'x', encoding: 'utf-8' },
  })).rejects.toMatchObject({ code: -32601 });
});

it('answers a scheme nobody serves with a code that says so, not a permission code', async () => {
  const client = await open(host({}));
  const refused = await client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'notes://local/x' },
  }).then(() => 'read', (error: { code: number; message: string }) => error);
  // The host has nothing that serves `notes:`, which is `-32601`; `-32009` is
  // for a person whose role does not cover a command it does serve.
  expect(refused).toMatchObject({ code: -32601 });
  expect((refused as { message: string }).message).toContain('nothing here serves notes:');
});

it('refuses a move whose two ends are different schemes', async () => {
  writeFileSync(join(root, 'from.txt'), 'carried');
  const client = await open(host());
  await expect(client.handle({
    method: 'resourceMove',
    params: { channel: 'ahp-root://', source: `file://${root}/from.txt`, destination: 'computer://local/from.txt' },
  })).rejects.toMatchObject({ code: -32602 });
});

it('relays a URI a client published before a provider of the same scheme', async () => {
  const answer = { data: 'from the client', encoding: 'utf-8' };
  const publisher: Peer = {
    send: () => {}, notify: () => {}, answered: () => {}, close: () => {},
    request: async () => answer,
  };
  const served = host({ virtual: computer() });
  const publishing = served.accept(publisher);
  await publishing.handle({ method: 'initialize', params: { clientId: 'editor', protocolVersions: ['0.9.0'] } });
  const client = await open(served);

  // The provider would have answered `status of virtual://editor/notes.md`.
  // The client that published the URI answered instead, because the relay runs
  // before any handler - which is what stops a plugin shadowing a client.
  expect(await client.handle({
    method: 'resourceRead', params: { channel: 'ahp-root://', uri: 'virtual://editor/notes.md' },
  })).toEqual(answer);
});
