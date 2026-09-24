import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fileUsers, signInRecord } from '../packages/sdk/src/users.js';
import { githubIssuer, isIssuerUrl, issuerFrom, issuerKind, oidcIssuer } from '../packages/sdk/src/issuers.js';
import type { Fetcher } from '../packages/sdk/src/issuers.js';
import type { Issuer } from '../packages/sdk/src/types/users.js';

/*
 * A credential this host did not mint.
 *
 * The host is its own issuer and compares a hash, which a client that only
 * acquires tokens through an OAuth provider cannot use. These cases are about
 * the second way in: an issuer says who a token belongs to, and the file still
 * says what they may do.
 *
 * No network: every case stands a `fetch` in, so what is under test is the
 * asking and the matching, and a failure is a wrong answer rather than a slow
 * one.
 */

let root: string;
let path: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-issuer-'));
  path = join(root, 'users.json');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** A `fetch` that answers from a table and keeps the questions it was asked. */
const answering = (answers: Record<string, unknown>): { fetch: Fetcher; seen: string[] } => {
  const seen: string[] = [];
  const fetch: Fetcher = async (url) => {
    seen.push(url);
    const held = answers[url];
    if (held === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => held };
  };
  return { fetch, seen };
};

const GITHUB = 'https://api.github.com/user';

/** An issuer with no network: it answers a table, and says it was asked. */
const pretending = (id: string, answers: Record<string, string>, seen: string[] = []): Issuer => ({
  id,
  scopes: ['openid'],
  who: async (token) => {
    seen.push(id);
    const subject = answers[token];
    return subject === undefined ? undefined : { subject, claims: {} };
  },
});

/** An issuer that answers with claims as well, which is what `rolesFrom` reads. */
const claiming = (
  id: string,
  answers: Record<string, { subject: string; claims?: Record<string, unknown> }>,
): Issuer => ({
  id,
  scopes: ['openid'],
  who: async (token) => {
    const held = answers[token];
    return held === undefined ? undefined : { subject: held.subject, claims: held.claims ?? {} };
  },
});

