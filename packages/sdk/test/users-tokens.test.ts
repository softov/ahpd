import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { posix } from '../../../tools/posix.ts';
import { same } from '../src/listen.js';
import { fileUsers } from '../src/access/users.js';
import type { FileUserOptions } from '../src/access/users.js';
import { scopeFor } from '../src/usage/scopes.js';
import type { Users } from '../src/types/users.js';

// Counted, not replaced: every comparison still happens, and a case can say
// how many the one pass made.
vi.mock('../src/listen.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/listen.js')>();
  return { ...actual, same: vi.fn(actual.same) };
});

// The bytes a case hands the next call, and the real source after them. A mint
// draws its id before its secret, so a queued buffer is an id and the unqueued
// draw is the secret.
const nextBytes = vi.hoisted(() => ({ waiting: [] as Buffer[] }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomBytes: (size: number) => nextBytes.waiting.shift() ?? actual.randomBytes(size),
  };
});

/*
 * The tokens a person mints for themselves, on their own.
 *
 * The users file and the tokens file are both the whole of the state, so every
 * case writes one or reads it back: what is under test is what the directory
 * keeps, what it answers once, and what it refuses to write over.
 */

let root: string;
let path: string;
let tokensPath: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-user-tokens-'));
  path = join(root, 'users.json');
  tokensPath = join(root, 'users.tokens.json');
});
afterEach(() => {
  vi.useRealTimers();
  nextBytes.waiting.length = 0;
  rmSync(root, { recursive: true, force: true });
});

const open = (options: Partial<FileUserOptions> = {}): Users => fileUsers({ path, ...options });

/** The tokens file as it was written, hashes and all. */
interface StoredToken {
  id: string;
  user?: string;
  team?: string;
  label?: string;
  grants?: string[];
  scope?: string;
  limits?: { amount: number; measure: string; period: string; pool: string }[];
  meta?: Record<string, string>;
  created: number;
  expires?: number;
  token: string;
}
const stored = (): { tokens: StoredToken[] } =>
  JSON.parse(readFileSync(tokensPath, 'utf8')) as { tokens: StoredToken[] };

it('mints a secret shown once and stores only its hash', async () => {
  const users = open();
  await users.add('ana', ['member']);
  const minted = await users.mintToken!('ana', { label: 'laptop' });

  expect(minted.user).toBe('ana');
  expect(minted.label).toBe('laptop');
  expect(minted.id).not.toBe('');
  expect(minted.secret.length).toBeGreaterThan(20);
  // The answer is the record without a hash, and the secret beside it.
  expect(minted).not.toHaveProperty('token');

  const text = readFileSync(tokensPath, 'utf8');
  expect(text).not.toContain(minted.secret);
  const [record] = stored().tokens;
  expect(record?.token).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(record?.user).toBe('ana');
  expect(record?.label).toBe('laptop');
  expect(record?.created).toBeGreaterThan(0);

  // And the listing does not hand either the secret or the hash back.
  const listed = await users.tokens!('ana');
  expect(listed).toEqual([{ id: minted.id, user: 'ana', label: 'laptop', created: minted.created }]);
  expect(JSON.stringify(listed)).not.toContain(minted.secret);
  expect(JSON.stringify(listed)).not.toContain('sha256');
});

it('makes an id again when base64url spells the first with a leading hyphen', async () => {
  // A first byte from `0xf8` to `0xfb` is spelled `-` in base64url, which a
  // command line reads as the start of an option: `token rm -AAAAAAA` is not a revoke.
  const hyphen = Buffer.from([0xf8, 0, 0, 0, 0, 0]);
  expect(hyphen.toString('base64url')).toBe('-AAAAAAA');
  nextBytes.waiting.push(hyphen, Buffer.from([0, 0, 0, 0, 0, 0]));

  const users = open();
  await users.add('ana', ['member']);
  const minted = await users.mintToken!('ana', { label: 'laptop' });

  // The second id is kept, and the secret is still 32 real bytes.
  expect(minted.id).toBe('AAAAAAAA');
  expect(minted.secret).toHaveLength(43);
  expect(stored().tokens[0]?.id).toBe('AAAAAAAA');

  // And the id the mint answered revokes it, which is what `token rm` takes.
  expect(await users.revokeToken!(minted.id)).toBe(true);
  expect(await users.tokens!('ana')).toEqual([]);
});

