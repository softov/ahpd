/*
 * Which sessions have a turn running.
 *
 * What a restart asks before it takes every session's process down: a session
 * is named from the moment its turn starts until the turn ends, and never
 * before or after.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { fileResources } from '../src/resources.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';

const SESSION = 'ahp-session:/one';
const CHAT = 'ahp-chat:/one';

/**
 * A client that hears the chat, and answers `turning()` at the moment each
 * action it names arrives, so what is read is the host's state at that event
 * and no clock decides it.
 */
const peer = (seen: Map<string, string[]>, host: () => { turning(): string[] }, types: readonly string[]): Peer => ({
  name: 'client',
  send: () => {},
  notify: (method: string, params: unknown) => {
    const type = (params as { action?: { type?: string } } | undefined)?.action?.type;
    if (method !== 'action' || type === undefined || !types.includes(type) || seen.has(type)) return;
    seen.set(type, host().turning());
  },
  request: async () => ({}),
  answered: () => {},
  close: () => {},
}) as unknown as Peer;

/** What `turning()` answered when that action arrived, once it has; a failure naming it if it never does. */
const heard = async (seen: Map<string, string[]>, type: string): Promise<string[]> => {
  const until = Date.now() + 5000;
  while (!seen.has(type)) {
    if (Date.now() > until) throw new Error(`${type} never arrived`);
    await new Promise((done) => { setImmediate(done); });
  }
  return seen.get(type) as string[];
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ahpd-turning-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('turning', () => {
  it('names a session while its turn runs, and not before or after', async () => {
    const host = createHost({ path: dir, agents: [echo({ path: dir, pace: 40 })], resources: fileResources() });
    const seen = new Map<string, string[]>();
    const client = host.accept(peer(seen, () => host, ['chat/delta', 'chat/turnComplete']));
    await client.handle({ method: 'initialize', params: { clientId: 'c', protocolVersions: ['0.9.0'] } });
    await client.handle({ method: 'createSession', params: { channel: SESSION, provider: 'echo' } });
    await client.handle({ method: 'subscribe', params: { channel: CHAT } });
    expect(host.turning()).toEqual([]);

    await client.handle({
      method: 'dispatchAction',
      params: { channel: CHAT, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'one two three four five' } } },
    });
    // The first word streamed is inside the turn, whatever the pace.
    expect(await heard(seen, 'chat/delta')).toEqual([SESSION]);

    // The turn is over by the time it says so.
    expect(await heard(seen, 'chat/turnComplete')).toEqual([]);
    expect(host.turning()).toEqual([]);
    client.close();
  });
});
