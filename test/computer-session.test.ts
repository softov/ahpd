import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { acpAgent } from '../packages/agent-acp/src/index.js';
import type { ComputerPort } from '../packages/sdk/src/types/computers.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * A session that names a machine runs there.
 *
 * The server is the real ACP fixture, reached through a fake `computers` port:
 * the descriptor's command is the fixture and the backend's own command is a
 * program that exits immediately, so a turn that completes is proof the port's
 * answer is what ran. No Docker, and no network.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));
const FAILS = ['-e', 'process.exit(3)'];

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

const until = async (check: () => boolean, times = 3000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
};

type Note = { channel: string; action: Record<string, unknown> };

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type));

const settled = (p: ReturnType<typeof peer>, channel: string): boolean =>
  types(p, channel).some((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled' || type === 'chat/error');

const opened: { client: ReturnType<ReturnType<typeof createHost>['accept']>; uri: string }[] = [];
afterEach(async () => {
  for (const one of opened.splice(0)) {
    await one.client.handle({ method: 'disposeSession', params: { channel: one.uri } });
  }
});

/** A host with one ACP session, and the machine its settings named. */
async function talking(options: {
  command: string;
  args: string[];
  computers?: ComputerPort;
  computer?: string;
}) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-in-computer-'));
  const host = createHost({
    path,
    agents: [acpAgent({ command: options.command, args: options.args, provider: 'acp' })],
    ...(options.computers === undefined ? {} : { computers: options.computers }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/in';
  const chatUri = 'ahp-chat:/in';
  await client.handle({
    method: 'createSession',
    params: {
      channel: uri,
      provider: 'acp',
      ...(options.computer === undefined ? {} : { config: { computer: options.computer } }),
    },
  });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  opened.push({ client, uri });
  return { client, peer: p, chatUri };
}

/** One turn, dispatched the way a client dispatches it. */
const begin = (client: Awaited<ReturnType<typeof talking>>['client'], chatUri: string): void => {
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
  });
};

it('spawns the server through the machine the session named', async () => {
  const asked: { id: string; command: string }[] = [];
  const computers: ComputerPort = {
    how: async (id, spawn) => {
      asked.push({ id, command: spawn.command });
      return id === 'box' ? { command: process.execPath, args: [FIXTURE] } : undefined;
    },
  };

  // The backend's own command would exit before the handshake, so completing
  // means the descriptor is what ran.
  const { client, peer: p, chatUri } = await talking({
    command: process.execPath, args: FAILS, computers, computer: 'computer://box',
  });
  begin(client, chatUri);
  await until(() => settled(p, chatUri));

  expect(asked).toEqual([{ id: 'box', command: process.execPath }]);
  expect(types(p, chatUri)).toContain('chat/turnComplete');
});

it('refuses a machine that is not there rather than running on the host', async () => {
  const computers: ComputerPort = { how: async () => undefined };
  const { client, peer: p, chatUri } = await talking({
    command: process.execPath, args: [FIXTURE], computers, computer: 'computer://nope',
  });
  begin(client, chatUri);
  await until(() => settled(p, chatUri));

  const failure = actions(p, chatUri).find((one) => one.action.type === 'chat/error');
  const part = failure?.action.part as { error?: { message?: string } } | undefined;
  expect(part?.error?.message).toContain('There is no computer called nope');
  expect(types(p, chatUri)).not.toContain('chat/turnComplete');
});

it('refuses a named machine on a host with no computer plugin', async () => {
  const { client, peer: p, chatUri } = await talking({
    command: process.execPath, args: [FIXTURE], computer: 'computer://box',
  });
  begin(client, chatUri);
  await until(() => settled(p, chatUri));

  const failure = actions(p, chatUri).find((one) => one.action.type === 'chat/error');
  const part = failure?.action.part as { error?: { message?: string } } | undefined;
  expect(part?.error?.message).toContain('no computer plugin');
  expect(types(p, chatUri)).not.toContain('chat/turnComplete');
});

it('spawns its own command when the session names no machine', async () => {
  let asked = 0;
  const computers: ComputerPort = { how: async () => { asked++; return { command: process.execPath, args: [FIXTURE] }; } };
  const { client, peer: p, chatUri } = await talking({
    command: process.execPath, args: [FIXTURE], computers,
  });
  begin(client, chatUri);
  await until(() => settled(p, chatUri));

  expect(asked).toBe(0);
  expect(types(p, chatUri)).toContain('chat/turnComplete');
});
