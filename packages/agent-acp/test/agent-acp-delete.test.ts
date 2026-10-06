import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/clientcalls.js';
import type { Agent, Bag, Emit, Session, Start } from '@ahpd/sdk';
import { acpAgent } from '../src/index.js';

/*
 * Deleting an ACP session.
 *
 * Whether there is a delete to send is the server's own answer: `session/delete`
 * is only asked of a server whose handshake advertised it, and this bridge reads
 * that handshake while it reads the catalogue - which is the only call that
 * makes one. So the agent's `delete` is absent until then, and a dispose that
 * arrives first has nothing to send.
 *
 * The server behind every case is the real scripted subprocess, and `session/delete`
 * is a real removal there: the row is gone from the next `session/list`, and a
 * second delete of the same id is refused.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

const made: string[] = [];
const started: Session[] = [];

afterEach(() => {
  for (const session of started.splice(0)) session.close();
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

const scratch = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-delete-'));
  made.push(path);
  return path;
};

/** The backend under test, with its own request log. */
function backend(flags: string[] = []): { agent: Agent; log: string } {
  const log = join(scratch(), 'requests.jsonl');
  return {
    agent: acpAgent({
      command: process.execPath,
      args: [FIXTURE, ...flags],
      env: { ACP_LOG: log },
      provider: 'acp',
    }),
    log,
  };
}

/** Every request the fixture was sent, in order. */
const requests = (log: string): { method?: string; params?: Record<string, unknown> }[] => {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> });
  }
  catch {
    return [];
  }
};

const opening = (id: string, over: Partial<Start> = {}): Start => ({
  uri: `ahp-session:/${id}`,
  chatUri: `ahp-chat:/${id}`,
  settings: {},
  schema: () => ({ type: 'object', properties: {} }),
  emit: () => {},
  // The host always resolves this, and its own answer when the deployment said
  // nothing is ten minutes.
  clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  ...over,
});

/** Open one session and watch it, so this process holds a record of it. */
function start(agent: Agent, id: string): Session {
  const actions: Bag[] = [];
  const emit: Emit = (channel, action) => { actions.push(action); void channel; };
  const session = agent.create(opening(id, { emit }));
  started.push(session);
  return session;
}

it('has no delete to send before the server has been asked', () => {
  // Nothing has read a handshake yet, so there is no answer to give and the
  // property is absent rather than a function that refuses.
  const { agent } = backend();
  expect(agent.delete).toBeUndefined();
});

it('asks the server to delete, once it has advertised that it can', async () => {
  const { agent, log } = backend();
  // The catalogue is the read that makes the handshake.
  expect((await agent.list?.())?.map((one) => one.id)).toEqual(['listed-1', 'listed-2']);
  expect(agent.delete).toBeTypeOf('function');

  await agent.delete?.('listed-2', '/tmp/two');

  expect(agent.delete).toBeTypeOf('function');
  expect((await agent.list?.())?.map((one) => one.id)).toEqual(['listed-1']);
  expect(requests(log).some((one) => one.method === 'session/delete'
    && one.params?.sessionId === 'listed-2')).toBe(true);
});

it('counts a session the server does not have as deleted', async () => {
  const { agent } = backend();
  await agent.list?.();

  // The protocol's own not-found refusal, which is what a server that has
  // already lost a session says - and what the second delete of a row says.
  await expect(agent.delete?.('never-listed', '/tmp/none')).resolves.toBeUndefined();
  await agent.delete?.('listed-2', '/tmp/two');
  await expect(agent.delete?.('listed-2', '/tmp/two')).resolves.toBeUndefined();
  expect((await agent.list?.())?.map((one) => one.id)).toEqual(['listed-1']);
});

it('raises a delete the server refused for any other reason', async () => {
  // A server whose store will not let go refuses in its own words, and that is
  // a delete that did not happen: the conversation is still there, so the
  // client is told rather than answered as done.
  const { agent } = backend(['--delete-fails']);
  await agent.list?.();

  await expect(agent.delete?.('listed-1', '/tmp/one')).rejects.toThrow();
  expect((await agent.list?.())?.map((one) => one.id)).toEqual(['listed-1', 'listed-2']);
});

it('has no delete to send to a server whose handshake did not advertise one', async () => {
  const { agent, log } = backend(['--no-delete']);

  await agent.list?.();

  // Not a function that refuses: there is no request this server could answer,
  // so the host takes its own route and says once that the server kept a copy.
  expect(agent.delete).toBeUndefined();
  expect(requests(log).some((one) => one.method === 'session/delete')).toBe(false);
});

it('forgets a session this process watched, so the next listing does not offer it', async () => {
  const { agent } = backend(['--no-load']);
  // A server that cannot reopen a conversation still lists its own, so the
  // record this process holds is the only catalogue there would be.
  const one = start(agent, 'watched-1');
  expect(one).toBeDefined();
  await agent.list?.();

  await agent.delete?.('watched-1', '/tmp');

  const rows = await agent.list?.();
  expect(rows?.some((row) => row.id === 'watched-1')).toBe(false);
  // And the transcript is gone with it, which is what the record was for.
  expect(await agent.transcript?.('watched-1')).toBeUndefined();
});