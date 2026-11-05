import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Answer } from '../src/fetch.js';
import { fileProcessor } from '../src/files.js';
import type { ApFile, ApStreamingFile, FilesOptions } from '../src/files.js';

/*
 * The file one FILE value names, as the engine's `fileProcessor` makes it.
 *
 * An attachment is read from a folder this file makes for each case; a URL is
 * answered by a read the case hands in, so nothing is looked up and no request
 * is made, and the cases on the guarded fetch name a URL it refuses before a
 * socket opens. A value that names no file is `null`, which the engine's
 * validator then refuses for a required prop.
 */

/** The folders a case made, removed after it. */
const made: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
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

/** A read that answers every URL with one answer, and the URLs it was asked for. */
const answering = (status: number, headers: Record<string, string>, body: string): { asked: string[]; options: FilesOptions } => {
  const asked: string[] = [];
  const read = async (url: string): Promise<Answer> => {
    asked.push(url);
    return { status, headers, bytes: Buffer.from(body) };
  };
  return { asked, options: { fetch: read } };
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
    const pdf = answering(200, { 'content-disposition': 'attachment; filename="report.pdf"', 'content-type': 'application/pdf' }, 'pdf');
    expect(whole(await fileProcessor(FILE, 'https://example.com/download?id=1', undefined, pdf.options)).filename).toBe('report.pdf');

    const png = answering(200, { 'content-type': 'image/png' }, 'png');
    const named = whole(await fileProcessor(FILE, 'https://example.com/files/photo.jpeg', undefined, png.options));
    expect([named.filename, named.extension]).toEqual(['photo.jpeg', 'jpeg']);

    const csv = answering(200, { 'content-type': 'text/csv; charset=utf-8' }, 'a,b');
    expect(whole(await fileProcessor(FILE, 'https://example.com/export', undefined, csv.options)).filename).toBe('unknown.csv');
  });

  it('is no file when it answers no success', async () => {
    const gone = answering(404, {}, 'not here');
    expect(await fileProcessor(FILE, 'https://example.com/gone.txt', undefined, gone.options)).toBeNull();
    expect(gone.asked).toEqual(['https://example.com/gone.txt']);
  });

  it('is read through the guarded fetch: an http: URL and an address in the host\'s own network are no file, refused before a socket opens', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await fileProcessor(FILE, 'http://127.0.0.1:1/a.txt', undefined)).toBeNull();
    expect(await fileProcessor(FILE, 'https://127.0.0.1:1/a.txt', undefined)).toBeNull();
    expect(said.mock.calls.map(([error]) => (error instanceof Error ? error.message : String(error)))).toEqual([
      'only an https: URL is fetched, and http: is not',
      '127.0.0.1 answers on an address that this plugin does not fetch',
    ]);
  });
});

describe('an attachment', () => {
  it('is the file its name, or its absolute path inside the folder, names', async () => {
    const dir = withFiles({ 'notes.txt': 'hello', 'sub/deep.md': 'deep' });
    expect(whole(await fileProcessor(FILE, 'notes.txt', dir)).data.toString()).toBe('hello');
    expect(whole(await fileProcessor(FILE, join(dir, 'sub', 'deep.md'), dir)).filename).toBe('deep.md');
  });

  it('is no file outside the folder, through a link, or with no folder', async () => {
    const dir = withFiles({ 'notes.txt': 'hello' });
    const outside = withFiles({ 'secret.txt': 'secret' });
    symlinkSync(join(outside, 'secret.txt'), join(dir, 'link.txt'));
    expect(await fileProcessor(FILE, `../${basename(outside)}/secret.txt`, dir)).toBeNull();
    expect(await fileProcessor(FILE, join(outside, 'secret.txt'), dir)).toBeNull();
    expect(await fileProcessor(FILE, 'link.txt', dir)).toBeNull();
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
    (fromName as ApStreamingFile).body.destroy();
    const fromData = await fileProcessor(streaming, `data:text/plain;base64,${Buffer.from('hi').toString('base64')}`, undefined) as ApStreamingFile;
    expect([fromData.filename, fromData.size]).toEqual(['unknown.txt', 2]);
    expect(Buffer.concat(await fromData.body.toArray() as Buffer[]).toString()).toBe('hi');
    // A URL's answer is read whole by the guarded fetch, so its size is known.
    const read = answering(200, { 'content-type': 'text/plain' }, 'from-url');
    const fromUrl = await fileProcessor(streaming, 'https://example.com/big.txt', undefined, read.options) as ApStreamingFile;
    expect([fromUrl.filename, fromUrl.extension, fromUrl.size]).toEqual(['big.txt', 'txt', 8]);
    expect(Buffer.concat(await fromUrl.body.toArray() as Buffer[]).toString()).toBe('from-url');
  });
});

describe('a value that is no string', () => {
  it('is no file', async () => {
    expect(await fileProcessor(FILE, 42, undefined)).toBeNull();
    expect(await fileProcessor(FILE, undefined, undefined)).toBeNull();
  });
});
