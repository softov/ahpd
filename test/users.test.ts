import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fileUsers, signInRecord } from '../packages/sdk/src/users.js';
import type { Capability } from '../packages/sdk/src/types/users.js';

/*
 * The user directory, on its own.
 *
 * The file is the whole of the state, so every case writes one and reads it
 * back: what is under test is what the host can conclude about a token, and a
 * broken file must conclude nothing rather than throw.
 */

let root: string;
let path: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-users-'));
  path = join(root, 'users.json');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const open = (onProblem?: (message: string) => void) =>
  fileUsers({ path, ...(onProblem === undefined ? {} : { onProblem }) });

const EVERY: Capability[] = ['read', 'write', 'session', 'terminal', 'automation', 'diagnostics'];

it('advertises a record the standard recognises: a page field and no invented issuer', () => {
  const record = open().resource;
  expect(record.resource_documentation).toBe('https://github.com/softov/ahpd/blob/main/docs/USERS.md');
  expect(record).not.toHaveProperty('authorization_servers');
  expect(record.required).toBe(true);
  expect(record.resource_name).toBe('ahpd users');
});

it('advertises the identifier a deployment names, and keeps the rest of the record', () => {
  // What the daemon builds from where it listens, so a client is told an https
  // identifier rather than the library fallback.
  const record = signInRecord('https://ahpd.example.com/');
  expect(record.resource).toBe('https://ahpd.example.com/');
  expect(record.resource_name).toBe('ahpd users');
  expect(record.resource_documentation).toBe('https://github.com/softov/ahpd/blob/main/docs/USERS.md');
  expect(record).not.toHaveProperty('authorization_servers');
});

it('verifies a minted token and answers the record\'s roles', async () => {
  const users = open();
  await users.add('ana', ['admin']);
  const token = await users.mint('ana');

  const held = await users.verify(token);
  expect(held?.id).toBe('ana');
  expect(held?.roles).toEqual(['admin']);
  // One character different is a different secret, and the empty string is
  // nobody rather than the first record.
  expect(await users.verify(`${token}x`)).toBeUndefined();
  expect(await users.verify('')).toBeUndefined();
});

it('gives admin everything built in and member the four it names', async () => {
  const users = open();
  await users.add('a', ['admin']);
  await users.add('m', ['member']);
  const admin = await users.verify(await users.mint('a'));
  const member = await users.verify(await users.mint('m'));

  for (const one of EVERY) expect(admin?.can(one), one).toBe(true);
  expect(member?.can('read')).toBe(true);
  expect(member?.can('write')).toBe(true);
  expect(member?.can('terminal')).toBe(true);
  expect(member?.can('automation')).toBe(false);
  expect(member?.can('diagnostics')).toBe(false);
  // A scheme is named, never conferred by the plain capability: a role that may
  // write files may not, by that alone, write a plugin's scheme.
  expect(member?.can('write:computer')).toBe(false);
  expect(member?.can('read:computer')).toBe(false);
});

it('lets a file role override a built-in, and says so when a role is defined nowhere', async () => {
  writeFileSync(path, JSON.stringify({
    roles: { admin: ['read'], viewer: ['read'] },
    users: [
      { id: 'a', roles: ['admin'], token: '' },
      { id: 'b', roles: ['viewer'], token: '' },
      { id: 'c', roles: ['ghost'], token: '' },
    ],
  }));
  const said: string[] = [];
  const users = open((one) => said.push(one));

  const admin = await users.verify(await users.mint('a'));
  expect(admin?.can('read')).toBe(true);
  // The file's `admin` wins over the built-in of the same name.
  expect(admin?.can('write')).toBe(false);

  const viewer = await users.verify(await users.mint('b'));
  expect(viewer?.can('read')).toBe(true);
  expect(viewer?.can('write')).toBe(false);

  // A role nothing defines contributes nothing, and is said rather than thrown,
  // so one bad line does not lock everybody out.
  const ghost = await users.verify(await users.mint('c'));
  expect(ghost?.id).toBe('c');
  expect(ghost?.can('read')).toBe(false);
  expect(said.some((one) => one.includes('ghost'))).toBe(true);
});

it('mints a new secret each time, and only the last one verifies', async () => {
  const users = open();
  await users.add('a', ['member']);
  const first = await users.mint('a');
  const second = await users.mint('a');

  expect(first).not.toBe(second);
  expect(await users.verify(first)).toBeUndefined();
  expect((await users.verify(second))?.id).toBe('a');
});

it('removes a person once, and their token stops verifying', async () => {
  const users = open();
  await users.add('a', ['member']);
  const token = await users.mint('a');

  expect(await users.remove('a')).toBe(true);
  expect(await users.remove('a')).toBe(false);
  expect(await users.verify(token)).toBeUndefined();
  expect(await users.list()).toEqual([]);
});

it('lists people without their credentials', async () => {
  const users = open();
  await users.add('a', ['admin']);
  await users.mint('a');

  expect(await users.list()).toEqual([{ id: 'a', roles: ['admin'] }]);
  const text = JSON.stringify(await users.list());
  expect(text).not.toContain('sha256');
});

it('fails closed on a file that is absent, empty or malformed', async () => {
  // Absent: nobody, and not an error.
  expect(await open().verify('anything')).toBeUndefined();

  writeFileSync(path, '');
  expect(await open().verify('anything')).toBeUndefined();

  writeFileSync(path, 'not json at all');
  const said: string[] = [];
  const broken = open((one) => said.push(one));
  expect(await broken.verify('anything')).toBeUndefined();
  expect(await broken.list()).toEqual([]);
  expect(said.some((one) => one.includes('not a user file'))).toBe(true);
  // And it refuses to be written over, so a file somebody broke is not
  // silently replaced by the next command.
  await expect(broken.add('a', ['member'])).rejects.toThrow(/not a user file/);
});
