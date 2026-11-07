/*
 * The root config a daemon keeps across a restart.
 *
 * What a restart has to survive is the whole point of the store, so these
 * build a store, write to it, and build another over the same file, and two of
 * them hand the file something it cannot take. What a start takes back from
 * the file is the host's to decide, in `root-config.test.ts`.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fileRootConfigStore } from '../src/rootconfigstore.js';

let dir: string;
let file: string;
/** Everything the store said was wrong with the file. */
let problems: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-root-config-'));
  file = join(dir, 'root-config.json');
  problems = [];
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A store over the test's file, which is what a daemon builds at its start. */
const open = () => fileRootConfigStore({ file, onProblem: (message) => problems.push(message) });

it('reads the root config an earlier store wrote, written whole under its version', () => {
  const values = { defaultShell: '/bin/zsh', permissions: { allow: ['WebFetch(example.com)'], deny: [] }, nonsense: 1 };
  open().write(values);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, values });

  expect(open().read()).toEqual(values);
  expect(problems).toEqual([]);
});

it('starts empty and says so when the file is not readable as JSON', () => {
  writeFileSync(file, '{ this is not json');
  const store = open();
  expect(store.read()).toEqual({});
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(file);

  // And what it writes next is a whole file again.
  store.write({ defaultShell: '/bin/zsh' });
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, values: { defaultShell: '/bin/zsh' } });
});

it('leaves a file of a version it does not know until the next write, with a word about it', () => {
  writeFileSync(file, JSON.stringify({ version: 7, values: { defaultShell: '/bin/zsh' } }));
  expect(open().read()).toEqual({});
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('left alone');
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 7, values: { defaultShell: '/bin/zsh' } });
});

it('says nothing about a file that is not there, which is a first start', () => {
  expect(open().read()).toEqual({});
  expect(problems).toEqual([]);
});
