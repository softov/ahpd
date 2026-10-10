import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { holds } from '../src/users.js';
import { echo } from '../../../examples/echo/agent.js';
import type { ContainerPort, ContainerSink } from '../src/types/containers.js';
import type { HostOptions } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
import type { Grant, Users } from '../src/types/users.js';

/*
 * The dev container surface.
 *
 * The names and the shapes are the reference client's, so what is asserted here
 * is what that client is entitled to: the capability key present only where a
 * launcher can answer it, the methods and the notifications it sends, per-client
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
    return held === undefined ? undefined : { id: token, roles: ['r'], can: (one: Grant) => holds(new Set(held), one) };
  },
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
  /** Every folder a `stop` was asked for, in the order it was asked. */
  halted: string[];
  /** Every folder a `remove` was asked for, in the order it was asked. */
  gone: string[];
  opened: number;
}

/**
 * A launcher that keeps what it was asked, and says what it was told to.
 *
 * `halts: false` is a launcher that cannot reach the runtime's own stop, which
 * is the one that serves no `stop` and no `remove` - the whole reason those two
 * are optional on the port.
 */
const launcher = (options: { available?: boolean; fail?: string; halts?: boolean } = {}): Fake => {
  const sent: { connectionId: string; data: string }[] = [];
  const sinks = new Map<string, ContainerSink>();
  const stopped: string[] = [];
  const halted: string[] = [];
  const gone: string[] = [];
  const fake: Fake = { sent, sinks, stopped, halted, gone, opened: 0, port: undefined as unknown as ContainerPort };
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
    ...(options.halts === false ? {} : {
      // A folder this launcher holds no computer for is `true`, as the real one
      // answers: nothing of that folder's is running, so nothing is left to do.
      stop: async (folder: string) => { halted.push(folder); return true; },
      remove: async (folder: string) => { gone.push(folder); return true; },
    }),
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
  return { host, client, peer, ready };
}

/**
 * One more client on a host that is already serving one.
 *
 * A question about a relay another connection holds needs two connections on
 * one host, which two hosts cannot stand in for.
 */
const another = async (host: ReturnType<typeof createHost>) => {
  const peer = watching();
  const client = host.accept(peer);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'other', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  return { client, peer };
};

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

