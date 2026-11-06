/*
 * `onPath`, which is how a setup answers what this machine has.
 *
 * The cases are the three answers a lookup has to get right: a command in a
 * later folder, a command that is not there at all, and a file that is in the
 * folder but cannot be run. The Windows rules - a `;` between folders and a
 * `PATHEXT` extension - are exercised here with the platform and the
 * environment as arguments, so they are tested where they are not the running
 * system's.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { onPath } from '../src/onpath.js';

let root: string;
let first: string;
let second: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-onpath-'));
  first = join(root, 'first');
  second = join(root, 'second');
  mkdirSync(first);
  mkdirSync(second);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** The PATH separator of the system running this test. */
const SEPARATOR = process.platform === 'win32' ? ';' : ':';

/** The name a command has in a folder on this system: npm's shim is a `.cmd` on Windows. */
const commandName = (name: string): string => (process.platform === 'win32' ? `${name}.CMD` : name);

/** A file in a folder, with the run bit when it is a command. */
const fileIn = (folder: string, name: string, runnable = true): string => {
  const file = join(folder, name);
  writeFileSync(file, '');
  if (runnable) chmodSync(file, 0o755);
  return file;
};

it('finds a command in the second folder on PATH', () => {
  fileIn(first, commandName('other'));
  const wanted = fileIn(second, commandName('gemini'));
  expect(onPath('gemini', [first, second].join(SEPARATOR))).toBe(wanted);
});

it('gives nothing for a command that is not on PATH', () => {
  fileIn(first, commandName('other'));
  expect(onPath('gemini', [first, second].join(SEPARATOR))).toBeUndefined();
});

// Windows has no run bit, so there is no such thing as a file that is on PATH
// and cannot be run: every extension `PATHEXT` names is runnable.
it.skipIf(process.platform === 'win32')('skips a file that does not have the run bit', () => {
  const file = fileIn(second, 'gemini', false);
  expect(onPath('gemini', second, 'linux')).toBeUndefined();
  chmodSync(file, 0o755);
  expect(onPath('gemini', second, 'linux')).toBe(file);
});

it('finds gemini.cmd on Windows through PATHEXT', () => {
  const wanted = fileIn(second, 'gemini.cmd');
  expect(onPath('gemini', second, 'win32', { PATHEXT: '.cmd' })).toBe(wanted);
});

// The daemon's onPath setting at findExecutable runs VS Code's lookup
// (src/vs/base/node/processes.ts L86-L140 at 6b68d3fe): any file that is not a
// folder, and an entry that is not absolute read against the working directory.
it.skipIf(process.platform === 'win32')('takes any file and reads an empty entry against the working directory under findExecutable', () => {
  const file = fileIn(second, 'gemini', false);
  const path = ['', first].join(SEPARATOR);
  expect(onPath('gemini', path, 'linux', {}, 'runnable', second)).toBeUndefined();
  expect(onPath('gemini', path, 'linux', {}, 'findExecutable', second)).toBe(file);
  expect(onPath('gemini', first, 'linux', {}, 'findExecutable', second)).toBe(file);
  mkdirSync(join(first, 'node'));
  expect(onPath('node', first, 'linux', {}, 'findExecutable', second)).toBeUndefined();
});

// VS Code's findExecutable tries each PATHEXT extension in a folder and then
// the name as written (src/vs/base/node/processes.ts L121-L137 at 6b68d3fe).
it('finds a command on Windows by its name as written once no PATHEXT extension is there', () => {
  const bare = fileIn(second, 'gemini');
  expect(onPath('gemini', second, 'win32', { PATHEXT: '.cmd' })).toBe(bare);
  const shim = fileIn(second, 'gemini.cmd');
  expect(onPath('gemini', second, 'win32', { PATHEXT: '.cmd' })).toBe(shim);
});

// Windows-only: finding `gemini.CMD` for `gemini.cmd` takes a file system
// that does not tell names apart by case.
it.runIf(process.platform === 'win32')('names the file as its folder holds it, whatever case PATHEXT gives', () => {
  const wanted = fileIn(second, 'gemini.cmd');
  expect(onPath('gemini', second, 'win32', { PATHEXT: '.COM;.EXE;.BAT;.CMD' })).toBe(wanted);
});
