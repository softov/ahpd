import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileProcessor } from '../src/files.js';
import type { ApFile, ApStreamingFile } from '../src/files.js';
import { fileLinks } from '../../../tools/links.ts';

/*
 * The file one FILE value names, as the engine's `fileProcessor` makes it.
 *
 * An attachment is read from a folder this file makes for each case; a URL is
 * answered by a `fetch` the case stands in for, so nothing is looked up and no
 * request is made. A value that names no file is `null`, which the engine's
 * validator then refuses for a required prop.
 */

/** The folders a case made, removed after it. */
const made: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const one of made.splice(0)) rmSync(one, { recursive: true, force: true });
});

/** One folder with the named files written into it. */
function withFiles(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-files-'));
  made.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

/** A FILE prop, streaming where a case says. */
const FILE = { type: 'FILE', required: true };

/** A `fetch` that answers every URL with one response, and the URLs it was asked for. */
const answering = (status: number, headers: Record<string, string>, body: string) => {
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url);
    return new Response(body, { status, headers });
  });
  return asked;
};

/** A processed value that is an `ApFile`, which a case reads. */
const whole = (value: ApFile | ApStreamingFile | null): ApFile => {
  if (value === null || !('data' in value)) throw new Error('the value is no whole file');
  return value;
};

describe('a base64 data: URI', () => {
  it('is unknown.<ext> by the engine\'s media type table, and bin for a type it lacks', async () => {
    const png = whole(await fileProcessor(FILE, `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`, undefined));
    expect([png.filename, png.extension, png.data.toString()]).toEqual(['unknown.png', 'png', 'png-bytes']);
    const odd = whole(await fileProcessor(FILE, `data:application/x-odd;base64,${Buffer.from('odd').toString('base64')}`, undefined));
    expect([odd.filename, odd.extension]).toEqual(['unknown.bin', 'bin']);
  });
});

describe('a URL', () => {
  it('is named by its Content-Disposition, else its path\'s last segment with a dot, else unknown.<ext>', async () => {
    answering(200, { 'content-disposition': 'attachment; filename="report.pdf"', 'content-type': 'application/pdf' }, 'pdf');
    expect(whole(await fileProcessor(FILE, 'https://example.com/download?id=1', undefined)).filename).toBe('report.pdf');

    answering(200, { 'content-type': 'image/png' }, 'png');
    const named = whole(await fileProcessor(FILE, 'https://example.com/files/photo.jpeg', undefined));
    expect([named.filename, named.extension]).toEqual(['photo.jpeg', 'jpeg']);

    answering(200, { 'content-type': 'text/csv; charset=utf-8' }, 'a,b');
    expect(whole(await fileProcessor(FILE, 'https://example.com/export', undefined)).filename).toBe('unknown.csv');
  });

  it('is no file when it answers no success, and fetches http: as the engine does', async () => {
    const asked = answering(404, {}, 'not here');
    expect(await fileProcessor(FILE, 'http://example.com/gone.txt', undefined)).toBeNull();
    expect(asked).toEqual(['http://example.com/gone.txt']);
  });
});

describe('an attachment', () => {
  it('is the file its name, or its absolute path inside the folder, names', async () => {
    const dir = withFiles({ 'notes.txt': 'hello', 'sub/deep.md': 'deep' });
    expect(whole(await fileProcessor(FILE, 'notes.txt', dir)).data.toString()).toBe('hello');
    expect(whole(await fileProcessor(FILE, join(dir, 'sub', 'deep.md'), dir)).filename).toBe('deep.md');
  });

  // A link to a file, which a Windows machine makes only with Developer Mode or as an administrator.
  it.skipIf(!fileLinks)('is no file outside the folder through a link', async () => {
    const dir = withFiles({ 'notes.txt': 'hello' });
    const outside = withFiles({ 'secret.txt': 'secret' });
    symlinkSync(join(outside, 'secret.txt'), join(dir, 'link.txt'));
    expect(await fileProcessor(FILE, 'link.txt', dir)).toBeNull();
  });

  it('is no file outside the folder, or with no folder', async () => {
    const dir = withFiles({ 'notes.txt': 'hello' });
    const outside = withFiles({ 'secret.txt': 'secret' });
    expect(await fileProcessor(FILE, `../${basename(outside)}/secret.txt`, dir)).toBeNull();
    expect(await fileProcessor(FILE, join(outside, 'secret.txt'), dir)).toBeNull();
    expect(await fileProcessor(FILE, 'notes.txt', undefined)).toBeNull();
    expect(await fileProcessor(FILE, 'missing.txt', dir)).toBeNull();
  });
});

describe('a prop the piece declares streaming', () => {
  it('is given a body to read, its size where it is known', async () => {
    const dir = withFiles({ 'big.txt': 'streamed' });
    const streaming = { ...FILE, streaming: true };
    const fromName = await fileProcessor(streaming, 'big.txt', dir);
    expect(fromName).not.toBeNull();
    expect(fromName).toMatchObject({ filename: 'big.txt', extension: 'txt', size: 8 });
    expect((fromName as ApStreamingFile).body).toBeInstanceOf(Readable);
    // Closed before the case ends, as a stream destroyed before it opened still opens its file, after the folder is gone.
    const body = (fromName as ApStreamingFile).body;
    const closed = new Promise((resolve) => { body.once('close', resolve); });
    body.destroy();
    await closed;
    const fromData = await fileProcessor(streaming, `data:text/plain;base64,${Buffer.from('hi').toString('base64')}`, undefined) as ApStreamingFile;
    expect([fromData.filename, fromData.size]).toEqual(['unknown.txt', 2]);
    expect(Buffer.concat(await fromData.body.toArray() as Buffer[]).toString()).toBe('hi');
  });
});

describe('a value that is no string', () => {
  it('is no file', async () => {
    expect(await fileProcessor(FILE, 42, undefined)).toBeNull();
    expect(await fileProcessor(FILE, undefined, undefined)).toBeNull();
  });
});
