import { mkdtempSync, rmSync, symlinkSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { fileResources } from '../packages/sdk/src/resources.js';
import { echo } from '../examples/echo/agent.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * The write half, against a real directory.
 *
 * Not a mock: what is under test is what happens to bytes on a disk, and the
 * three write modes differ only in which bytes survive. A fake filesystem
 * would be a second implementation of exactly the thing being checked.
 */

let root: string;
let outside: string;

const peer = (): Peer => ({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });

/** A connected client, granted write on the served root unless told otherwise. */
async function client(grant = true) {
  const host = createHost({ path: root, agents: [echo({ path: root, pace: 0 })], resources: fileResources() });
  const held = host.accept(peer());
  await held.handle({
    method: 'initialize',
    params: { clientId: 'w', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  });
  if (grant) {
    await held.handle({
      method: 'resourceRequest', params: { channel: 'ahp-root://', uri: `file://${root}`, write: true },
    });
  }
  return held;
}

const put = (held: Awaited<ReturnType<typeof client>>, name: string, params: Record<string, unknown>) =>
  held.handle({ method: 'resourceWrite', params: { channel: 'ahp-root://', uri: `file://${root}/${name}`, encoding: 'utf-8', ...params } });

const text = (name: string): string => readFileSync(join(root, name), 'utf8');

const refused = async (run: Promise<unknown>): Promise<{ code: number; message: string; data?: unknown }> => {
  try {
    await run;
    throw new Error('That was supposed to be refused.');
  }
  catch (error) {
    const held = error as { code?: number; message: string; data?: unknown };
    expect(typeof held.code, held.message).toBe('number');
    return { code: held.code as number, message: held.message, data: held.data };
  }
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-w-'));
  outside = mkdtempSync(join(tmpdir(), 'ahpd-out-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

it('creates a file, and overwrites one whole', async () => {
  const held = await client();
  expect(await put(held, 'a.txt', { data: 'one\n' })).toEqual({});
  expect(text('a.txt')).toBe('one\n');
  // `truncate` with no position is the ordinary save: everything that was
  // there is gone, not merged.
  await put(held, 'a.txt', { data: 'two\n' });
  expect(text('a.txt')).toBe('two\n');
});

it('reads position from the start for truncate and insert, and from the end for append', async () => {
  const held = await client();
  // The one that is easy to get subtly wrong, and the reason all three are
  // checked against the same starting bytes.
  writeFileSync(join(root, 'm.txt'), 'ABCDEFGH');
  await put(held, 'm.txt', { data: 'xy', mode: 'truncate', position: 3 });
  expect(text('m.txt')).toBe('ABCxy');

  writeFileSync(join(root, 'm.txt'), 'ABCDEFGH');
  await put(held, 'm.txt', { data: 'xy', mode: 'insert', position: 3 });
  expect(text('m.txt')).toBe('ABCxyDEFGH');

  writeFileSync(join(root, 'm.txt'), 'ABCDEFGH');
  // Zero is POSIX append.
  await put(held, 'm.txt', { data: 'xy', mode: 'append', position: 0 });
  expect(text('m.txt')).toBe('ABCDEFGHxy');

  writeFileSync(join(root, 'm.txt'), 'ABCDEFGH');
  // And a position counts *backwards* from EOF, which is what makes this
  // different from `insert` with the same number.
  await put(held, 'm.txt', { data: 'xy', mode: 'append', position: 3 });
  expect(text('m.txt')).toBe('ABCDExyFGH');
});

it('carries bytes that are not text', async () => {
  const held = await client();
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  await put(held, 'b.bin', { data: bytes.toString('base64'), encoding: 'base64' });
  expect(readFileSync(join(root, 'b.bin')).equals(bytes)).toBe(true);
});

it('refuses to create over something, when asked to', async () => {
  const held = await client();
  writeFileSync(join(root, 'there.txt'), 'x');
  const denied = await refused(put(held, 'there.txt', { data: 'y', createOnly: true }));
  expect(denied.code).toBe(-32010);
  expect(text('there.txt')).toBe('x');
  // And without the flag it is an ordinary overwrite.
  await put(held, 'there.txt', { data: 'y' });
  expect(text('there.txt')).toBe('y');
});

it('refuses a write against an etag that has moved on', async () => {
  const held = await client();
  writeFileSync(join(root, 'e.txt'), 'first');
  const found = await held.handle({
    method: 'resourceResolve', params: { channel: 'ahp-root://', uri: `file://${root}/e.txt` },
  }) as { etag: string };
  expect(found.etag).toBeDefined();

  // Matching: the write goes through.
  await put(held, 'e.txt', { data: 'second', ifMatch: found.etag });
  expect(text('e.txt')).toBe('second');

  // The etag the client is still holding is now stale, which is exactly the
  // lost update `ifMatch` exists to stop.
  const stale = await refused(put(held, 'e.txt', { data: 'third', ifMatch: found.etag }));
  expect(stale.code).toBe(-32011);
  expect(text('e.txt')).toBe('second');
});

it('will not be written through a symlink pointing out of the served set', async () => {
  const held = await client();
  // The hole a textual path check leaves: the target does not exist, so
  // resolving *it* answers nothing and the written text looks fine. The
  // parent is what has to be resolved.
  symlinkSync(outside, join(root, 'link'));
  const denied = await refused(put(held, 'link/escaped.txt', { data: 'no' }));
  expect(denied.code).toBe(-32009);
  expect(existsSync(join(outside, 'escaped.txt'))).toBe(false);
});

it('says which directory is missing rather than which file', async () => {
  const held = await client();
  const gone = await refused(put(held, 'nowhere/deep/a.txt', { data: 'x' }));
  expect(gone.code).toBe(-32008);
});

it('removes a file, and will not remove a directory unless told twice', async () => {
  const held = await client();
  writeFileSync(join(root, 'gone.txt'), 'x');
  mkdirSync(join(root, 'tree/inner'), { recursive: true });
  writeFileSync(join(root, 'tree/inner/deep.txt'), 'x');

  await held.handle({ method: 'resourceDelete', params: { channel: 'ahp-root://', uri: `file://${root}/gone.txt` } });
  expect(existsSync(join(root, 'gone.txt'))).toBe(false);

  // A directory without the flag is refused rather than emptied: the protocol
  // has `recursive` so that deleting a tree is something somebody asked for.
  const kept = await refused(held.handle({
    method: 'resourceDelete', params: { channel: 'ahp-root://', uri: `file://${root}/tree` },
  }));
  expect(kept.code).toBe(-32009);
  expect(existsSync(join(root, 'tree/inner/deep.txt'))).toBe(true);

  await held.handle({
    method: 'resourceDelete', params: { channel: 'ahp-root://', uri: `file://${root}/tree`, recursive: true },
  });
  expect(existsSync(join(root, 'tree'))).toBe(false);
});

it('makes a directory and the parents it needs', async () => {
  const held = await client();
  await held.handle({ method: 'resourceMkdir', params: { channel: 'ahp-root://', uri: `file://${root}/a/b/c` } });
  expect(existsSync(join(root, 'a/b/c'))).toBe(true);
  // Idempotent, as `mkdir -p` is. A file in the way is the other answer.
  await held.handle({ method: 'resourceMkdir', params: { channel: 'ahp-root://', uri: `file://${root}/a/b/c` } });
  writeFileSync(join(root, 'a/file'), 'x');
  expect((await refused(held.handle({
    method: 'resourceMkdir', params: { channel: 'ahp-root://', uri: `file://${root}/a/file` },
  }))).code).toBe(-32010);
});

it('moves and copies, and refuses a destination outside the served set', async () => {
  const held = await client();
  writeFileSync(join(root, 'from.txt'), 'carried');

  await held.handle({
    method: 'resourceCopy',
    params: { channel: 'ahp-root://', source: `file://${root}/from.txt`, destination: `file://${root}/copy.txt` },
  });
  expect(text('copy.txt')).toBe('carried');
  expect(existsSync(join(root, 'from.txt'))).toBe(true);

  await held.handle({
    method: 'resourceMove',
    params: { channel: 'ahp-root://', source: `file://${root}/from.txt`, destination: `file://${root}/moved.txt` },
  });
  expect(text('moved.txt')).toBe('carried');
  expect(existsSync(join(root, 'from.txt'))).toBe(false);

  // Out of the served set is the interesting refusal: it would carry a file
  // somewhere this host can no longer see, which is a deletion nobody asked
  // for.
  const away = await refused(held.handle({
    method: 'resourceMove',
    params: { channel: 'ahp-root://', source: `file://${root}/moved.txt`, destination: `file://${outside}/taken.txt` },
  }));
  expect(away.code).toBe(-32009);
  expect(existsSync(join(root, 'moved.txt'))).toBe(true);

  const over = await refused(held.handle({
    method: 'resourceCopy',
    params: {
      channel: 'ahp-root://',
      source: `file://${root}/moved.txt`,
      destination: `file://${root}/copy.txt`,
      failIfExists: true,
    },
  }));
  expect(over.code).toBe(-32010);
});

it('needs a grant, and one on a directory covers what is under it', async () => {
  const held = await client(false);
  const denied = await refused(put(held, 'deep/a.txt', { data: 'x' }));
  expect(denied.code).toBe(-32009);

  // One request, not one per file. An editor saves the file it has open, and
  // a round trip per save would make the negotiation the slow part.
  await held.handle({
    method: 'resourceRequest', params: { channel: 'ahp-root://', uri: `file://${root}`, write: true },
  });
  await held.handle({ method: 'resourceMkdir', params: { channel: 'ahp-root://', uri: `file://${root}/deep` } });
  await put(held, 'deep/a.txt', { data: 'x' });
  expect(text('deep/a.txt')).toBe('x');
});

it('does not let a grant on one directory reach a sibling whose name starts the same', async () => {
  const held = await client(false);
  mkdirSync(join(root, 'brb'));
  mkdirSync(join(root, 'brb_framework'));
  await held.handle({
    method: 'resourceRequest', params: { channel: 'ahp-root://', uri: `file://${root}/brb`, write: true },
  });
  await put(held, 'brb/ok.txt', { data: 'x' });
  // Prefix on a separator, never on the string.
  expect((await refused(put(held, 'brb_framework/no.txt', { data: 'x' }))).code).toBe(-32009);
});
