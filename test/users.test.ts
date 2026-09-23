import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fileUsers, signInRecord } from '../packages/sdk/src/users.js';
import type { Grant } from '../packages/sdk/src/types/users.js';

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

/** Every grant the host has an area for, so "everything" can be asserted. */
const AREAS: Grant[] = [
  'file:read', 'file:write',
  'session:read', 'session:write',
  'terminal:read', 'terminal:write',
  'automation:read', 'automation:write',
  'diagnostics:read',
];

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

it('gives admin every area, member the two it works in, and guest only what it may look at', async () => {
  const users = open();
  await users.add('a', ['admin']);
  await users.add('m', ['member']);
  await users.add('g', ['guest']);
  const admin = await users.verify(await users.mint('a'));
  const member = await users.verify(await users.mint('m'));
  const guest = await users.verify(await users.mint('g'));

  for (const one of AREAS) expect(admin?.can(one), one).toBe(true);
  expect(member?.can('file:read')).toBe(true);
  expect(member?.can('file:write')).toBe(true);
  expect(member?.can('session:read')).toBe(true);
  expect(member?.can('session:write')).toBe(true);
  expect(member?.can('terminal:write')).toBe(true);
  expect(member?.can('automation:read')).toBe(false);
  expect(member?.can('diagnostics:read')).toBe(false);

  // The point of the verb: guest may look at the sessions and the automations
  // and may do nothing about either.
  expect(guest?.can('session:read')).toBe(true);
  expect(guest?.can('automation:read')).toBe(true);
  expect(guest?.can('session:write')).toBe(false);
  expect(guest?.can('automation:write')).toBe(false);
  expect(guest?.can('file:read')).toBe(false);
  expect(guest?.can('file:write')).toBe(false);
  expect(guest?.can('terminal:read')).toBe(false);
  expect(guest?.can('terminal:write')).toBe(false);

  // A scheme is named, never conferred: writing files does not write a
  // plugin's scheme, and `admin` reaches it only through the wildcard.
  expect(member?.can('computer:write')).toBe(false);
  expect(member?.can('computer:read')).toBe(false);
  expect(admin?.can('computer:write')).toBe(true);
});

it('matches a wildcard in either position', async () => {
  writeFileSync(path, JSON.stringify({
    roles: {
      reader: ['*:read'],
      own: ['session:*'],
      all: ['*:*'],
    },
    users: [
      { id: 'r', roles: ['reader'], token: '' },
      { id: 'o', roles: ['own'], token: '' },
      { id: 'x', roles: ['all'], token: '' },
    ],
  }));
  const users = open();
  const reader = await users.verify(await users.mint('r'));
  const own = await users.verify(await users.mint('o'));
  const all = await users.verify(await users.mint('x'));

  // Every subject's read, and no write anywhere.
  expect(reader?.can('session:read')).toBe(true);
  expect(reader?.can('computer:read')).toBe(true);
  expect(reader?.can('session:write')).toBe(false);
  expect(reader?.can('file:write')).toBe(false);

  // Every verb on one subject, and nothing outside it.
  expect(own?.can('session:read')).toBe(true);
  expect(own?.can('session:write')).toBe(true);
  expect(own?.can('file:read')).toBe(false);

  expect(all?.can('file:write')).toBe(true);
  expect(all?.can('automation:write')).toBe(true);
  expect(all?.can('computer:write')).toBe(true);
});

it('lets a file role override a built-in, and says so when a role is defined nowhere', async () => {
  writeFileSync(path, JSON.stringify({
    roles: { admin: ['file:read'], viewer: ['file:read'] },
    users: [
      { id: 'a', roles: ['admin'], token: '' },
      { id: 'b', roles: ['viewer'], token: '' },
      { id: 'c', roles: ['ghost'], token: '' },
    ],
  }));
  const said: string[] = [];
  const users = open((one) => said.push(one));

  const admin = await users.verify(await users.mint('a'));
  expect(admin?.can('file:read')).toBe(true);
  // The file's `admin` wins over the built-in of the same name.
  expect(admin?.can('file:write')).toBe(false);

  const viewer = await users.verify(await users.mint('b'));
  expect(viewer?.can('file:read')).toBe(true);
  expect(viewer?.can('file:write')).toBe(false);

  // A role nothing defines contributes nothing, and is said rather than thrown,
  // so one bad line does not lock everybody out.
  const ghost = await users.verify(await users.mint('c'));
  expect(ghost?.id).toBe('c');
  expect(ghost?.can('file:read')).toBe(false);
  expect(said.some((one) => one.includes('ghost'))).toBe(true);
});

it('reports a grant that is not a subject and a verb, and drops it', async () => {
  writeFileSync(path, JSON.stringify({
    roles: { odd: ['session:read', 'session', 'read:computer', 'session:edit', 'file:*'] },
    users: [{ id: 'o', roles: ['odd'], token: '' }],
  }));
  const said: string[] = [];
  const users = open((one) => said.push(one));
  const held = await users.verify(await users.mint('o'));

  // The four that are a subject and a verb survive, the wildcard included.
  expect(held?.can('session:read')).toBe(true);
  expect(held?.can('file:read')).toBe(true);
  expect(held?.can('file:write')).toBe(true);
  // A bare token, and the spelling this repository used to have.
  expect(said.some((one) => one.includes('session,'))).toBe(true);
  expect(said.some((one) => one.includes('read:computer'))).toBe(true);
  expect(said.some((one) => one.includes('session:edit'))).toBe(true);
});

it('answers the grants a role resolves to, without repeating the resolution', async () => {
  const users = open();
  await users.add('g', ['guest']);
  const rows = await users.list();
  expect(rows).toEqual([{ id: 'g', roles: ['guest'], grants: ['session:read', 'automation:read'], trusted: false }]);
});

it('does not trust a connection token unless the record or the host says so', async () => {
  /*
   * The door admits and says nobody; `authenticate` is what authorizes. A
   * record that sets `trustToken`, or a host whose default is that, makes the
   * token enough on its own - decision `the-door-is-a-door`.
   */
  writeFileSync(path, JSON.stringify({
    users: [
      { id: 'plain', roles: ['guest'], token: '' },
      { id: 'trusted', roles: ['guest'], token: '', trustToken: true },
    ],
  }));

  const strict = open();
  expect((await strict.verify(await strict.mint('plain')))?.trusted).toBe(false);
  expect((await strict.verify(await strict.mint('trusted')))?.trusted).toBe(true);

  // The host's default, with the record's own answer still winning over it.
  const loose = fileUsers({ path, trustToken: true });
  expect((await loose.verify(await loose.mint('plain')))?.trusted).toBe(true);
  writeFileSync(path, JSON.stringify({
    users: [
      { id: 'plain', roles: ['guest'], token: '', trustToken: false },
      { id: 'trusted', roles: ['guest'], token: '', trustToken: true },
    ],
  }));
  expect((await loose.verify(await loose.mint('plain')))?.trusted).toBe(false);
  expect((await loose.verify(await loose.mint('trusted')))?.trusted).toBe(true);
});

it('refuses a role nothing defines, rather than adding somebody who may do nothing', async () => {
  const users = open();
  await expect(users.add('a', ['ghost'])).rejects.toThrow(/no role called ghost/);
  // And the file is untouched by the refusal.
  expect(await users.list()).toEqual([]);
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

  expect(await users.list()).toEqual([{ id: 'a', roles: ['admin'], grants: ['*:*'], trusted: false }]);
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