it('leaves the users file untouched through a mint and a revoke', async () => {
  const users = open();
  await users.add('ana', ['member']);
  const before = readFileSync(path, 'utf8');

  const minted = await users.mintToken!('ana');
  expect(readFileSync(path, 'utf8')).toBe(before);

  expect(await users.revokeToken!(minted.id)).toBe(true);
  expect(readFileSync(path, 'utf8')).toBe(before);
});

it('refuses the eleventh token by default, and counts each person on their own', async () => {
  const users = open();
  await users.add('ana', ['member']);
  await users.add('beto', ['member']);
  for (let one = 0; one < 10; one += 1) await users.mintToken!('ana');

  await expect(users.mintToken!('ana')).rejects.toThrow(/10 tokens at most/);
  // Another person is not held back by what ana holds.
  await expect(users.mintToken!('beto')).resolves.toMatchObject({ user: 'beto' });
  expect((await users.tokens!('ana')).length).toBe(10);
});

it("takes the host's limit, and refuses the third when it is two", async () => {
  const users = open({ tokensPerPerson: 2 });
  await users.add('ana', ['member']);
  await users.mintToken!('ana');
  await users.mintToken!('ana');

  await expect(users.mintToken!('ana')).rejects.toThrow(/2 tokens at most/);
  expect((await users.tokens!('ana')).length).toBe(2);
});

it('does not count an expired token against the limit, and still lists it', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  const users = open({ tokensPerPerson: 1 });
  await users.add('ana', ['member']);
  const first = await users.mintToken!('ana', { expires: Date.now() + 1000 });

  await expect(users.mintToken!('ana')).rejects.toThrow(/1 tokens at most/);
  vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
  await expect(users.mintToken!('ana')).resolves.toMatchObject({ user: 'ana' });
  // The expired one is still in the listing, so its person can revoke it.
  expect((await users.tokens!('ana')).map((one) => one.id)).toContain(first.id);
});

it('refuses a grant its person does not hold, and names the grant', async () => {
  const users = open();
  await users.add('ana', ['member']);

  await expect(users.mintToken!('ana', { grants: ['user:write'] })).rejects.toThrow('user:write');
  // What the person does hold is accepted, and kept on the token.
  const minted = await users.mintToken!('ana', { grants: ['file:read'] });
  expect(minted.grants).toEqual(['file:read']);
  expect(stored().tokens[0]?.grants).toEqual(['file:read']);
});

it('mints a key that carries the scope its calls are charged to', async () => {
  const users = open();
  await users.addTeam('backend');
  await users.addProject('ahpd');
  await users.addProject('cofold');
  await users.add('ana', ['member'], { memberships: ['backend:*'] });

  // A project under `team:*` is a place the person is in, and the key keeps
  // the name it was minted with.
  const minted = await users.mintToken!('ana', { scope: 'backend:ahpd' });
  expect(minted.scope).toBe('backend:ahpd');
  expect(stored().tokens[0]?.scope).toBe('backend:ahpd');
  expect((await users.tokens!('ana'))[0]?.scope).toBe('backend:ahpd');
  // What the mint answered is what the secret signs in with.
  const held = await users.verify(minted.secret);
  expect(held?.token).toBe(minted.id);

  // A key without a scope carries none, as every key did before.
  const plain = await users.mintToken!('ana');
  expect(plain.scope).toBeUndefined();
  expect(stored().tokens[1]).not.toHaveProperty('scope');
});

it('refuses a scope the person is not in now, and one that names a wildcard', async () => {
  const users = open();
  await users.addTeam('backend');
  await users.addTeam('sales');
  await users.addProject('ahpd');
  await users.add('ana', ['member'], { memberships: ['backend:*'] });

  // The refusal is the one every call gives, naming what may be named.
  await expect(users.mintToken!('ana', { scope: 'sales:ahpd' }))
    .rejects.toThrow('ana may name backend:ahpd');
  // A wildcard is not a place to charge, and neither is a word that is no scope.
  await expect(users.mintToken!('ana', { scope: 'backend:*' }))
    .rejects.toThrow('backend:* is not a scope: a scope is team or team:project');
  await expect(users.mintToken!('ana', { scope: '' }))
    .rejects.toThrow('is not a scope: a scope is team or team:project');
  expect(await users.tokens!()).toEqual([]);
});

it('refuses a scope on a host that names no team', async () => {
  const users = open();
  await users.add('ana', ['member']);
  await expect(users.mintToken!('ana', { scope: 'backend:ahpd' }))
    .rejects.toThrow('this host names no team, so a key has no scope to carry');
  expect(await users.tokens!()).toEqual([]);
});

