import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost, ROOT } from '../packages/sdk/src/host.js';
import { echo } from '../examples/echo/agent.js';
import type { ContainerPort, ContainerSink } from '../packages/sdk/src/types/containers.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * The relay, end to end, with a real host on the other side of it.
 *
 * The nested host is this repository's own daemon in stdio mode - a real
 * process, a real pipe, real frames - and the only fake is the launcher that
 * would have put it in a container. So this is the case that says the relay is
 * not a story: a client asks for a container, speaks AHP through `relaySend`,
 * and is answered by a host that is not this one.
 *
 * No Docker and no `devcontainer`, because the CLI's work is the launcher's own
 * test's and nothing here is about it.
 */

const REPO = join(import.meta.dirname, '..');
// The nested daemon has no backend of its own - decision
// `the-daemon-bundles-no-agent` - so the configuration names one, and it is
// the example's, arriving the way any plugin's backend does. A daemon
// configured with none refuses to start, which is what this relay would then
// be relaying to.
const CONFIG = '{"paths":[],"withoutConnectionToken":true,"sessions":"memory","automations":"memory","plugins":["./test/fixtures/plugin-echo"]}';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-relay-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

type Bag = Record<string, any>;

const watching = (): Peer & { seen: { method: string; params: Bag }[] } => {
  const seen: { method: string; params: Bag }[] = [];
  return {
    seen,
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method: string, params: unknown) => { seen.push({ method, params: params as Bag }); },
  };
};

/** The launcher, as a port that starts the real daemon on a pipe. */
const onAStdin = (): ContainerPort & { children: ChildProcessWithoutNullStreams[] } => {
  const children: ChildProcessWithoutNullStreams[] = [];
  const live = new Map<string, ChildProcessWithoutNullStreams>();
  return {
    children,
    docker: async () => true,
    available: async () => true,
    connect: async (one, sink: ContainerSink) => {
      const config = join(root, `nested-${one.connectionId}.json`);
      writeFileSync(config, CONFIG);
      const child = spawn(
        process.execPath,
        ['--conditions', 'development', '--import', './scripts/dev.mjs', 'packages/server/src/main.ts', '--stdio', '--config-file', config],
        { cwd: REPO, env: { ...process.env, CI: '1' }, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      children.push(child);
      live.set(one.connectionId, child);
      let tail = '';
      child.stdout.on('data', (chunk: Buffer) => {
        tail += String(chunk);
        let at = tail.indexOf('\n');
        while (at !== -1) {
          const line = tail.slice(0, at);
          tail = tail.slice(at + 1);
          if (line.trim() !== '') sink.message(line);
          at = tail.indexOf('\n');
        }
      });
      // What the nested host says outside the protocol is a person's to read.
      child.stderr.on('data', (chunk: Buffer) => { sink.output(String(chunk)); });
      child.once('close', (code) => { live.delete(one.connectionId); sink.close(code === 0 ? undefined : `exit ${String(code)}`); });
      return { address: 'devcontainer:test', remoteWorkspaceFolder: '/workspaces/Box', hostWorkspaceFolder: root };
    },
    send: (id, data) => { live.get(id)?.stdin.write(`${data}\n`); },
    disconnect: (id) => { live.get(id)?.kill('SIGTERM'); live.delete(id); },
  };
};

/** The outer host, a client of it, and the handshake already answered. */
async function outer(port: ContainerPort) {
  const host = createHost({
    path: root,
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
    containers: port,
  });
  const peer = watching();
  const client = host.accept(peer);
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'window', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  }) as Bag;
  return { client, peer, ready };
}

const frames = (peer: ReturnType<typeof watching>, id: number): Bag[] => peer.seen
  .filter((one) => one.method === 'vscode/devContainers/relayMessage')
  .map((one) => JSON.parse(String(one.params.data)) as Bag)
  .filter((one) => one.id === id);

const until = async (check: () => boolean, times = 1200): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 5); });
  }
};

it('a session\'s host on the other side of the relay is a real one', async () => {
  const port = onAStdin();
  const { client, peer, ready } = await outer(port);
  // The key is advertised because the launcher answered that it can.
  expect(ready._meta?.['vscode.devContainers']).toBe(true);

  const made = await client.handle({
    method: 'vscode/devContainers/connect',
    params: { connectionId: 'box', workspaceFolder: root, name: 'Box' },
  }) as Bag;
  expect(made).toMatchObject({ connectionId: 'box', name: 'Box', remoteWorkspaceFolder: '/workspaces/Box' });

  // The nested host's own handshake, carried as a string this host never reads.
  await client.handle({
    method: 'vscode/devContainers/relaySend',
    params: {
      connectionId: 'box',
      data: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientId: 'window', protocolVersions: ['0.9.0'] } }),
    },
  });
  await until(() => frames(peer, 1).length > 0);
  const answered = frames(peer, 1)[0];
  expect(answered?.result).toMatchObject({ protocolVersion: '0.9.0' });
  // A different host, answering about itself: this one's serverInfo is the
  // daemon's, and its own default directory is the empty list it was given.
  expect(answered?.result?.serverInfo?.name).toBe('ahpd');
  expect(answered?.result?._meta?.['vscode.devContainers']).toBeUndefined();

  await client.handle({
    method: 'vscode/devContainers/relaySend',
    params: { connectionId: 'box', data: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} }) },
  });
  await until(() => frames(peer, 2).length > 0);
  expect(frames(peer, 2)[0]?.result).toEqual({});

  // And what it printed outside the protocol arrived as output, not a frame.
  expect(peer.seen.some((one) => one.method === 'vscode/devContainers/output')).toBe(true);

  await client.handle({ method: 'vscode/devContainers/disconnect', params: { connectionId: 'box' } });
  await until(() => port.children.every((child) => child.exitCode !== null || child.signalCode !== null));
  // A frame after a disconnect is refused rather than written into nothing.
  await expect(client.handle({
    method: 'vscode/devContainers/relaySend',
    params: { connectionId: 'box', data: '{}' },
  })).rejects.toMatchObject({ code: -32008 });
});

it('says the capability is false, and offers nothing, when the launcher cannot', async () => {
  const port: ContainerPort = {
    docker: async () => true,
    available: async () => false,
    connect: async () => { throw new Error('never asked'); },
    send: () => {},
    disconnect: () => {},
  };
  const { ready } = await outer(port);
  expect(ready._meta?.['vscode.devContainers']).toBeUndefined();
});
