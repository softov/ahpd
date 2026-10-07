/*
 * What a message's attachments become, for every backend.
 *
 * One helper decides it, so every backend sends the same thing for the same
 * message: the text first, a small image as an image, a small host-written text
 * as itself, and everything else by path in one reference block - decisions
 * `a-pasted-image-goes-as-an-image-when-it-fits` and
 * `pasted-text-is-inlined-up-to-64-kib`.
 *
 * The files here are written the way the host writes them: read-only, under a
 * name of its own, with the snapshot tag on the attachment. A file without the
 * tag is somebody's own file in the workspace, and the difference is the whole
 * of why a pasted snippet is inlined and a file being edited is not.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { partsOf, SNAPSHOT_TAG } from '../src/attachments.js';
import type { Bag } from '../src/types/common.js';
import type { MessageAttachment } from '../src/types/session.js';
import type { Part } from '../src/attachments.js';

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-parts-'));
  made.push(dir);
  return dir;
};

/** A file written the way the host writes an attachment. */
const given = (dir: string, name: string, bytes: Buffer | string, type: string): string => {
  const path = join(dir, name);
  writeFileSync(path, bytes, { mode: 0o400 });
  return path;
};

/** The attachment for a file this host wrote, as the rewrite leaves it. */
const snapshot = (path: string, type: string, label = path.split('/').pop() as string): MessageAttachment => ({
  type: 'resource',
  label,
  uri: `file://${path}`,
  sizeHint: 0,
  contentType: type,
  _meta: { [SNAPSHOT_TAG]: { isSnapshot: true, contentType: type } },
} as MessageAttachment);

/** The attachment for a file somebody works in, which the host left alone. */
const theirs = (path: string, type: string, label = path.split('/').pop() as string): MessageAttachment => ({
  type: 'resource',
  label,
  uri: `file://${path}`,
  contentType: type,
} as MessageAttachment);

/** Everything said in text, which is the message and whatever was inlined. */
const text = (parts: Part[]): string => parts
  .filter((one): one is { type: 'text'; text: string } => one.type === 'text' && one.text !== '')
  .map((one) => one.text)
  .join('\n\n');

it('sends the text alone when nothing is attached', async () => {
  expect(await partsOf('what is this', undefined, { images: true })).toEqual([{ type: 'text', text: 'what is this' }]);
  expect(await partsOf('what is this', [], { images: true })).toEqual([{ type: 'text', text: 'what is this' }]);
});

it('sends a pasted screenshot as an image, and the text before it', async () => {
  const dir = temp();
  const path = given(dir, 'ab12cd34-shot.png', png(), 'image/png');
  const parts = await partsOf('look at this', [snapshot(path, 'image/png')], { images: true });

  expect(parts).toHaveLength(2);
  expect(parts[0]).toEqual({ type: 'text', text: 'look at this' });
  expect(parts[1]).toEqual({
    type: 'image',
    mimeType: 'image/png',
    data: png().toString('base64'),
    source: { label: 'ab12cd34-shot.png', uri: `file://${path}` },
  });
});

it('says which attachment each part came from', async () => {
  const dir = temp();
  const path = given(dir, 'ab12cd34-shot.png', png(), 'image/png');
  const parts = await partsOf('look', [
    snapshot(path, 'image/png', 'shot.png'),
    { type: 'simple', label: 'terminal', modelRepresentation: 'Terminal output:\n$ ls' } as MessageAttachment,
    {
      type: 'embeddedResource',
      label: 'pasted.png',
      contentType: 'image/png',
      data: png().toString('base64'),
    } as MessageAttachment,
  ], { images: true });

  // The message's own text came from no attachment, so it names none.
  expect(parts[0]).toEqual({ type: 'text', text: 'look' });
  // A file the host wrote: the label a person gave it, and where it is.
  expect(parts[1]).toEqual({
    type: 'image',
    mimeType: 'image/png',
    data: png().toString('base64'),
    source: { label: 'shot.png', uri: `file://${path}` },
  });
  // An attachment that names no file has a label and no URI.
  expect(parts[2]).toEqual({ type: 'text', text: 'Terminal output:\n$ ls', source: { label: 'terminal' } });
  expect(parts[3]).toEqual({
    type: 'image',
    mimeType: 'image/png',
    data: png().toString('base64'),
    source: { label: 'pasted.png' },
  });
});

