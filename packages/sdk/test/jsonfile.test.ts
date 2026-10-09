import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readJson, readJsonObject, writeJsonAtomic } from '../src/jsonfile.js';

/*
 * The one reader and the one writer for a JSON file.
 *
 * Every store in this host reads and writes a file whole, and each of them had
 * its own copy of both. What matters here is the vocabulary a caller is handed:
 * the four outcomes a read can answer, so a caller can word them its own way,
 * and a write that is atomic, owner-only and named the way the daemon's temp
 * sweeper reads.
 */

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ahpd-jsonfile-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const at = (name: string): string => join(dir, name);

describe('readJson', () => {
  it('answers the value of a file that holds JSON', () => {
    writeFileSync(at('a.json'), '{"version":1,"secrets":{}}\n');

    expect(readJson(at('a.json'))).toEqual({ ok: true, value: { version: 1, secrets: {} } });
    // Anything JSON holds, not only an object: the caller that wants an object
    // is the one that says so.
    writeFileSync(at('b.json'), '[1,2,3]');
    expect(readJson(at('b.json'))).toEqual({ ok: true, value: [1, 2, 3] });
  });

  it('answers `missing` for a file that is not there, which is where a host starts', () => {
    expect(readJson(at('nothing.json'))).toMatchObject({ ok: false, kind: 'missing' });
  });

  it('answers `unreadable` with the errno code for a file that cannot be opened', () => {
    // A directory where a file was expected: the system call refuses with a
    // message about the path, and the code is the part of it worth repeating.
    mkdirSync(at('a-directory'));
    const outcome = readJson(at('a-directory'));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? undefined : outcome.kind).toBe('unreadable');
    expect(outcome.ok ? undefined : (outcome as { code?: string }).code).toBe('EISDIR');
  });

  it('answers `not-json` with the parser\'s error for a file that is not JSON', () => {
    writeFileSync(at('a.json'), 'nope\n');
    const outcome = readJson(at('a.json'));

    // The error is carried rather than worded here: the parser quotes the
    // source it choked on, and one caller's source is a secret.
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? undefined : outcome.kind).toBe('not-json');
    expect(outcome.ok ? undefined : (outcome as { error?: unknown }).error).toBeInstanceOf(SyntaxError);
  });

  it('answers `not-json` for an empty file, because checking for that is the caller\'s', () => {
    writeFileSync(at('a.json'), '');
    const outcome = readJson(at('a.json'));
    expect(outcome.ok ? undefined : outcome.kind).toBe('not-json');
  });
});

describe('readJsonObject', () => {
  it('answers the value of a file that holds an object', () => {
    writeFileSync(at('a.json'), '{"plugins":[]}\n');
    expect(readJsonObject(at('a.json'))).toEqual({ ok: true, value: { plugins: [] } });
  });

  it('refuses a list, a `null` and a leaf rather than handing one to a caller', () => {
    for (const held of ['[]', 'null', '42', '"x"', 'true']) {
      writeFileSync(at('a.json'), held);
      expect(readJsonObject(at('a.json'))).toEqual({ ok: false, kind: 'not-object' });
    }
  });

  it('says the same three failures readJson does', () => {
    expect(readJsonObject(at('nothing.json'))).toMatchObject({ ok: false, kind: 'missing' });
    mkdirSync(at('a-directory'));
    expect(readJsonObject(at('a-directory'))).toMatchObject({ ok: false, kind: 'unreadable', code: 'EISDIR' });
    writeFileSync(at('a.json'), 'nope\n');
    expect(readJsonObject(at('a.json'))).toMatchObject({ ok: false, kind: 'not-json' });
  });
});

describe('writeJsonAtomic', () => {
  it('writes two-space JSON with a trailing newline, and leaves no scratch behind', () => {
    writeJsonAtomic(at('a.json'), { version: 1, plugins: ['one'] });

    expect(readFileSync(at('a.json'), 'utf8')).toBe('{\n  "version": 1,\n  "plugins": [\n    "one"\n  ]\n}\n');
    expect(existsSync(`${at('a.json')}.${String(process.pid)}.tmp`)).toBe(false);
  });

  it('makes the file owner-only, because what is written this way names who may use what', () => {
    writeJsonAtomic(at('a.json'), { secrets: {} });
    expect(statSync(at('a.json')).mode & 0o777).toBe(0o600);
  });

  it('is owner-only even when a readable temp at its own name was left behind', () => {
    // What a process that had this pid before left world-readable. `mode` is
    // applied when a file is created and not when one is opened, so a write
    // that opened this temp would keep its 0644 - and the rename puts that on
    // the real file.
    const temporary = `${at('a.json')}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, '{}');
    chmodSync(temporary, 0o644);

    writeJsonAtomic(at('a.json'), { secrets: {} });
    expect(statSync(at('a.json')).mode & 0o777).toBe(0o600);
  });

  it('creates the file at the mode a caller names instead', () => {
    writeJsonAtomic(at('a.json'), { any: 'body' }, { mode: 0o644 });
    expect(statSync(at('a.json')).mode & 0o777).toBe(0o644);
  });

  it('makes the folder first, always, and at the mode a caller names for it', () => {
    const nested = join(dir, 'one', 'two', 'a.json');
    writeJsonAtomic(nested, {});
    expect(readFileSync(nested, 'utf8')).toBe('{}\n');

    const private_ = join(dir, 'three', 'a.json');
    writeJsonAtomic(private_, {}, { dirMode: 0o700 });
    expect(statSync(join(dir, 'three')).mode & 0o777).toBe(0o700);
  });

  it('writes beside the file under this process\'s pid, and throws when that name is taken', () => {
    // A directory where the scratch goes, which is the one thing a write cannot
    // move into place. Nothing else could collide with it, so this is also what
    // says the name is the `<file>.<pid>.tmp` the daemon's sweeper reads.
    mkdirSync(`${at('a.json')}.${String(process.pid)}.tmp`);

    expect(() => { writeJsonAtomic(at('a.json'), {}); }).toThrow(/EISDIR/u);
    expect(existsSync(at('a.json'))).toBe(false);
  });

  it('leaves the last good file where a write throws', () => {
    writeJsonAtomic(at('a.json'), { good: true });
    mkdirSync(`${at('a.json')}.${String(process.pid)}.tmp`);

    expect(() => { writeJsonAtomic(at('a.json'), { good: false }); }).toThrow();
    expect(JSON.parse(readFileSync(at('a.json'), 'utf8'))).toEqual({ good: true });
  });
});
