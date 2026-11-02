import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHost, hello, machine, peer, resetSdk, settle } from './support/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { uriOf } from '../src/resources/fileuri.js';
import { memorySessions } from '../src/sessions/sessions.js';
import type { Agent } from '@ahpd/sdk';

/*
 * A session in the middle of a restart.
 *
 * A config change before the first turn starts the backend again, and the
 * session is out of the running ones until it is back. A backend that has no
 * transcript yet does not list it either, so a listing in that window read the
 * record as one for a session deleted outside this host, and pruned it: owner,
 * scope and config with it.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

let folder = '';
beforeEach(() => { folder = mkdtempSync(join(tmpdir(), 'ahpd-restarting-')); });
// Awaited, with retries: on Windows the host can hold the folder a moment longer.
afterEach(async () => { await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

/** Ticks until this is true, or long enough that it plainly is not. */
const until = async (wanted: () => boolean): Promise<void> => {
  for (let i = 0; i < 500 && !wanted(); i++) await settle(2);
  if (!wanted()) throw new Error('still waiting');
};

it('keeps the record of a session a listing finds mid-restart', async () => {
  // The close the restart waits on, held until the listing has run.
  let release = (): void => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let closing = 0;
  const base = echo({ path: folder, pace: 0 });
  const agent: Agent = {
    ...base,
    directories: () => [folder],
    list: async () => [],
    transcript: async () => [],
    // A key read when the backend starts, so a new value before the first
    // turn starts it again.
    schema: () => ({
      type: 'object',
      properties: { mode: { type: 'string', title: 'Mode', sessionMutable: false } },
    }),
    create: (start) => {
      const session = base.create(start);
      const close = session.close.bind(session);
      session.close = (why) => {
        closing += 1;
        void close(why);
        return held;
      };
      return session;
    },
  };
  const store = memorySessions();
  const host = createHost({ path: folder, agents: [agent], ...machine(), sessions: store });
  const client = host.accept(peer());
  await client.handle(hello(['0.9.0']));
  const uri = 'echo:/restarting';
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'echo', workingDirectories: [uriOf(folder)], config: { mode: 'plain', tone: 'calm' } },
  });
  const before = store.rowOf('restarting');
  expect(before?.config).toEqual({ mode: 'plain', tone: 'calm' });

  const changed = client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/configChanged', config: { mode: 'other' } } },
  });
  await until(() => closing > 0);
  await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } });
  release();
  await changed;
  await settle();

  expect(closing).toBe(1);
  // `tone` was written when the session was made, and only there.
  expect(store.rowOf('restarting')?.config).toEqual({ mode: 'other', tone: 'calm' });
});

it('keeps nothing of a session its backend refused to start', async () => {
  const base = echo({ path: folder, pace: 0 });
  const agent: Agent = { ...base, create: () => { throw new Error(`${folder} is not served here`); } };
  const store = memorySessions();
  const host = createHost({ path: folder, agents: [agent], ...machine(), sessions: store });
  const client = host.accept(peer());
  await client.handle(hello(['0.9.0']));

  await expect(client.handle({
    method: 'createSession',
    params: { channel: 'echo:/refused', provider: 'echo', workingDirectories: [uriOf(folder)] },
  })).rejects.toMatchObject({ message: `${folder} is not served here` });
  // The read marks and the title were written for the session before its
  // backend started, and the session never existed.
  expect(store.rowOf('refused')).toBeUndefined();
});