it('sends an image of each kind the provider takes', async () => {
  const dir = temp();
  const each: [string, string][] = [
    ['a.jpg', 'image/jpeg'],
    ['b.gif', 'image/gif'],
    ['c.webp', 'image/webp'],
  ];
  for (const [name, type] of each) {
    const path = given(dir, name, png(), type);
    const parts = await partsOf('', [snapshot(path, type)], { images: true });
    expect(parts[1]?.type, type).toBe('image');
  }
});

it('names an image the model does not take, and one too large to send', async () => {
  const dir = temp();
  const vector = given(dir, 'logo.svg', '<svg/>', 'image/svg+xml');
  const huge = given(dir, 'huge.png', Buffer.alloc(6 * 1024 * 1024, 7), 'image/png');

  // A vector is a picture the four image types do not cover, and being XML
  // does not make it text to inline: it is named like any other file.
  const svg = await partsOf('here', [snapshot(vector, 'image/svg+xml')], { images: true });
  expect(svg).toHaveLength(2);
  expect(text(svg)).toBe(`here\n\nThe user provided the following references:\n- ${vector} ${READ_ONLY}`);

  // And six megabytes is more than a provider will take.
  const big = await partsOf('here', [snapshot(huge, 'image/png')], { images: true });
  expect(big[1]?.type).toBe('text');
  expect(text(big)).toContain(`- ${huge} ${READ_ONLY}`);
});

it('names a screenshot where the model takes no image at all', async () => {
  const dir = temp();
  const path = given(dir, 'ab12cd34-shot.png', png(), 'image/png');
  const parts = await partsOf('look', [snapshot(path, 'image/png')], { images: false });
  expect(parts).toHaveLength(2);
  expect(text(parts)).toContain(`- ${path} ${READ_ONLY}`);
});

it('inlines pasted text, labelled with the lines it covers', async () => {
  const dir = temp();
  const path = given(dir, 'ab12cd34-notes.txt', 'first\nsecond\n', 'text/plain');
  const parts = await partsOf('read this', [snapshot(path, 'text/plain', 'notes.txt')], { images: true });

  expect(parts).toHaveLength(2);
  // The text a backend sends is the labelled, fenced copy, and the source
  // carries the file's own text beside it - the words without the fence, and
  // with the newline the file ends in, for a block that is the file itself.
  expect(parts[1]).toEqual({
    type: 'text',
    text: 'notes.txt (lines 1-2):\n```\nfirst\nsecond\n```',
    source: { label: 'notes.txt', uri: `file://${path}`, text: 'first\nsecond\n' },
  });
});

it('names text too long to inline, and text in a file somebody is editing', async () => {
  const dir = temp();
  const log = given(dir, 'long.log', Buffer.alloc(65 * 1024, 97), 'text/plain');
  const mine = given(dir, 'src.ts', 'const a = 1;\n', 'application/typescript');

  const tooLong = await partsOf('', [snapshot(log, 'text/plain', 'long.log')], { images: true });
  expect(text(tooLong)).toBe(`The user provided the following references:\n- ${log} ${READ_ONLY}`);

  /*
   * A file in the workspace is named rather than inlined, tag or no tag: a
   * copy of it in the prompt is a copy the model may edit in its head while
   * the file on disk stays as it was.
   */
  const inWorkspace = await partsOf('', [theirs(mine, 'application/typescript', 'src.ts')], { images: true });
  expect(text(inWorkspace)).toBe(`The user provided the following references:\n- ${mine}`);
});

