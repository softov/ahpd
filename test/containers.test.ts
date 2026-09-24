import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost, ROOT } from '../packages/sdk/src/host.js';
import { echo } from '../examples/echo/agent.js';
import type { ContainerPort, ContainerSink } from '../packages/sdk/src/types/containers.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';
import type { Grant, Users } from '../packages/sdk/src/types/users.js';

/*
 * The dev container surface.
 *
 * The names and the shapes are the reference client's, so what is asserted here
 * is what that client is entitled to: the capability key present only where a
 * launcher can answer it, the four methods, the four notifications, per-client
 * names, and a grant that is asked for by name rather than assumed.
 *
 * The launcher is a fake, because `pnpm test` has no Docker and this machine
 * has no `devcontainer`. What is under test is the surface: the frames and the
 * policy, not the CLI.
 */

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-containers-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

type Bag = Record<string, any>;

/** A directory whose one token is decided by hand, so a role is one array. */
const directory = (tokens: Record<string, Grant[]>): Users => ({
  resource: { resource: 'ahpd://users', resource_name: 'ahpd users', required: false },
  verify: async (token) => {
    const held = tokens[token];
    return held === undefined ? undefined : { id: token, roles: ['r'], can: (one: Grant) => held.includes(one) };
  },
  list: async () => [],
  add: async () => {},
  remove: async () => false,
  mint: async () => '',
});

/** A peer that keeps what it was told, for the half that answers with a notification. */
const watching = (): Peer & { seen: { method: string; params: Bag }[] } => {
  const seen: { method: string; params: Bag }[] = [];
  return {
    seen,
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method: string, params: unknown) => { seen.push({ method, params: params as Bag }); },
  };
};

interface Fake {
  port: ContainerPort;
  sent: { connectionId: string; data: string }[];
  sinks: Map<string, ContainerSink>;
  stopped: string[];
  opened: number;
}

/** A launcher that keeps what it was asked, and says what it was told to. */
const launcher = (options: { available?: boolean; fail?: string } = {}): Fake => {
  const sent: { connectionId: string; data: string }[] = [];
  const sinks = new Map<string, ContainerSink>();
  const stopped: string[] = [];
  const fake: Fake = { sent, sinks, stopped, opened: 0, port: undefined as unknown as ContainerPort };
  fake.port = {
    // Docker and the whole launcher are one answer in this fake: what is under
    // test is which question the surface asks, not two probes.
    docker: async () => options.available !== false,
    available: async () => options.available !== false,
    connect: async (one, sink) => {
      fake.opened += 1;
      // The CLI says what it is doing before it is done, which is what the
      // `output` notification is for.
      sink.output(`$ devcontainer up --workspace-folder ${one.workspaceFolder}\n`);
      if (options.fail !== undefined) throw new Error(options.fail);
      sinks.set(one.connectionId, sink);
      return { address: 'devcontainer:abc123', remoteWorkspaceFolder: `/workspaces/${one.name}` };
    },
    send: (id, data) => { sent.push({ connectionId: id, data }); },
    disconnect: (id) => { stopped.push(id); sinks.delete(id); },
  };
  return fake;
};

/** A host, its peer, and the handshake already answered. */
async function open(extra: Partial<HostOptions> = {}) {
  const host = createHost({
    path: root,
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
    ...extra,
  });
  const peer = watching();
  const client = host.accept(peer);
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  }) as Bag;
  return { client, peer, ready };
}

/** The refusal, or the result, whichever the host answered with. */
const call = async (client: ReturnType<ReturnType<typeof createHost>['accept']>, method: string, params: Record<string, unknown>) =>
  client.handle({ method, params }).then(
    (result) => ({ result }) as Bag,
    (error: { code: number; message: string; data?: unknown }) => error as Bag,
  );

const connect = { connectionId: 'a', workspaceFolder: '/work/one', name: 'Box' };

it('advertises the capability only where a launcher is loaded', async () => {
  const without = await open();
  expect(without.ready._meta?.['vscode.devContainers']).toBeUndefined();
  // And the method is not served at all, which is the honest answer rather
  // than a false.
  expect(await call(without.client, 'vscode/devContainers/isDockerAvailable', {}))
    .toMatchObject({ code: -32601 });

  const with_ = await open({ containers: launcher().port });
  expect(with_.ready._meta?.['vscode.devContainers']).toBe(true);
  expect((await call(with_.client, 'vscode/devContainers/isDockerAvailable', {})).result).toBe(true);

  const noDocker = await open({ containers: launcher({ available: false }).port });
  expect((await call(noDocker.client, 'vscode/devContainers/isDockerAvailable', {})).result).toBe(false);
});