it('reads a tokens file whose scope is not a place as no tokens at all', async () => {
  writeFileSync(path, JSON.stringify({ users: [{ id: 'ana', roles: ['member'], token: '' }] }));
  for (const scope of ['backend:*', ':ahpd', 'backend:', '', 3]) {
    writeFileSync(tokensPath, JSON.stringify({
      tokens: [{ id: 't1', user: 'ana', created: 1, token: 'sha256:0', scope }],
    }));
    const said: string[] = [];
    const users = open({ onProblem: (one) => said.push(one) });
    expect(await users.tokens!(), String(scope)).toEqual([]);
    expect(said.some((one) => one.includes('has a scope that is not team or team:project')), String(scope)).toBe(true);
  }
});

it('mints a key with its limits, pooled shared, and reads them back', async () => {
  const users = open();
  await users.add('ana', ['member']);
  const limits = [
    { amount: 5, measure: 'usd', period: 'day', pool: 'shared' } as const,
    { amount: 100, measure: 'calls', period: 'day', pool: 'shared' } as const,
  ];
  const minted = await users.mintToken!('ana', { limits });

  expect(minted.limits).toEqual(limits);
  expect((await users.tokens!('ana'))[0]?.limits).toEqual(limits);
  expect(stored().tokens[0]?.limits).toEqual(limits);
});

it('mints a key with its meta, and refuses one that is not', async () => {
  const users = open();
  await users.add('ana', ['member']);
  const meta = { env: 'prod', client: 'pi' };
  const minted = await users.mintToken!('ana', { meta });

  expect(minted.meta).toEqual(meta);
  expect((await users.tokens!('ana'))[0]?.meta).toEqual(meta);
  expect(stored().tokens[0]?.meta).toEqual(meta);

  // A name outside the bounds is refused, and no token is written.
  await expect(users.mintToken!('ana', { meta: { 'a b': '1' } }))
    .rejects.toThrow('is 1 to 64 characters of A to Z');
  expect(stored().tokens).toHaveLength(1);
});

it('reports a tokens file holding a meta that is not one as broken', async () => {
  writeFileSync(path, JSON.stringify({ users: [{ id: 'ana', roles: ['member'] }] }));
  writeFileSync(tokensPath, JSON.stringify({
    tokens: [{ id: 'aaaa', user: 'ana', created: 1, token: 'sha256:abc', meta: { env: 1 } }],
  }));
  const said: string[] = [];
  const users = open({ onProblem: (one) => said.push(one) });

  expect(await users.tokens!()).toEqual([]);
  expect(said.some((one) => one.includes('holds a meta that is not one'))).toBe(true);
});

it('reports a tokens file holding a limit that is not one as broken', async () => {
  writeFileSync(path, JSON.stringify({ users: [{ id: 'ana', roles: ['member'] }] }));
  writeFileSync(tokensPath, JSON.stringify({
    tokens: [{
      id: 'aaaa',
      user: 'ana',
      created: 1,
      token: 'sha256:abc',
      limits: [{ amount: 5, measure: 'turns', period: 'day', pool: 'shared' }],
    }],
  }));
  const said: string[] = [];
  const users = open({ onProblem: (one) => said.push(one) });

  expect(await users.tokens!()).toEqual([]);
  expect(said.some((one) => one.includes('limits that are not ones'))).toBe(true);
});

it('refuses an unknown person, and an expires that is not a future date', async () => {
  const users = open();
  await expect(users.mintToken!('nobody')).rejects.toThrow('no user called nobody');

  await users.add('ana', ['member']);
  await expect(users.mintToken!('ana', { expires: Date.now() - 1 })).rejects.toThrow(/not in the future/);
  await expect(users.mintToken!('ana', { expires: Number.NaN })).rejects.toThrow(/not a date/);
});

it('revokes one token and answers false for an id the file does not hold', async () => {
  const users = open();
  await users.add('ana', ['member']);
  const first = await users.mintToken!('ana');
  const second = await users.mintToken!('ana');

  expect(await users.revokeToken!(first.id)).toBe(true);
  expect((await users.tokens!('ana')).map((one) => one.id)).toEqual([second.id]);
  expect(await users.revokeToken!(first.id)).toBe(false);
  expect(await users.tokens!()).toHaveLength(1);
});