it('asks for the container operation rather than assuming it', async () => {
  const fake = launcher();
  const users = directory({ reader: ['file:read'], maker: ['container:write'] });
  const poor = await open({ containers: fake.port, users });
  await call(poor.client, 'authenticate', { channel: ROOT, resource: users.resource.resource, token: 'reader' });
  // The probe is ungated, so a client that may not make one may still ask
  // whether one could be made.
  expect((await call(poor.client, 'vscode/devContainers/isDockerAvailable', {})).result).toBe(true);
  const refused = await call(poor.client, 'vscode/devContainers/connect', connect);
  expect(refused).toMatchObject({ code: -32009 });
  expect(refused.message).toContain('container:connect');
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

/*
 * container/02 task 04: the two the reference client sends when a dev container
 * is idle or gone.
 *
 * The folder is the whole of what either names, so nothing of this client's is
 * remembered by them: whether the container is still in use is asked of every
 * live connection and of the sessions this host has placed, which is why both
 * helpers below exist on the host rather than on one connection.
 */

it('checks the folder a stop or a remove names', async () => {
  const fake = launcher();
  const { client } = await open({ containers: fake.port });
  for (const bad of [
    {},
    { workspaceFolder: '' },
    { workspaceFolder: '   ' },
    // A relative path is not a folder a client chose: resolving it against
    // this process's own working directory would stop something nobody asked
    // about.
    { workspaceFolder: 'work/one' },
    { workspaceFolder: 7 },
    { workspaceFolder: '/work\0/one' },
  ]) {
    expect(await call(client, 'vscode/devContainers/stop', bad)).toMatchObject({ code: -32602 });
    expect(await call(client, 'vscode/devContainers/remove', bad)).toMatchObject({ code: -32602 });
  }
  expect(fake.halted).toEqual([]);
  expect(fake.gone).toEqual([]);
});

it('stops and removes the folder it names, ending this connection\'s relay first', async () => {
  const fake = launcher();
  const { client } = await open({ containers: fake.port });

  // A folder this launcher holds no computer for: the answer is still the
  // launcher's, because the host cannot know what the runtime holds.
  expect((await call(client, 'vscode/devContainers/stop', { workspaceFolder: '/work/one' })).result).toBe(true);
  expect(fake.halted).toEqual(['/work/one']);

  // With a relay of this connection's own on the folder, the host ends it
  // before the container is stopped, so nothing is left running inside one
  // that is going away.
  await call(client, 'vscode/devContainers/connect', connect);
  expect((await call(client, 'vscode/devContainers/stop', { workspaceFolder: '/work/one' })).result).toBe(true);
  expect(fake.stopped).toEqual(['a']);
  expect(fake.halted).toEqual(['/work/one', '/work/one']);
  // And the name is free again, so a frame on it is not a silent nothing.
  expect(await call(client, 'vscode/devContainers/relaySend', { connectionId: 'a', data: '{}' }))
    .toMatchObject({ code: -32008 });

  expect((await call(client, 'vscode/devContainers/remove', { workspaceFolder: '/work/one' })).result).toBe(true);
  expect(fake.gone).toEqual(['/work/one']);
});

it('leaves a folder alone while another connection is relaying to it', async () => {
  const fake = launcher();
  const first = await open({ containers: fake.port });
  await call(first.client, 'vscode/devContainers/connect', connect);
  const second = await another(first.host);

  // The second window is the one asking, and the first one's container is not
  // its to take away: `false` is the reference host's answer, and the launcher
  // is never reached.
  const refused = await call(second.client, 'vscode/devContainers/stop', { workspaceFolder: '/work/one' });
  expect(refused.result).toBe(false);
  expect(fake.halted).toEqual([]);
  expect(fake.stopped).toEqual([]);
  // The same for a remove, which would take the machine the first is using.
  expect((await call(second.client, 'vscode/devContainers/remove', { workspaceFolder: '/work/one' })).result).toBe(false);
  expect(fake.gone).toEqual([]);
  // Another spelling of the same folder is the same folder.
  expect((await call(second.client, 'vscode/devContainers/stop', { workspaceFolder: '/work/./one/' })).result).toBe(false);
  expect(fake.halted).toEqual([]);

  // It is the first connection's own to stop, and then it happens.
  expect((await call(first.client, 'vscode/devContainers/stop', { workspaceFolder: '/work/one' })).result).toBe(true);
  expect(fake.halted).toEqual(['/work/one']);
});

it('refuses a stop a launcher cannot reach the runtime\'s own stop for', async () => {
  // A launcher with the relay surface and no stop: the method is refused the
  // way an absent launcher is, rather than served a false that would read as
  // "somebody else is using it".
  const fake = launcher({ halts: false });
  const { client } = await open({ containers: fake.port });
  const stopped = await call(client, 'vscode/devContainers/stop', { workspaceFolder: '/work/one' });
  expect(stopped).toMatchObject({ code: -32601 });
  expect(stopped.message).toContain('vscode/devContainers/stop');
  expect(await call(client, 'vscode/devContainers/remove', { workspaceFolder: '/work/one' }))
    .toMatchObject({ code: -32601 });
});

it('asks for the container operation and the machine beside it', async () => {
  const users = directory({
    reader: ['file:read'],
    relayer: ['container:write'],
    destroyer: ['container:write', 'computer:write'],
  });

  // A client that may not touch a container at all is refused by the operation
  // it asked for, and never reaches the launcher.
  const fake = launcher();
  const poor = await open({ containers: fake.port, users });
  await call(poor.client, 'authenticate', { channel: ROOT, resource: users.resource.resource, token: 'reader' });
  const refused = await call(poor.client, 'vscode/devContainers/stop', { workspaceFolder: '/work/one' });
  expect(refused).toMatchObject({ code: -32009 });
  expect(refused.message).toContain('container:stop');
  expect(fake.halted).toEqual([]);

  // Reaching the relay surface is not the same as destroying the machine
  // behind it: `container:write` is the first grant and not the second.
  const held = await open({ containers: fake.port, users });
  await call(held.client, 'authenticate', { channel: ROOT, resource: users.resource.resource, token: 'relayer' });
  const notOwned = await call(held.client, 'vscode/devContainers/remove', { workspaceFolder: '/work/one' });
  expect(notOwned).toMatchObject({ code: -32009 });
  expect(notOwned.message).toContain('computer:write');
  expect(fake.gone).toEqual([]);

  const rich = await open({ containers: fake.port, users });
  await call(rich.client, 'authenticate', { channel: ROOT, resource: users.resource.resource, token: 'destroyer' });
  expect((await call(rich.client, 'vscode/devContainers/stop', { workspaceFolder: '/work/one' })).result).toBe(true);
  expect((await call(rich.client, 'vscode/devContainers/remove', { workspaceFolder: '/work/one' })).result).toBe(true);
});
