/*
 * The decisions a daemon keeps across a restart.
 *
 * The half `memoryEnablement` deliberately does not have: the file. What a
 * restart has to survive is the whole point of the store, so the tests that
 * matter here build a store, change it, and build another one over the same
 * file - and one of them hands the file something a person broke.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { enablementKeyOf } from '@ahpd/sdk';
import { fileEnablement } from '../src/enablement.js';

/** One plugin, and the key a decision about it is kept under. */
const PLUGIN = 'file:///copies/holder/a-plugin';
const KEY = enablementKeyOf({ type: 'plugin', uri: PLUGIN }) ?? '';
/** What a plugin's server is keyed under, which is a key of its own. */
const SERVER = enablementKeyOf({ type: 'mcpServer', name: 'one' }, PLUGIN) ?? '';

/** The folder a session works in, which is what a folder decision is kept under. */
const FOLDER = 'file:///work';

let dir: string;
let file: string;
/** Everything the store said was wrong with the file. */
let problems: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-enablement-'));
  file = join(dir, 'customizations-state.json');
  problems = [];
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A store over the test's file, which is what a daemon builds at its start. */
const open = () => fileEnablement({ file, onProblem: (message) => problems.push(message) });

/** What the file holds, as JSON. */
const written = (): Record<string, unknown> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

it('reads a decision an earlier store made', () => {
  const before = open();
  before.setGlobal(KEY, false);
  before.setFolder(FOLDER, SERVER, false);

  const after = open();
  expect(after.global(KEY)).toBe(false);
  expect(after.folder(FOLDER, SERVER)).toBe(false);
  // A scope nothing was decided about still says nothing, rather than the
  // value in force: a reader has to tell the two apart.
  expect(after.folder('/elsewhere', SERVER)).toBeUndefined();
  expect(after.global(SERVER)).toBeUndefined();
  expect(problems).toEqual([]);
});

it('writes the decisions whole, under the version this store understands', () => {
  const store = open();
  store.setGlobal(KEY, false);
  // A folder that disagrees with every session is a decision of its own, and
  // one that agrees with it is not one at all.
  store.setFolder(FOLDER, KEY, true);
  store.setFolder('/elsewhere', KEY, false);

  // The directories' record under VS Code's own name for it.
  const held = written();
  expect(held.version).toBe(2);
  expect(held.global).toEqual({ [KEY]: false });
  expect(held.workingDirectories).toEqual({ [FOLDER]: { [KEY]: true } });

  // And a decision that says what it inherits is not written down at all.
  store.setFolder(FOLDER, KEY, false);
  expect(written().workingDirectories).toEqual({});
});

it('reads a file an earlier version wrote, its directories under folders', () => {
  writeFileSync(file, JSON.stringify({ version: 1, global: { [KEY]: false }, folders: { [FOLDER]: { [SERVER]: false } } }));
  const store = open();

  expect(store.global(KEY)).toBe(false);
  expect(store.folder(FOLDER, SERVER)).toBe(false);
  expect(problems).toEqual([]);
});

it('starts empty and says so when the file is not readable as JSON', () => {
  writeFileSync(file, '{ this is not json');
  const store = open();

  expect(store.global(KEY)).toBeUndefined();
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(file);

  // And what it writes next is a whole file again.
  store.setGlobal(KEY, false);
  expect(written().global).toEqual({ [KEY]: false });
});

it('leaves a file it does not understand alone, with a word about it', () => {
  writeFileSync(file, JSON.stringify({ version: 7, global: { [KEY]: false } }));
  const store = open();

  expect(store.global(KEY)).toBeUndefined();
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('left alone');
  // Left alone: nothing was written over it.
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 7, global: { [KEY]: false } });
});

it('says nothing about a file that is not there, which is a first start', () => {
  const store = open();
  expect(store.global(KEY)).toBeUndefined();
  expect(problems).toEqual([]);
});