it("drops a person's tokens when the person is removed, and adding them back gets none", async () => {
  const users = open();
  await users.add('ana', ['member']);
  await users.mintToken!('ana');
  await users.mintToken!('ana');

  expect(await users.remove('ana')).toBe(true);
  expect(await users.tokens!()).toEqual([]);

  await users.add('ana', ['member']);
  expect(await users.tokens!('ana')).toEqual([]);
  expect(stored().tokens).toEqual([]);
});

it('lists tokens by created, for one person or everybody', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  const users = open();
  await users.add('ana', ['member']);
  await users.add('beto', ['member']);
  const first = await users.mintToken!('ana');
  vi.setSystemTime(new Date('2026-01-01T00:00:01Z'));
  const later = await users.mintToken!('ana');
  vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
  const other = await users.mintToken!('beto');

  expect((await users.tokens!()).map((one) => one.id)).toEqual([first.id, later.id, other.id]);
  expect((await users.tokens!('ana')).map((one) => one.id)).toEqual([first.id, later.id]);
});

it('reads a malformed tokens file as no tokens and refuses to write over it', async () => {
  writeFileSync(path, JSON.stringify({ users: [{ id: 'ana', roles: ['member'], token: '' }] }));
  writeFileSync(tokensPath, 'not json at all');
  const said: string[] = [];
  const users = open({ onProblem: (one) => said.push(one) });

  expect(await users.tokens!()).toEqual([]);
  expect(said.some((one) => one.includes('not a tokens file'))).toBe(true);
  await expect(users.mintToken!('ana')).rejects.toThrow(/not a tokens file/);
  // The hand that broke it may fix it: the file is left as it was.
  expect(readFileSync(tokensPath, 'utf8')).toBe('not json at all');
  // Said once, however often the file is read.
  expect(said.filter((one) => one.includes('not a tokens file'))).toHaveLength(1);
});

// `0600` is a POSIX file mode. Windows keeps only a read-only flag.
it.skipIf(!posix)('writes the tokens file owner-only', async () => {
  const users = open();
  await users.add('ana', ['member']);
  await users.mintToken!('ana');

  expect(statSync(tokensPath).mode & 0o777).toBe(0o600);
});

it('verifies a minted secret as its person, with the token id', async () => {
  const users = open();
  await users.add('ana', ['member']);
  const full = await users.mint('ana');
  const minted = await users.mintToken!('ana');

  const held = await users.verify(minted.secret);
  expect(held?.id).toBe('ana');
  expect(held?.token).toBe(minted.id);
  expect(held?.can('file:read')).toBe(true);
  // The person's full secret is not a minted token, and carries no id.
  expect((await users.verify(full))?.token).toBeUndefined();
});

it('answers only the grants both the token and its person hold', async () => {
  const users = open();
  await users.add('ana', ['member']);
  const minted = await users.mintToken!('ana', { grants: ['proxy:write'] });
  const held = await users.verify(minted.secret);

  // The token was minted for proxy calls alone, though ana may do more.
  expect(held?.can('proxy:call')).toBe(true);
  expect(held?.can('session:write')).toBe(false);

  // A role taken away takes the token's reach with it.
  await users.add('ana', ['guest']);
  expect(held?.can('proxy:call')).toBe(false);

  // And a role added does not widen the token past the list it was minted for.
  await users.add('ana', ['admin']);
  expect(held?.can('proxy:call')).toBe(true);
  expect(held?.can('session:write')).toBe(false);
});

it('reads a token with no grants as every grant its person holds now', async () => {
  const users = open();
  await users.add('ana', ['member']);
  const minted = await users.mintToken!('ana');
  const held = await users.verify(minted.secret);

  expect(held?.can('file:read')).toBe(true);
  await users.add('ana', ['guest']);
  expect(held?.can('file:read')).toBe(false);
  expect(held?.can('session:read')).toBe(true);
});

it('answers false once the token is revoked, and its secret no longer verifies', async () => {
  const users = open();
  await users.add('ana', ['member']);
  const minted = await users.mintToken!('ana');
  const held = await users.verify(minted.secret);
  expect(held?.standing?.()).toBe(true);

  expect(await users.revokeToken!(minted.id)).toBe(true);
  expect(held?.standing?.()).toBe(false);
  expect(held?.can('file:read')).toBe(false);
  expect(await users.verify(minted.secret)).toBeUndefined();
});

