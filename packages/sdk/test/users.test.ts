import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fileUsers, signInRecord } from '../src/users.js';
import { scopeFor } from '../src/scopes.js';
import type { Grant } from '../src/types/users.js';

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

it('reads an old users grant as the user subject, and says so once per role', async () => {
  writeFileSync(path, JSON.stringify({
    roles: { keeper: ['users:write'], reader: ['users:read'] },
    users: [
      { id: 'k', roles: ['keeper'], token: '' },
      { id: 'r', roles: ['reader'], token: '' },
    ],
  }));
  const said: string[] = [];
  const users = open((one) => said.push(one));
  const held = await users.verify(await users.mint('k'));

  // One subject for people, and only for people: decision
  // `a-legacy-users-grant-is-the-user-subject-only`.
  expect(held?.can('user:write')).toBe(true);
  expect(held?.can('team:write')).toBe(false);
  expect(held?.can('project:write')).toBe(false);
  expect(held?.can('role:write')).toBe(false);
  expect((await users.verify(await users.mint('r')))?.can('user:read')).toBe(true);
  // Said for each role that is read that way, and once however often the file
  // is read afterwards.
  expect(said.filter((one) => one.includes('users:write')).length).toBe(1);
  expect(said.filter((one) => one.includes('users:read')).length).toBe(1);
  expect(said.some((one) => one.includes('role reader'))).toBe(true);
  await users.list();
  await users.list();
  expect(said.length).toBe(2);
});

