/*
 * The one file a daemon before this layout left, split into one file per session.
 *
 * A daemon that carried every session it ever saw has them all in
 * `sessions.json`, and the store this version opens reads a folder. So the split
 * happens once, before the store opens, and the old file is renamed rather than
 * deleted. Each case has its own configuration home, so what it checks is a
 * folder this case created.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { daemonSessions } from '../src/commands/run.js';

const held = process.env.XDG_CONFIG_HOME;

let home: string;
let before: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-migrate-'));
  before = held;
  process.env.XDG_CONFIG_HOME = home;
  mkdirSync(join(home, 'ahpd'), { recursive: true });
});
afterEach(() => {
  if (before === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = before;
  rmSync(home, { recursive: true, force: true });
});

/** The one file, where the daemon before this layout kept every session. */
const file = (): string => join(home, 'ahpd', 'sessions.json');
/** The folder, where this one keeps a file per session. */
const folder = (): string => join(home, 'ahpd', 'sessions');

/** What this daemon's own store keeps, and what it says about a problem. */
const open = () => {
  const said: string[] = [];
  return { store: daemonSessions((message) => said.push(message)), said };
};

const old = [
  { id: 'one', flags: 64 },
  { id: 'two', owner: 'user:ana' },
  // A config written by a version that stored values as text, carried across
  // as what it is rather than re-read against a later schema.
  { id: 'three', config: { voice: 'shouty' } },
];

it('splits the file into one file per session, and renames the old one out of the way', () => {
  writeFileSync(file(), `${JSON.stringify({ version: 1, sessions: old })}\n`);
  const { store, said } = open();

  expect(said).toEqual([]);
  expect(readdirSync(folder()).sort()).toEqual(['one.json', 'three.json', 'two.json']);
  expect(JSON.parse(readFileSync(join(folder(), 'one.json'), 'utf8'))).toEqual({ version: 1, id: 'one', flags: 64 });
  expect(existsSync(file())).toBe(false);
  expect(existsSync(`${file()}.migrated`)).toBe(true);
  // And what it held is what the store answers with, a row at a time.
  expect(store.flags('one')).toBe(64);
  expect(store.owner('two')).toBe('user:ana');
  expect(store.config('three')).toEqual({ voice: 'shouty' });
});

it('does nothing on a second start, and leaves a file that turned up later alone', () => {
  writeFileSync(file(), `${JSON.stringify({ version: 1, sessions: old })}\n`);
  open().store.close?.();

  // A file that was there when the folder already was is not a store this
  // version reads twice; the folder is what says the split has happened.
  writeFileSync(file(), `${JSON.stringify({ version: 1, sessions: [{ id: 'late', flags: 32 }] })}\n`);
  const { store, said } = open();

  expect(said).toEqual([]);
  expect(readdirSync(folder()).sort()).toEqual(['one.json', 'three.json', 'two.json']);
  expect(existsSync(file())).toBe(true);
  expect(store.flags('late')).toBe(0);
});

it('leaves a file it cannot read exactly as it is, and says which one', () => {
  writeFileSync(file(), 'this is not json');
  const before_ = readFileSync(file(), 'utf8');
  const { store, said } = open();

  expect(said.join(' ')).toContain('Could not read');
  expect(readFileSync(file(), 'utf8')).toBe(before_);
  expect(existsSync(`${file()}.migrated`)).toBe(false);
  expect(store.flags('anything')).toBe(0);
});

it('leaves a file shaped by another version alone, and says which one', () => {
  writeFileSync(file(), `${JSON.stringify({ version: 2, sessions: [{ id: 'one', flags: 64 }] })}\n`);
  const { store, said } = open();

  expect(said.join(' ')).toContain('not a session store this version can read');
  expect(existsSync(file())).toBe(true);
  expect(existsSync(folder())).toBe(false);
  expect(store.flags('one')).toBe(0);
});

it('starts empty where there is no file at all', () => {
  const { store, said } = open();
  expect(said).toEqual([]);
  expect(store.flags('anything')).toBe(0);
});