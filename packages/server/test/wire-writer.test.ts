/**
 * What a capture does when it outgrows the room it was given.
 *
 * Both caps are VS Code's, and a test that waited for 75 MiB would be a test
 * nobody runs, so the writer takes them as options and the cases below lower
 * them to a few bytes. What is under test is the arithmetic, not the numbers:
 * that a file over its cap is rolled and an oversized line is cut, and that
 * neither of them loses the shape a reader of the capture depends on.
 */

import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { filesOf, lineFor, writerFor } from '../src/wire.js';
import type { Capture } from '../src/wire.js';

let home: string;
let at: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-wire-writer-'));
  at = join(home, 'wire.jsonl');
});

afterEach(() => { rmSync(home, { recursive: true, force: true }); });

/** A capture file, and every one it has rolled into. */
const files = (): string[] => readdirSync(home).sort();

/** One line of a capture, read back as it was written. */
const lines = (of: string): Record<string, unknown>[] =>
  readFileSync(of, 'utf8').split('\n').filter((one) => one.trim() !== '').map((one) => JSON.parse(one) as Record<string, unknown>);

const said = (text: string, peer = 1): Capture => lineFor('client', text, peer, 'websocket');

describe('a capture that outgrows its file', () => {
  it('rolls past the cap, and keeps five files however many rolls go by', () => {
    // Two of these lines fit in 400 bytes and a third does not, so a roll
    // happens every other frame and thirty frames are fifteen rolls. The
    // arithmetic is the thing under test; the cap is only here because a test
    // that waited for 75 MiB would be a test nobody runs.
    const write = writerFor(at, { maxFileSizeBytes: 400 });
    for (let frame = 0; frame < 30; frame++) write(said(JSON.stringify({ jsonrpc: '2.0', id: frame, method: 'ping' })));

    // Five files, never six: the live one and four rolls, and the fifth roll
    // drops the oldest rather than opening a `.5`. A capture that grows past
    // the count is the thing the count is for.
    expect(files()).toEqual(['wire.jsonl', 'wire.jsonl.1', 'wire.jsonl.2', 'wire.jsonl.3', 'wire.jsonl.4']);
    // Every one of them is a whole number of lines, and the newest is the one
    // being written - the last frame, not the first.
    for (const one of files()) expect(lines(join(home, one)).length).toBeGreaterThan(0);
    expect(lines(at).at(-1)?.id).toBe(29);
  }, 20000);

  it('is written whole, so the rolled files read oldest first', () => {
    const write = writerFor(at, { maxFileSizeBytes: 400 });
    for (let frame = 0; frame < 8; frame++) write(said(JSON.stringify({ jsonrpc: '2.0', id: frame, method: 'ping' })));

    // What a client collecting `diagnostics.logs` gets, in the order it has to
    // read them: the oldest roll first and the live file last, with nothing
    // named that was never written.
    expect(filesOf(at)).toEqual([`${at}.3`, `${at}.2`, `${at}.1`, at]);
    const collected = filesOf(at).flatMap(lines).map((one) => one.id);
    expect(collected).toEqual([...collected].sort((a, b) => Number(a) - Number(b)));
    expect(collected).toHaveLength(8);
  }, 20000);

  it('never rolls a file it has not written to, so the first frame is never lost', () => {
    // A cap below a single line: rolling on the first frame would open a file,
    // throw it away unread and write the frame anyway, every time.
    const write = writerFor(at, { maxFileSizeBytes: 1 });
    write(said(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })));
    expect(files()).toEqual(['wire.jsonl']);
    expect(lines(at)).toHaveLength(1);
  });
});

describe('a capture line that outgrows its line', () => {
  it('is written again with its strings cut, and says that it was', () => {
    // A payload bigger than the cap, which is what a `resourceRead` carrying a
    // file looks like. The cap is lowered; the string cut is VS Code's 16 KiB.
    const big = 'x'.repeat(64 * 1024);
    const write = writerFor(at, { maxLineLength: 4096 });
    write(said(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resourceRead', params: { text: big } })));

    const [line] = lines(at);
    // Still a line of JSON, and still the message, which is what a capture is
    // read as. A reader that only wants to know a `resourceRead` happened
    // still can.
    expect(line?.method).toBe('resourceRead');
    expect((line?._ahpLog as { truncated?: boolean }).truncated).toBe(true);
    // The payload is cut, and the cut says how much is missing rather than
    // pretending the message ended there.
    const text = line?.params as { text: string };
    expect(text.text.length).toBeLessThan(big.length);
    expect(text.text).toContain('more chars elided');
    // And the file stayed inside the cap, which is the point of writing it
    // again.
    expect(readFileSync(at, 'utf8').length).toBeLessThan(big.length);
  });

  it('leaves a line inside the cap alone, with nothing to say', () => {
    const write = writerFor(at, { maxLineLength: 4096 });
    write(said(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { text: 'short' } })));
    const [line] = lines(at);
    expect((line?._ahpLog as { truncated?: boolean }).truncated).toBeUndefined();
    expect((line?.params as { text: string }).text).toBe('short');
  });
});

describe('a capture that has rolled', () => {
  it('names only the files that are there', () => {
    // A daemon that has never filled a file has no `.3` to hand anybody, and
    // naming one that is not there collects a capture nobody is keeping.
    writerFor(at)(said(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })));
    expect(filesOf(at)).toEqual([at]);
  });

  it('names the rolls too, and they are whole', () => {
    const write = writerFor(at, { maxFileSizeBytes: 400 });
    for (let frame = 0; frame < 3; frame++) write(said(JSON.stringify({ jsonrpc: '2.0', id: frame, method: 'ping' })));
    expect(filesOf(at)).toEqual([`${at}.1`, at]);
    expect(existsSync(`${at}.1`)).toBe(true);
    // The two frames that filled the first file are in the roll, not lost.
    expect(lines(`${at}.1`).map((one) => one.id)).toEqual([0, 1]);
  }, 20000);
});

describe('the capture file itself', () => {
  it('starts empty, whatever a previous run left in it', () => {
    writeFileSync(at, 'a line from a daemon that is gone\n');
    writerFor(at)(said(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })));
    expect(lines(at)).toHaveLength(1);
  });

  /*
   * A capture holds every token a client sent in `authenticate`, so it is
   * the one file this daemon writes that is nobody else's to read.
   */
  it('is readable only by its owner when it is new', () => {
    writerFor(at)(said(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'authenticate', params: { token: 'sesame' } })));
    expect(statSync(at).mode & 0o777).toBe(0o600);
  });

  it('is readable only by its owner when a previous run left it 0644', () => {
    // The mode on create says nothing about a file that is already there, so
    // a capture left at the umask's mode is one this has to put right itself.
    writeFileSync(at, '', { mode: 0o644 });
    chmodSync(at, 0o644);
    writerFor(at)(said(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })));
    expect(statSync(at).mode & 0o777).toBe(0o600);
  });

  it('is readable only by its owner after a roll', () => {
    // The rolled-into file is a new one, made by the umask rather than by the
    // writer, and it holds the same tokens as the one before it.
    const write = writerFor(at, { maxFileSizeBytes: 400 });
    for (let frame = 0; frame < 3; frame++) write(said(JSON.stringify({ jsonrpc: '2.0', id: frame, method: 'ping' })));
    for (const one of files()) expect(statSync(join(home, one)).mode & 0o777).toBe(0o600);
  }, 20000);
});