it('gives each scheme its own subject, so a role may see teams and not people', async () => {
  writeFileSync(path, JSON.stringify({
    roles: { teamreader: ['team:read'] },
    users: [{ id: 't', roles: ['teamreader'], token: '' }],
  }));
  const held = await open().verify(await open().mint('t'));

  // Decision `people-are-resource-schemes-with-a-grant-each`: the split is the
  // whole point, so a team is not reachable through a user grant.
  expect(held?.can('team:read')).toBe(true);
  expect(held?.can('team:write')).toBe(false);
  expect(held?.can('user:read')).toBe(false);
  expect(held?.can('user:write')).toBe(false);
  expect(held?.can('project:read')).toBe(false);
  expect(held?.can('role:read')).toBe(false);
  // And the management of people is its own subject, not a wider settings grant.
  expect(held?.can('config:write')).toBe(false);
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

it('refuses a role named like an object key, and resolves none to anything', async () => {
  const users = open();
  await expect(users.add('x', ['constructor'])).rejects.toThrow(/no role called constructor/);
  expect(await users.grantsOfRoles(['__proto__'])).toEqual([]);
  expect(await users.grantsOfRoles(['constructor', 'toString'])).toEqual([]);
});

it('reads a role named __proto__ as a role, and nothing it names changes the table', async () => {
  // Written as JSON text, because an object literal's `__proto__` sets the
  // literal's prototype instead of making a key.
  writeFileSync(path, '{"roles":{"__proto__":["config:read"]},"users":[{"id":"a","roles":["__proto__"]}]}');
  const users = open();
  expect(await users.grantsOfRoles(['__proto__'])).toEqual(['config:read']);
  expect(await users.grantsOfPerson('a')).toContain('config:read');
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

it('resolves role names to grants, and a person to the grants its roles hold', async () => {
  writeFileSync(path, JSON.stringify({ roles: { people: ['user:write'] }, users: [] }));
  const users = open();
  await users.add('pat', ['people']);
  await users.add('ada', ['admin']);

  expect((await users.grantsOfRoles(['admin'])).sort()).toEqual(['*:*']);
  expect((await users.grantsOfRoles(['people'])).sort()).toEqual(['user:write']);
  expect(await users.grantsOfRoles(['nobody'])).toEqual([]);

  expect((await users.grantsOfPerson('ada'))?.sort()).toEqual(['*:*']);
  expect((await users.grantsOfPerson('pat'))?.sort()).toEqual(['user:write']);
  expect(await users.grantsOfPerson('nobody')).toBeUndefined();
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

it('parses the three forms of a membership, and the primary beside them', async () => {
  writeFileSync(path, JSON.stringify({
    teams: [{ id: 'backend' }, { id: 'frontend', title: 'Front end' }],
    projects: [{ id: 'ahpd' }, { id: 'controllr' }],
    users: [{
      id: 'luiz',
      roles: ['member'],
      token: '',
      memberships: ['backend:*', 'frontend:controllr', 'frontend'],
      primary: 'backend:ahpd',
    }],
  }));
  const users = open();
  const held = await users.verify(await users.mint('luiz'));

  expect(held?.memberships).toEqual(['backend:*', 'frontend:controllr', 'frontend']);
  expect(held?.primary).toBe('backend:ahpd');
  // And a membership grants nothing: it says who pays, not what is allowed.
  expect(held?.can('user:write')).toBe(false);
});

it('ignores a membership naming a team or a project this file does not define', async () => {
  writeFileSync(path, JSON.stringify({
    teams: [{ id: 'backend' }],
    projects: [{ id: 'ahpd' }],
    users: [{
      id: 'luiz',
      roles: ['member'],
      token: '',
      memberships: ['backend:ahpd', 'frontend:controllr', 'backend:nowhere', 'backend:', 'ops'],
    }],
  }));
  const said: string[] = [];
  const users = open((one) => said.push(one));
  const held = await users.verify(await users.mint('luiz'));

  // Only the one naming what the file holds survives.
  expect(held?.memberships).toEqual(['backend:ahpd']);
  expect(said.some((one) => one.includes('no team called frontend'))).toBe(true);
  expect(said.some((one) => one.includes('no project called nowhere'))).toBe(true);
  expect(said.some((one) => one.includes('not team, team:* or team:project'))).toBe(true);
  // Said once, however often the file is read.
  const heard = said.length;
  await users.grantsOfPerson('luiz');
  expect(said.length).toBe(heard);
});

it('ignores a primary that is not a concrete membership of theirs', async () => {
  const said: string[] = [];
  const withPrimary = async (primary: string, memberships: string[]): Promise<string | undefined> => {
    writeFileSync(path, JSON.stringify({
      teams: [{ id: 'backend' }, { id: 'frontend' }],
      projects: [{ id: 'ahpd' }],
      users: [{ id: 'luiz', roles: [], token: '', memberships, primary }],
    }));
    const users = open((one) => said.push(one));
    return (await users.verify(await users.mint('luiz')))?.primary;
  };

  // `*` is not a place, and a team they belong to by another membership is
  // not a place either.
  expect(await withPrimary('backend:*', ['backend:*'])).toBeUndefined();
  expect(await withPrimary('frontend', ['backend:*'])).toBeUndefined();
  expect(await withPrimary('backend', ['backend'])).toBe('backend');
  // A wildcard covers the projects of its team, which is what makes
  // `backend:ahpd` a primary for somebody in `backend:*`.
  expect(await withPrimary('backend:ahpd', ['backend:*'])).toBe('backend:ahpd');
  expect(said.filter((one) => one.includes('primary')).length).toBe(2);
});

it('lets a person move their own teams when a role they hold is no longer defined', async () => {
  writeFileSync(path, JSON.stringify({
    roles: { writer: ['file:write'] },
    teams: [{ id: 'backend' }],
    users: [{ id: 'luiz', roles: ['writer'], token: '', memberships: ['backend'] }],
  }));
  const users = open();
  // The role is taken out of the file, which says nothing about the records
  // that still hold it. A write that re-read those records and refused them
  // would lock the person out of the file entirely, over a role they are not
  // being given and were not asking for.
  writeFileSync(path, JSON.stringify({
    teams: [{ id: 'backend' }],
    users: [{ id: 'luiz', roles: ['writer'], token: '', memberships: ['backend'] }],
  }));
  await users.add('luiz', ['writer'], { memberships: ['backend'], primary: 'backend' });
  expect((await users.list())[0]).toMatchObject({ memberships: ['backend'], primary: 'backend' });
  // A role this call really is giving is still refused.
  await expect(users.add('luiz', ['writer', 'ghostwriter'])).rejects.toThrow('no role called ghostwriter');
});

it('reads a file written before teams and projects were in it', async () => {
  writeFileSync(path, JSON.stringify({ roles: { guest: ['session:read'] }, users: [{ id: 'ana', roles: ['guest'], token: '' }] }));
  const users = open();
  const held = await users.verify(await users.mint('ana'));
  expect(held?.id).toBe('ana');
  // No teams and no projects means no memberships, rather than a file that will
  // not read.
  expect(held?.memberships).toEqual([]);
  expect(held?.primary).toBeUndefined();
  expect(await users.list()).toEqual([{ id: 'ana', roles: ['guest'], grants: ['session:read'], trusted: false }]);
});

it('writes the teams and the projects back, and reads them again', async () => {
  writeFileSync(path, JSON.stringify({
    teams: [{ id: 'backend' }],
    projects: [{ id: 'ahpd', title: 'AHP daemon' }],
    users: [{ id: 'ana', roles: ['member'], token: '', memberships: ['backend:ahpd'], primary: 'backend:ahpd' }],
  }));
  const users = open();
  await users.mint('ana');

  const written = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  expect(written['teams']).toEqual([{ id: 'backend' }]);
  expect(written['projects']).toEqual([{ id: 'ahpd', title: 'AHP daemon' }]);
  // The membership rides along with the write that minting made.
  expect((written['users'] as Record<string, unknown>[])[0]?.['memberships']).toEqual(['backend:ahpd']);
  expect((await users.list())[0]?.memberships).toEqual(['backend:ahpd']);
});

it('re-reads a membership added while the connection is open', async () => {
  writeFileSync(path, JSON.stringify({
    teams: [{ id: 'backend' }],
    projects: [{ id: 'ahpd' }],
    users: [{ id: 'ana', roles: ['member'], token: '' }],
  }));
  const users = open();
  const held = await users.verify(await users.mint('ana'));
  expect(held?.memberships).toEqual([]);

  // The file is read on every question, as roles are.
  const file = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  (file['users'] as Record<string, unknown>[])[0] = {
    ...(file['users'] as Record<string, unknown>[])[0] as object,
    memberships: ['backend:*'],
    primary: 'backend:ahpd',
  };
  writeFileSync(path, JSON.stringify(file));
  expect(held?.memberships).toEqual(['backend:*']);
  expect(held?.primary).toBe('backend:ahpd');
});

it('keeps a membership a write does not concern, even one naming nothing yet', async () => {
  writeFileSync(path, JSON.stringify({
    teams: [{ id: 'backend' }],
    // A team the operator is about to name, which the read cannot make sense of
    // yet but which is not the write's to decide.
    users: [{ id: 'luiz', roles: ['member'], token: '', memberships: ['backend', 'sales'] }],
  }));
  const users = open();
  const held = await users.verify(await users.mint('luiz'));
  expect(held?.memberships).toEqual(['backend']);

  // Minting writes the file back, and must not take the unreadable entry with
  // it: a write that erases what the read ignored has no undo but the operator's
  // own memory of what they wrote.
  await users.mint('luiz');
  const after = JSON.parse(readFileSync(path, 'utf8')) as { users: { memberships?: string[] }[] };
  expect(after.users[0]?.memberships).toEqual(['backend', 'sales']);

  // Naming the team is what makes it mean something, and it means something at
  // once, with no write of the record in between.
  await users.addTeam('sales');
  expect(held?.memberships).toEqual(['backend', 'sales']);
  expect(held?.teams).toEqual([{ id: 'backend' }, { id: 'sales' }]);
});

it('keeps a primary a write does not concern, even one naming nothing yet', async () => {
  writeFileSync(path, JSON.stringify({
    teams: [{ id: 'backend' }],
    users: [{ id: 'luiz', roles: ['member'], token: '', memberships: ['backend', 'sales'], primary: 'sales' }],
  }));
  const users = open();
  const held = await users.verify(await users.mint('luiz'));
  expect(held?.primary).toBeUndefined();

  await users.mint('luiz');
  const after = JSON.parse(readFileSync(path, 'utf8')) as { users: { primary?: string }[] };
  expect(after.users[0]?.primary).toBe('sales');

  await users.addTeam('sales');
  expect(held?.primary).toBe('sales');
});

it('ignores a primary naming a project the file no longer has, and the write keeps it', async () => {
  writeFileSync(path, JSON.stringify({
    teams: [{ id: 'backend' }],
    projects: [{ id: 'ahpd' }],
    users: [{ id: 'luiz', roles: [], token: '', memberships: ['backend:*'], primary: 'backend:ahpd' }],
  }));
  const said: string[] = [];
  const users = open((one) => said.push(one));
  const held = await users.verify(await users.mint('luiz'));
  expect(held?.primary).toBe('backend:ahpd');
  expect(said.length).toBe(0);

  // The project is taken out by hand, which is what a file edited outside this
  // host looks like. A primary is checked the way a membership is, so it stops
  // being a place rather than outliving the project.
  writeFileSync(path, JSON.stringify({
    teams: [{ id: 'backend' }],
    projects: [],
    users: [{ id: 'luiz', roles: [], token: '', memberships: ['backend:*'], primary: 'backend:ahpd' }],
  }));
  expect(held?.primary).toBeUndefined();
  expect(said.some((one) => one.includes('primary backend:ahpd') && one.includes('no project called ahpd'))).toBe(true);
  // And the write that follows does not quietly settle it either.
  await users.mint('luiz');
  const after = JSON.parse(readFileSync(path, 'utf8')) as { users: { primary?: string }[] };
  expect(after.users[0]?.primary).toBe('backend:ahpd');
});

it('falls to the membership left when the primary names a project that is gone', async () => {
  writeFileSync(path, JSON.stringify({
    teams: [{ id: 'backend' }, { id: 'frontend' }],
    projects: [{ id: 'ahpd' }],
    users: [{ id: 'luiz', roles: [], token: '', memberships: ['backend:*', 'frontend'], primary: 'backend:ahpd' }],
  }));
  const users = open();
  const held = await users.verify(await users.mint('luiz'));
  expect(scopeFor(held)).toEqual({ scope: { team: 'backend', project: 'ahpd' } });

  // The project is taken out of the file, so the primary is naming a place that
  // is not there; the work falls to the one concrete membership rather than
  // being refused, which is the same answer a person with no primary would get.
  writeFileSync(path, JSON.stringify({
    teams: [{ id: 'backend' }, { id: 'frontend' }],
    projects: [],
    users: [{ id: 'luiz', roles: [], token: '', memberships: ['backend:*', 'frontend'], primary: 'backend:ahpd' }],
  }));
  expect(held?.primary).toBeUndefined();
  expect(scopeFor(held)).toEqual({ scope: { team: 'frontend' } });
});

it('refuses to take out a team or a project a primary names, saying who', async () => {
  writeFileSync(path, JSON.stringify({
    teams: [{ id: 'backend' }],
    projects: [{ id: 'ahpd' }],
    users: [{ id: 'luiz', roles: [], token: '', memberships: ['backend:*'], primary: 'backend:ahpd' }],
  }));
  const users = open();
  await expect(users.removeProject('ahpd')).rejects.toThrow('ahpd is still a project of luiz; take them out of it first');
  await expect(users.removeTeam('backend')).rejects.toThrow('backend is still a team of luiz; take them out of it first');

  // Once the memberships go, so does the primary and so are the two free.
  await users.add('luiz', [], { memberships: [] });
  expect(await users.removeProject('ahpd')).toBe(true);
  expect(await users.removeTeam('backend')).toBe(true);
});

it('keeps a title an add does not give, and refuses an id a membership could not spell', async () => {
  writeFileSync(path, JSON.stringify({ projects: [{ id: 'ahpd', title: 'AHP daemon' }], users: [] }));
  const users = open();
  await users.addProject('ahpd');
  expect(await users.projects()).toEqual([{ id: 'ahpd', title: 'AHP daemon' }]);
  await users.addProject('ahpd', 'The daemon');
  expect(await users.projects()).toEqual([{ id: 'ahpd', title: 'The daemon' }]);
  for (const id of ['a:b', '*', 'two words']) {
    await expect(users.addTeam(id)).rejects.toThrow('may not hold a space, a colon or a star');
  }
});