it('ends at the token expiry for standing, can and verify', async () => {
  vi.useFakeTimers();
  const now = new Date('2026-01-01T00:00:00Z').getTime();
  vi.setSystemTime(now);
  const users = open();
  await users.add('ana', ['member']);
  const minted = await users.mintToken!('ana', { expires: now + 1000 });
  const held = await users.verify(minted.secret);
  expect(held?.expiresAt).toBe(now + 1000);
  expect(held?.standing?.()).toBe(true);

  vi.setSystemTime(now + 2000);
  expect(held?.standing?.()).toBe(false);
  expect(held?.can('file:read')).toBe(false);
  expect(await users.verify(minted.secret)).toBeUndefined();
});

it('answers nothing for a token whose person was removed', async () => {
  const users = open();
  await users.add('ana', ['member']);
  const minted = await users.mintToken!('ana');
  const held = await users.verify(minted.secret);

  expect(await users.remove('ana')).toBe(true);
  expect(await users.verify(minted.secret)).toBeUndefined();
  expect(held?.standing?.()).toBe(false);
  expect(held?.can('file:read')).toBe(false);
});

it('mints a team key that names its team and no person', async () => {
  const users = open();
  await users.addTeam('backend');
  const minted = await users.mintToken!(undefined, { team: 'backend', grants: ['proxy:call'], label: 'bot' });

  expect(minted.team).toBe('backend');
  expect(minted.user).toBeUndefined();
  expect(minted.scope).toBe('backend');
  expect(minted.label).toBe('bot');
  const [record] = stored().tokens;
  expect(record?.team).toBe('backend');
  expect(record).not.toHaveProperty('user');
  expect(record?.grants).toEqual(['proxy:call']);
  // The listing hands back the same record, with the team on it.
  expect((await users.tokens!())[0]?.team).toBe('backend');
});

it('answers nothing for a team key at verify, and its team at verifyTeamKey', async () => {
  const users = open();
  await users.addTeam('backend');
  await users.add('ana', ['member']);
  const team = await users.mintToken!(undefined, { team: 'backend', grants: ['proxy:call'] });
  const person = await users.mintToken!('ana');

  // The two doors are disjoint: a team key is no person, and a person's key is
  // no team.
  expect(await users.verify(team.secret)).toBeUndefined();
  expect(await users.verifyTeamKey!(person.secret)).toBeUndefined();

  const held = await users.verifyTeamKey!(team.secret);
  expect(held?.id).toBe('team:backend');
  expect(held?.team).toBe('backend');
  expect(held?.token).toBe(team.id);
  expect(held?.roles).toEqual([]);
  // Only the proxy's grants, and only the ones the key was minted with.
  expect(held?.can('proxy:call')).toBe(true);
  expect(held?.can('proxy:models')).toBe(false);
  expect(held?.can('session:read')).toBe(false);
  expect(held?.can('*:*')).toBe(false);
  // Its scope is the team, and scopeFor resolves a call to it.
  expect(held?.keyScope).toBe('backend');
  expect(held?.memberships).toEqual(['backend']);
  expect(scopeFor(held)).toEqual({ scope: { team: 'backend' } });
});

it('removes a team\'s keys with the team, so a team added back has none', async () => {
  const users = open();
  await users.addTeam('backend');
  await users.addTeam('ops');
  const gone = await users.mintToken!(undefined, { team: 'backend', grants: ['proxy:call'] });
  const kept = await users.mintToken!(undefined, { team: 'ops', grants: ['proxy:call'] });

  expect(await users.removeTeam('backend')).toBe(true);
  await users.addTeam('backend');
  expect(await users.verifyTeamKey!(gone.secret)).toBeUndefined();
  expect((await users.tokens!()).map((one) => one.id)).toEqual([kept.id]);
  expect((await users.verifyTeamKey!(kept.secret))?.team).toBe('ops');
});

it('gives a team key a project of its team as its scope', async () => {
  const users = open();
  await users.addTeam('backend');
  await users.addProject('ahpd');
  const minted = await users.mintToken!(undefined, { team: 'backend', grants: ['proxy:call'], scope: 'backend:ahpd' });
  const held = await users.verifyTeamKey!(minted.secret);

  expect(held?.keyScope).toBe('backend:ahpd');
  expect(held?.memberships).toEqual(['backend', 'backend:ahpd']);
  expect(scopeFor(held)).toEqual({ scope: { team: 'backend', project: 'ahpd' } });
});