/** A user file written by hand, which is how a record gets an issuer. */
const wrote = (file: unknown): void => { writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`); };

it('asks GitHub who a token belongs to, and answers with the login', async () => {
  const { fetch, seen } = answering({ [GITHUB]: { login: 'ana' } });
  const issuer = githubIssuer({ fetch });

  expect((await issuer.who('gho_secret'))?.subject).toBe('ana');
  expect(issuer.id).toBe('https://github.com/login/oauth');
  expect(issuer.scopes).toEqual(['read:user']);
  expect(seen).toEqual([GITHUB]);
});

it('answers nobody for a token the issuer refuses', async () => {
  // A 401 from GitHub is a token that is not anybody's, not an error here.
  const { fetch } = answering({});
  expect(await githubIssuer({ fetch }).who('nope')).toBeUndefined();
});

it('answers nobody when the issuer cannot be reached, and does not throw', async () => {
  const fetch: Fetcher = async () => { throw new Error('offline'); };
  expect(await githubIssuer({ fetch }).who('gho_secret')).toBeUndefined();
});

it('matches an issuer subject against a record and keeps its roles', async () => {
  const { fetch } = answering({ [GITHUB]: { login: 'ana' } });
  const users = fileUsers({ path, issuer: 'github', issuerFor: () => githubIssuer({ fetch }) });
  await users.add('ana', ['admin']);
  // A record with an issuer and no minted secret: `add` leaves the hash empty,
  // so this person can only arrive through the issuer.
  expect((await users.list())[0]).toEqual({ id: 'ana', roles: ['admin'], grants: ['*:*'], trusted: false, issuer: 'github' });

  const held = await users.verify('gho_secret');
  expect(held?.id).toBe('ana');
  expect(held?.can('session:write')).toBe(true);
});

it('answers nobody for a subject no record names', async () => {
  const { fetch } = answering({ [GITHUB]: { login: 'stranger' } });
  const users = fileUsers({ path, issuer: 'github', issuerFor: () => githubIssuer({ fetch }) });
  await users.add('ana', ['admin']);
  expect(await users.verify('gho_secret')).toBeUndefined();
});

it('checks a minted secret first, and never asks the issuer for it', async () => {
  const { fetch, seen } = answering({ [GITHUB]: { login: 'ana' } });
  const users = fileUsers({ path, issuer: 'github', issuerFor: () => githubIssuer({ fetch }) });
  await users.add('ana', ['member']);
  const secret = await users.mint('ana');

  const held = await users.verify(secret);
  expect(held?.id).toBe('ana');
  expect(held?.can('file:write')).toBe(true);
  // The local hash answered, so the issuer was never consulted: a deployment
  // that mints secrets does not depend on a network it may not have.
  expect(seen).toEqual([]);
});

it('lets a record name its own issuer, and keeps the host default for the rest', async () => {
  const HOST = 'https://host.test';
  const OTHER = 'https://other.test';
  const seen: string[] = [];
  wrote({
    users: [
      { id: 'ana', roles: ['admin'], token: '' },
      { id: 'sam', roles: ['member'], token: '', issuer: OTHER },
    ],
  });
  const users = fileUsers({
    path,
    issuer: HOST,
    issuerFor: (name) => pretending(name, name === HOST ? { 'host-token': 'ana' } : { 'other-token': 'sam' }, seen),
  });

  expect((await users.verify('host-token'))?.id).toBe('ana');
  expect((await users.verify('other-token'))?.id).toBe('sam');
  // The host's issuer was asked about both, because which provider minted a
  // token is not something the token says; the second one answered only for sam.
  expect(seen).toEqual([HOST, HOST, OTHER]);
});

it('does not let the host default stand in for a record that names its own', async () => {
  const HOST = 'https://host.test';
  const OTHER = 'https://other.test';
  const seen: string[] = [];
  // The host's issuer happens to answer sam, but sam signs in somewhere else.
  wrote({
    users: [
      { id: 'ana', roles: ['member'], token: '' },
      { id: 'sam', roles: ['member'], token: '', issuer: OTHER },
    ],
  });
  const users = fileUsers({
    path,
    issuer: HOST,
    issuerFor: (name) => pretending(name, name === HOST ? { 'host-token': 'sam' } : {}, seen),
  });

  expect(await users.verify('host-token')).toBeUndefined();
  expect(seen).toEqual([HOST, OTHER]);
});

it('advertises every provider a record names, and the union of their scopes', async () => {
  const HOST = 'https://host.test';
  const OTHER = 'https://other.test';
  wrote({
    users: [
      { id: 'ana', roles: ['admin'], token: '' },
      { id: 'sam', roles: ['member'], token: '', issuer: OTHER },
    ],
  });
  const users = fileUsers({
    path,
    issuer: HOST,
    // A record that asks for different scopes is how a provider wants them asked.
    issuerFor: (name) => ({ ...pretending(name, {}), scopes: name === HOST ? ['read:user'] : ['openid'] }),
  });

  expect(users.resource.authorization_servers).toEqual([HOST, OTHER]);
  expect(users.resource.scopes_supported).toEqual(['read:user', 'openid']);
  expect(users.resource.resource).toBe('ahpd://users');
});

it('keeps a record\'s issuer when a role or a secret is written', async () => {
  const OTHER = 'https://other.test';
  wrote({ users: [{ id: 'sam', roles: ['member'], token: '', issuer: OTHER }] });
  const users = fileUsers({
    path,
    issuerFor: (name) => pretending(name, { 'other-token': 'sam' }),
  });

  const secret = await users.mint('sam');
  await users.add('sam', ['admin']);
  expect(JSON.parse(readFileSync(path, 'utf8')).users[0].issuer).toBe(OTHER);
  // The minted secret is compared first, so this needs no issuer at all.
  expect((await users.verify(secret))?.id).toBe('sam');
  expect((await users.list())[0]).toMatchObject({ id: 'sam', issuer: OTHER });
});

it('reports a record that names an issuer this host may not reach, once', async () => {
  const said: string[] = [];
  wrote({ users: [{ id: 'ana', roles: ['member'], token: '', issuer: 'nope' }] });
  const users = fileUsers({ path, issuerFor: () => undefined, onProblem: (line) => said.push(line) });

  expect(await users.verify('anything')).toBeUndefined();
  expect(users.resource.authorization_servers).toBeUndefined();
  expect(said).toEqual(['issuer nope is neither github nor an issuer URL this host may reach']);
});

it('discovers an OpenID Connect endpoint once, and takes the subject from it', async () => {
  const discovery = 'https://idp.test/.well-known/openid-configuration';
  const userinfo = 'https://idp.test/userinfo';
  const { fetch, seen } = answering({
    [discovery]: { userinfo_endpoint: userinfo },
    [userinfo]: { sub: 'sam' },
  });
  const issuer = oidcIssuer({ issuer: 'https://idp.test', fetch });

  expect((await issuer.who('at-1'))?.subject).toBe('sam');
  expect((await issuer.who('at-2'))?.subject).toBe('sam');
  expect(issuer.id).toBe('https://idp.test');
  expect(issuer.scopes).toEqual(['openid']);
  // The metadata answered once and was kept; the userinfo endpoint was asked
  // per token, which is the one call that has to be per token.
  expect(seen).toEqual([discovery, userinfo, userinfo]);
});

it('refuses a userinfo endpoint that is neither https nor loopback', async () => {
  // The document is remote, and a person's token must not go out in clear.
  const discovery = 'https://idp.test/.well-known/openid-configuration';
  const { fetch, seen } = answering({ [discovery]: { userinfo_endpoint: 'http://idp.test/userinfo' } });
  expect(await oidcIssuer({ issuer: 'https://idp.test', fetch }).who('at-1')).toBeUndefined();
  expect(seen).toEqual([discovery]);
});

it('accepts a plain-http endpoint on loopback, where nothing leaves the machine', async () => {
  const discovery = 'http://127.0.0.1:9310/.well-known/openid-configuration';
  const userinfo = 'http://127.0.0.1:9310/userinfo';
  const { fetch, seen } = answering({ [discovery]: { userinfo_endpoint: userinfo }, [userinfo]: { sub: 'ana' } });
  const issuer = oidcIssuer({ issuer: 'http://127.0.0.1:9310', fetch });

  expect((await issuer.who('ana'))?.subject).toBe('ana');
  expect(seen).toEqual([discovery, userinfo]);
});

it('knows which issuer URLs this host will reach', () => {
  expect(isIssuerUrl('https://idp.test')).toBe(true);
  expect(isIssuerUrl('https://idp.test/path')).toBe(true);
  expect(isIssuerUrl('http://127.0.0.1:9310')).toBe(true);
  expect(isIssuerUrl('http://localhost:9310')).toBe(true);
  expect(isIssuerUrl('http://[::1]:9310')).toBe(true);
  // Everything else over plain http is refused, and https is refused a
  // fragment because an RFC 8414 issuer identifier has none.
  expect(isIssuerUrl('http://idp.test')).toBe(false);
  expect(isIssuerUrl('http://192.168.1.5:9310')).toBe(false);
  expect(isIssuerUrl('https://idp.test/#fragment')).toBe(false);
  expect(isIssuerUrl('idp.test')).toBe(false);
});

it('puts the issuer on the record, and leaves it off when there is none', async () => {
  const plain = signInRecord('https://ahpd.test/');
  expect(plain).not.toHaveProperty('authorization_servers');
  expect(plain).not.toHaveProperty('scopes_supported');

  const withIssuer = signInRecord('https://ahpd.test/', githubIssuer({ fetch: answering({}).fetch }));
  expect(withIssuer.authorization_servers).toEqual(['https://github.com/login/oauth']);
  expect(withIssuer.scopes_supported).toEqual(['read:user']);
  expect(withIssuer.resource).toBe('https://ahpd.test/');
  expect(withIssuer.resource_documentation).toBe('https://github.com/softov/ahpd/blob/main/docs/USERS.md');
});

it('names every provider when there is more than one, with the scopes of all of them', () => {
  const both = signInRecord(
    'https://ahpd.test/',
    githubIssuer({ fetch: answering({}).fetch }),
    oidcIssuer({ issuer: 'https://idp.test', userinfo: 'https://idp.test/userinfo', fetch: answering({}).fetch }),
  );
  expect(both.authorization_servers).toEqual(['https://github.com/login/oauth', 'https://idp.test']);
  expect(both.scopes_supported).toEqual(['read:user', 'openid']);
});

it('builds what a name means, the one way a configuration and a record both use', () => {
  expect(issuerKind('github')).toEqual({ kind: 'github' });
  expect(issuerKind('https://idp.test')).toEqual({ kind: 'oidc', issuer: 'https://idp.test' });
  // The remote http case is the one both halves must agree to refuse.
  expect(issuerKind('http://idp.test')).toBeUndefined();
  expect(issuerFrom('github')?.id).toBe('https://github.com/login/oauth');
  expect(issuerFrom('https://idp.test')?.id).toBe('https://idp.test');
  expect(issuerFrom('nope')).toBeUndefined();
});

it('answers the whole claim set, so a record can read roles out of it', async () => {
  const { fetch } = answering({ [GITHUB]: { login: 'ana', company: 'acme' } });
  const held = await githubIssuer({ fetch }).who('gho_secret');
  expect(held?.subject).toBe('ana');
  expect(held?.claims).toEqual({ login: 'ana', company: 'acme' });
});

it('sets a record\'s issuer from add, and refuses one nothing can resolve', async () => {
  const users = fileUsers({
    path,
    issuer: 'https://host.test',
    issuerFor: (name) => pretending(name, {}),
  });
  await users.add('ana', ['member'], { issuer: 'https://other.test' });
  expect((await users.list())[0]).toMatchObject({ id: 'ana', issuer: 'https://other.test' });

  // Adding a role without naming an issuer leaves the provider alone.
  await users.add('ana', ['admin']);
  expect((await users.list())[0]).toMatchObject({ id: 'ana', roles: ['admin'], issuer: 'https://other.test' });

  const bad = fileUsers({ path });
  await expect(bad.add('sam', ['guest'], { issuer: 'nope' }))
    .rejects.toThrow('no issuer called nope; this host takes github or an issuer URL it may reach');
});

it('adds the roles an issuer\'s claim names to the ones on the record', async () => {
  wrote({ roles: { operators: ['*:*'] }, users: [{ id: 'ana', roles: ['guest'], token: '', issuer: 'https://idp.test', rolesFrom: 'groups' }] });
  const users = fileUsers({
    path,
    issuerFor: () => claiming('https://idp.test', {
      'at-1': { subject: 'ana', claims: { groups: ['operators'] } },
    }),
  });

  const held = await users.verify('at-1');
  expect(held?.id).toBe('ana');
  expect(held?.roles).toEqual(['guest', 'operators']);
  // Both halves: the record's own `guest` and the claim's `operators`.
  expect(held?.can('automation:read')).toBe(true);
  expect(held?.can('file:write')).toBe(true);
});

it('reads a claim that is one string, reports a value that names no role, and forgives an absent claim', async () => {
  const said: string[] = [];
  wrote({ users: [
    { id: 'ana', roles: ['guest'], token: '', issuer: 'https://idp.test', rolesFrom: 'groups' },
    { id: 'sam', roles: ['guest'], token: '', issuer: 'https://idp.test', rolesFrom: 'groups' },
    { id: 'eve', roles: ['guest'], token: '', issuer: 'https://idp.test', rolesFrom: 'groups' },
  ] });
  const users = fileUsers({
    path,
    issuerFor: () => claiming('https://idp.test', {
      'one': { subject: 'ana', claims: { groups: 'member' } },
      'two': { subject: 'sam', claims: { groups: ['nope', 'admin'] } },
      'three': { subject: 'eve', claims: {} },
    }),
    onProblem: (line) => said.push(line),
  });

  expect((await users.verify('one'))?.roles).toEqual(['guest', 'member']);
  // The one that names nothing is dropped, and the one that does is kept.
  expect((await users.verify('two'))?.roles).toEqual(['guest', 'admin']);
  expect(said).toEqual(['user sam has groups nope, which names no role this host defines']);
  // An issuer that omits the claim is answering, not refusing.
  expect((await users.verify('three'))?.roles).toEqual(['guest']);
});

it('keeps the file\'s roles live and the claim\'s from sign-in', async () => {
  wrote({ roles: { operators: ['file:read'] }, users: [{ id: 'ana', roles: ['guest'], token: '', issuer: 'https://idp.test', rolesFrom: 'groups' }] });
  const users = fileUsers({
    path,
    issuerFor: () => claiming('https://idp.test', { 'at-1': { subject: 'ana', claims: { groups: ['operators'] } } }),
  });

  const held = await users.verify('at-1');
  expect(held?.can('file:read')).toBe(true);
  expect(held?.can('file:write')).toBe(false);
  // The file moves: the record's own role is resolved again, and the claim's
  // grants are the ones sign-in stamped.
  wrote({
    roles: { operators: ['file:write'], watcher: ['terminal:read'] },
    users: [{ id: 'ana', roles: ['watcher'], token: '', issuer: 'https://idp.test', rolesFrom: 'groups' }],
  });
  expect(held?.can('terminal:read')).toBe(true);
  expect(held?.can('file:read')).toBe(true);
  expect(held?.can('file:write')).toBe(false);
});