it('names a directory, a pipe and a file that is not there', async () => {
  const dir = temp();
  const folder = join(dir, 'a-folder');
  mkdirSync(folder);
  const pipe = join(dir, 'a-pipe');
  execFileSync('mkfifo', [pipe]);
  chmodSync(pipe, 0o400);

  const parts = await partsOf('these', [
    { type: 'resource', label: 'a-folder', uri: `file://${folder}` } as MessageAttachment,
    { type: 'resource', label: 'a-pipe', uri: `file://${pipe}` } as MessageAttachment,
    { type: 'resource', label: 'gone.txt', uri: `file://${join(dir, 'gone.txt')}` } as MessageAttachment,
  ], { images: true });

  // Read, a pipe is forever and a folder is nothing, so neither is opened.
  expect(parts).toHaveLength(2);
  expect(text(parts)).toContain(`- ${folder}`);
  expect(text(parts)).toContain(`- ${pipe}`);
  expect(text(parts)).toContain(`- ${join(dir, 'gone.txt')}`);
});

it('names the line a selection starts at', async () => {
  const dir = temp();
  const path = given(dir, 'app.ts', 'a\nb\nc\nd\n', 'application/typescript');
  const parts = await partsOf('this bit', [{
    ...theirs(path, 'application/typescript', 'app.ts'),
    selection: { range: { start: { line: 2, character: 0 }, end: { line: 3, character: 0 } } },
  } as MessageAttachment], { images: true });

  expect(text(parts)).toBe(`this bit\n\nThe user provided the following references:\n- ${path}:3`);
});

it('sends what a producer wrote for a simple attachment', async () => {
  const one = { type: 'simple', label: 'terminal', modelRepresentation: 'Terminal output:\n$ ls' } as MessageAttachment;
  const parts = await partsOf('see', [one], { images: true });
  expect(parts).toHaveLength(2);
  expect(parts[1]).toEqual({ type: 'text', text: 'Terminal output:\n$ ls', source: { label: 'terminal' } });
  // Nothing read a file for this part, so it carries no file text.
  expect((parts[1] as Bag).source).not.toHaveProperty('text');
});

it('names an annotations attachment and a chat by their label', async () => {
  const parts = await partsOf('see', [
    { type: 'annotations', label: 'my marks', resource: 'ahp-session:/one/annotations' } as MessageAttachment,
    { type: 'chat', label: 'the other conversation', resource: 'ahp-chat:/two' } as MessageAttachment,
  ], { images: true });

  expect(text(parts)).toBe('see\n\nThe user provided the following references:\n- my marks\n- the other conversation');
});

it('holds an attachment that was never written to the same limits', async () => {
  const parts = await partsOf('look', [
    {
      type: 'embeddedResource',
      label: 'pasted.png',
      contentType: 'image/png',
      data: png().toString('base64'),
    } as MessageAttachment,
    {
      type: 'embeddedResource',
      label: 'notes.txt',
      contentType: 'text/plain',
      data: Buffer.from('hello\n').toString('base64'),
    } as MessageAttachment,
  ], { images: true });

  expect(parts[1]).toEqual({
    type: 'image',
    mimeType: 'image/png',
    data: png().toString('base64'),
    source: { label: 'pasted.png' },
  });
  expect((parts[2] as Bag).text).toBe('notes.txt (lines 1-1):\n```\nhello\n```');
  // These bytes never reached a file, so there is no file text to carry.
  expect((parts[2] as Bag).source).not.toHaveProperty('text');
});

/*
 * A file whose type only its own name says: nothing described it, and the
 * extension is what is left to go on.
 */
it('reads a file name as the type where nothing else says', async () => {
  const dir = temp();
  const path = given(dir, 'shot.png', png(), 'application/octet-stream');
  const parts = await partsOf('', [{
    type: 'resource',
    label: 'shot.png',
    uri: `file://${path}`,
  } as MessageAttachment], { images: true });
  expect(parts[1]).toEqual({
    type: 'image',
    mimeType: 'image/png',
    data: png().toString('base64'),
    source: { label: 'shot.png', uri: `file://${path}` },
  });
});

/** The note a snapshot's reference line carries. */
const READ_ONLY = '(read-only snapshot, do not edit this file)';

/** A PNG's first bytes. Nothing here decodes it, so a header is a picture. */
function png(): Buffer {
  return Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
}