it('answers nothing for a team key that expired, or whose team was removed', async () => {
  vi.useFakeTimers();
  const now = new Date('2026-01-01T00:00:00Z').getTime();
  vi.setSystemTime(now);
  const users = open();
  await users.addTeam('backend');
  await users.addTeam('sales');
  const short = await users.mintToken!(undefined, { team: 'backend', grants: ['proxy:call'], expires: now + 1000 });
  const gone = await users.mintToken!(undefined, { team: 'sales', grants: ['proxy:call'] });
  const held = await users.verifyTeamKey!(short.secret);
  expect(held?.standing?.()).toBe(true);

  vi.setSystemTime(now + 2000);
  expect(held?.standing?.()).toBe(false);
  expect(held?.can('proxy:call')).toBe(false);
  expect(await users.verifyTeamKey!(short.secret)).toBeUndefined();

  expect(await users.removeTeam('sales')).toBe(true);
  expect(await users.verifyTeamKey!(gone.secret)).toBeUndefined();
});

it('refuses a team key the host cannot mint', async () => {
  const users = open({ tokensPerPerson: 2 });
  await users.addTeam('backend');
  await users.addTeam('sales');
  await users.addProject('ahpd');
  await users.add('ana', ['member']);

  await expect(users.mintToken!(undefined, { team: 'nope', grants: ['proxy:call'] }))
    .rejects.toThrow('no team called nope');
  // A team holds neither every grant nor one outside the proxy's two.
  await expect(users.mintToken!(undefined, { team: 'backend' }))
    .rejects.toThrow('names none');
  await expect(users.mintToken!(undefined, { team: 'backend', grants: ['proxy:call', 'session:read'] }))
    .rejects.toThrow('session:read is not a grant a team key may hold');
  // A person and a team in one mint is a caller that did not say which.
  await expect(users.mintToken!('ana', { team: 'backend', grants: ['proxy:call'] }))
    .rejects.toThrow('a token names a user or a team, not both');
  // The scope is its team or a project of it, and nothing else.
  await expect(users.mintToken!(undefined, { team: 'backend', grants: ['proxy:call'], scope: 'sales:ahpd' }))
    .rejects.toThrow('sales:ahpd names another team');
  await expect(users.mintToken!(undefined, { team: 'backend', grants: ['proxy:call'], scope: 'backend:web' }))
    .rejects.toThrow('backend:web is not a project this host names');
  expect(await users.tokens!()).toEqual([]);
});

it('counts a team key against the same limit as a person', async () => {
  const users = open({ tokensPerPerson: 2 });
  await users.addTeam('backend');
  await users.mintToken!(undefined, { team: 'backend', grants: ['proxy:call'] });
  await users.mintToken!(undefined, { team: 'backend', grants: ['proxy:models'] });

  await expect(users.mintToken!(undefined, { team: 'backend', grants: ['proxy:call'] }))
    .rejects.toThrow('team backend may hold 2 tokens at most');
  expect((await users.tokens!()).filter((one) => one.team === 'backend')).toHaveLength(2);
});

it('reads a token record naming both a user and a team, or neither, as broken', async () => {
  writeFileSync(path, JSON.stringify({ users: [{ id: 'ana', roles: ['member'], token: '' }] }));
  const broken = [
    { user: 'ana', team: 'backend' },
    {},
    { user: 'ana', team: 3 },
    { user: 'ana', team: '' },
    { user: 3 },
  ];
  for (const owner of broken) {
    writeFileSync(tokensPath, JSON.stringify({
      tokens: [{ id: 't1', ...owner, created: 1, token: 'sha256:0' }],
    }));
    const said: string[] = [];
    const users = open({ onProblem: (one) => said.push(one) });
    expect(await users.tokens!(), JSON.stringify(owner)).toEqual([]);
    expect(said.some((one) => one.includes('names')), JSON.stringify(owner)).toBe(true);
  }
});

it('compares every hash in one pass, for a match and for a miss', async () => {
  const users = open();
  await users.add('ana', ['member']);
  await users.add('beto', ['member']);
  // ana has a hash on her record, beto has none, and there are three tokens.
  await users.mint('ana');
  const first = await users.mintToken!('ana');
  await users.mintToken!('ana');
  await users.mintToken!('beto');
  const counted = vi.mocked(same);
  const every = 5;

  counted.mockClear();
  expect((await users.verify(first.secret))?.token).toBe(first.id);
  expect(counted).toHaveBeenCalledTimes(every);

  // A miss costs the same, and is kept as a miss rather than returned early.
  counted.mockClear();
  expect(await users.verify('nobody')).toBeUndefined();
  expect(counted).toHaveBeenCalledTimes(every);
});