it('answers the reference shape, and carries frames both ways', async () => {
  const fake = launcher();
  const { client, peer } = await open({ containers: fake.port });

  const made = await call(client, 'vscode/devContainers/connect', connect);
  expect(made.result).toEqual({
    connectionId: 'a',
    name: 'Box',
    address: 'devcontainer:abc123',
    remoteWorkspaceFolder: '/workspaces/Box',
  });
  // What the CLI printed on the way is already on the wire.
  expect(peer.seen).toContainEqual({
    method: 'vscode/devContainers/output',
    params: { connectionId: 'a', data: expect.stringContaining('devcontainer up') },
  });

  const frame = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} });
  await call(client, 'vscode/devContainers/relaySend', { connectionId: 'a', data: frame });
  expect(fake.sent).toEqual([{ connectionId: 'a', data: frame }]);

  fake.sinks.get('a')?.message('{"jsonrpc":"2.0","id":1,"result":{}}');
  expect(peer.seen).toContainEqual({
    method: 'vscode/devContainers/relayMessage',
    params: { connectionId: 'a', data: '{"jsonrpc":"2.0","id":1,"result":{}}' },
  });

  // A relay that ends says so twice, in the order the reference host does.
  fake.sinks.get('a')?.close('exit 1');
  expect(peer.seen.slice(-2).map((one) => one.method)).toEqual([
    'vscode/devContainers/relayClose',
    'vscode/devContainers/closeConnection',
  ]);
  // And a frame after that is not a silent nothing.
  expect(await call(client, 'vscode/devContainers/relaySend', { connectionId: 'a', data: frame }))
    .toMatchObject({ code: -32008 });
});

it('keeps one client\'s names to itself', async () => {
  const fake = launcher();
  const first = await open({ containers: fake.port });
  const second = await open({ containers: fake.port });

  expect((await call(first.client, 'vscode/devContainers/connect', connect)).result).toBeDefined();
  // The other client never opened `a`, whatever the first one did.
  expect(await call(second.client, 'vscode/devContainers/relaySend', { connectionId: 'a', data: '{}' }))
    .toMatchObject({ code: -32008 });
  expect(await call(second.client, 'vscode/devContainers/disconnect', { connectionId: 'a' }))
    .toMatchObject({ code: -32008 });
  // The same name is the second client's own to use, and the port sees two.
  expect((await call(second.client, 'vscode/devContainers/connect', connect)).result).toBeDefined();
  expect(fake.opened).toBe(2);
});

it('refuses a second container under a name the client is already using', async () => {
  const fake = launcher();
  const { client } = await open({ containers: fake.port });
  await call(client, 'vscode/devContainers/connect', connect);
  const again = await call(client, 'vscode/devContainers/connect', connect);
  expect(again).toMatchObject({ code: -32602 });
  expect(again.message).toContain('already in use');
  expect(fake.opened).toBe(1);
});

it('asks for container:write rather than assuming it', async () => {
  const fake = launcher();
  const users = directory({ reader: ['file:read'], maker: ['container:write'] });
  const poor = await open({ containers: fake.port, users });
  await call(poor.client, 'authenticate', { channel: ROOT, resource: users.resource.resource, token: 'reader' });
  // The probe is ungated, so a client that may not make one may still ask
  // whether one could be made.
  expect((await call(poor.client, 'vscode/devContainers/isDockerAvailable', {})).result).toBe(true);
  const refused = await call(poor.client, 'vscode/devContainers/connect', connect);
  expect(refused).toMatchObject({ code: -32009 });
  expect(refused.message).toContain('container:write');
  expect(fake.opened).toBe(0);

  const rich = await open({ containers: fake.port, users });
  await call(rich.client, 'authenticate', { channel: ROOT, resource: users.resource.resource, token: 'maker' });
  expect((await call(rich.client, 'vscode/devContainers/connect', connect)).result).toBeDefined();
});

it('reports what the launcher says when a container cannot be made', async () => {
  const fake = launcher({ fail: 'There is no devcontainer.json in /work/one' });
  const { client } = await open({ containers: fake.port });
  const refused = await call(client, 'vscode/devContainers/connect', connect);
  expect(refused.message).toContain('no devcontainer.json');
  // The name is free again, and nothing was left running.
  expect(fake.stopped).toEqual(['a']);
  expect(await call(client, 'vscode/devContainers/relaySend', { connectionId: 'a', data: '{}' }))
    .toMatchObject({ code: -32008 });
});

it('stops a connection\'s containers when it goes', async () => {
  const fake = launcher();
  const { client } = await open({ containers: fake.port });
  await call(client, 'vscode/devContainers/connect', connect);
  client.close();
  // A socket that drops does not leave a host running in a container for
  // nobody.
  expect(fake.stopped).toEqual(['a']);
});

it('checks the three strings a connect carries', async () => {
  const fake = launcher();
  const { client } = await open({ containers: fake.port });
  for (const bad of [
    { connectionId: '', workspaceFolder: '/work', name: 'Box' },
    { connectionId: 'a'.repeat(257), workspaceFolder: '/work', name: 'Box' },
    { connectionId: 'a', workspaceFolder: '', name: 'Box' },
    { connectionId: 'a', workspaceFolder: '/work', name: '  ' },
  ]) {
    expect(await call(client, 'vscode/devContainers/connect', bad)).toMatchObject({ code: -32602 });
  }
  expect(fake.opened).toBe(0);
});
