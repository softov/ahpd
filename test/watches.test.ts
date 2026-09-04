import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { fileResources, list, read, resolve, complete } from '../src/resources.js';
import { echo } from '../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * Watching a directory, against a real one.
 *
 * The events come from the kernel, so they arrive when they arrive: every
 * assertion here waits for what it is expecting rather than sleeping a fixed
 * time and hoping. A test that slept would be one that passes on a quiet
 * machine and fails on a busy one, which is worse than no test.
 */

let root: string;

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return { notes, send: () => {}, notify: (method, params) => notes.push({ method, params }), request: async () => ({}), answered: () => {}, close: () => {} };
}

async function connected(store = fileResources()) {
  const host = createHost({ path: root, agents: [echo({ path: root, pace: 0 })], resources: store });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'w', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  });
  return { host, client, peer: p };
}

/** Every change reported on one channel so far, flattened. */
const changes = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: { type: string; changes?: { items: { uri: string; type: string }[] } } })
  .filter((n) => n.channel === channel && n.action.type === 'resourceWatch/changed')
  .flatMap((n) => n.action.changes?.items ?? []);

/** Wait for a condition the kernel will make true, or give up loudly. */
const until = async (what: () => boolean, why: string, ms = 4000): Promise<void> => {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (what()) return;
    await new Promise((r) => { setTimeout(r, 10); });
  }
  throw new Error(`Timed out waiting for ${why}`);
};

const refused = async (run: Promise<unknown>): Promise<{ code: number; message: string }> => {
  try {
    await run;
    throw new Error('That was supposed to be refused.');
  }
  catch (error) {
    const held = error as { code?: number; message: string };
    expect(typeof held.code, held.message).toBe('number');
    return { code: held.code as number, message: held.message };
  }
};

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-watch-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it('hands back a channel, and says what the watch is when you subscribe to it', async () => {
  const { client } = await connected();
  const made = await client.handle({
    method: 'createResourceWatch',
    params: { channel: 'ahp-root://', uri: `file://${root}`, recursive: true, excludes: { items: ['**/node_modules/**'] } },
  }) as { channel: string };
  expect(made.channel.startsWith('ahp-resource-watch:/')).toBe(true);

  const opened = await client.handle({ method: 'subscribe', params: { channel: made.channel } }) as {
    snapshot: { state: { root: string; recursive: boolean; excludes?: { items: string[] } } };
  };
  // The state is what the watch *is*, not what it has seen: the protocol's
  // reducer keeps no history, so a client arriving later has missed what it
  // was not there for and the snapshot cannot pretend otherwise.
  expect(opened.snapshot.state).toEqual({
    root: `file://${root}`,
    recursive: true,
    excludes: { items: ['**/node_modules/**'] },
  });
});

it('reports a file appearing, changing and going', async () => {
  const { client, peer: p } = await connected();
  const made = await client.handle({
    method: 'createResourceWatch', params: { channel: 'ahp-root://', uri: `file://${root}`, recursive: true },
  }) as { channel: string };
  await client.handle({ method: 'subscribe', params: { channel: made.channel } });

  writeFileSync(join(root, 'a.txt'), 'one');
  await until(() => changes(p, made.channel).some((c) => c.uri.endsWith('/a.txt') && c.type === 'added'), 'the file to appear');

  writeFileSync(join(root, 'a.txt'), 'one\ntwo');
  await until(() => changes(p, made.channel).some((c) => c.uri.endsWith('/a.txt') && c.type === 'updated'), 'the file to change');

  unlinkSync(join(root, 'a.txt'));
  await until(() => changes(p, made.channel).some((c) => c.uri.endsWith('/a.txt') && c.type === 'deleted'), 'the file to go');
});

it('honours the excludes it was given', async () => {
  const { client, peer: p } = await connected();
  const made = await client.handle({
    method: 'createResourceWatch',
    params: {
      channel: 'ahp-root://',
      uri: `file://${root}`,
      recursive: true,
      excludes: { items: ['**/node_modules/**'] },
    },
  }) as { channel: string };
  await client.handle({ method: 'subscribe', params: { channel: made.channel } });

  mkdirSync(join(root, 'node_modules/left-pad'), { recursive: true });
  writeFileSync(join(root, 'node_modules/left-pad/index.js'), 'x');
  writeFileSync(join(root, 'wanted.txt'), 'x');

  // The one that is not excluded is what proves the excluded ones were seen
  // and dropped rather than simply not having happened yet.
  await until(() => changes(p, made.channel).some((c) => c.uri.endsWith('/wanted.txt')), 'the file that is not excluded');
  // Nothing *under* it, which is what the pattern says: `**\/node_modules/**`
  // excludes the contents, and the directory node itself is one event rather
  // than the fifty thousand an install writes inside it.
  expect(changes(p, made.channel).some((c) => c.uri.includes('node_modules/'))).toBe(false);
});

it('lets the watcher go when the last subscriber leaves, and when the client does', async () => {
  const { host, client, peer: p } = await connected();
  const made = await client.handle({
    method: 'createResourceWatch', params: { channel: 'ahp-root://', uri: `file://${root}`, recursive: true },
  }) as { channel: string };
  await client.handle({ method: 'subscribe', params: { channel: made.channel } });
  writeFileSync(join(root, 'seen.txt'), 'x');
  await until(() => changes(p, made.channel).length > 0, 'the first change');

  // No dispose command in the protocol: `unsubscribe` is the only handle a
  // client needs, and it is what releases the watcher.
  client.handle({ method: 'unsubscribe', params: { channel: made.channel } });
  const had = changes(p, made.channel).length;
  writeFileSync(join(root, 'unseen.txt'), 'x');
  await new Promise((r) => { setTimeout(r, 300); });
  expect(changes(p, made.channel).length).toBe(had);
  // And the channel is gone with it.
  await expect(client.handle({ method: 'subscribe', params: { channel: made.channel } })).rejects.toThrow();

  // A watch created and never subscribed to is not one everybody has finished
  // with - it goes when its own client does.
  const second = host.accept(peer());
  await second.handle({ method: 'initialize', params: { clientId: 'b', protocolVersions: ['0.8.0'] } });
  const orphan = await second.handle({
    method: 'createResourceWatch', params: { channel: 'ahp-root://', uri: `file://${root}` },
  }) as { channel: string };
  second.close();
  const third = host.accept(peer());
  await third.handle({ method: 'initialize', params: { clientId: 'c', protocolVersions: ['0.8.0'] } });
  await expect(third.handle({ method: 'subscribe', params: { channel: orphan.channel } })).rejects.toThrow();
});

it('will not watch what it does not serve, or what is not there', async () => {
  const { client } = await connected();
  expect((await refused(client.handle({
    method: 'createResourceWatch', params: { channel: 'ahp-root://', uri: 'file:///etc' },
  }))).code).toBe(-32009);
  expect((await refused(client.handle({
    method: 'createResourceWatch', params: { channel: 'ahp-root://', uri: `file://${root}/nowhere` },
  }))).code).toBe(-32008);
});

it('says -32601 for a store that cannot watch, which is what a client degrades on', async () => {
  // VS Code's filesystem provider reads this as "no watching here" and falls
  // back to a no-op watch rather than failing - so it has to be the method
  // being absent, not a refusal about a path.
  const { client } = await connected({ list, read, resolve, complete });
  expect((await refused(client.handle({
    method: 'createResourceWatch', params: { channel: 'ahp-root://', uri: `file://${root}` },
  }))).code).toBe(-32601);
});
