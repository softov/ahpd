import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fileUsers, signInRecord } from '../src/access/users.js';
import { githubIssuer, isIssuerUrl, issuerFrom, issuerKind, jwtIssuer, oidcIssuer } from '../src/access/issuers.js';
import type { Fetcher } from '../src/access/issuers.js';
import type { Issuer, IssuerVerify, Users } from '../src/types/users.js';

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
  expect((await users.list())[0]).toEqual({ id: 'ana', roles: ['admin'], grants: ['*:*'], trusted: true, issuer: 'github' });

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
  expect(withIssuer.resource_documentation).toBe('https://github.com/ahpio/ahpd/blob/main/docs/sdk/USERS.md');
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

it('keeps the roles a sign-in added apart, and frozen', async () => {
  wrote({ roles: { operators: ['*:*'] }, users: [
    { id: 'ana', roles: ['guest'], token: '', issuer: 'https://idp.test', rolesFrom: 'groups' },
    { id: 'sam', roles: ['guest'], token: '' },
  ] });
  const users = fileUsers({
    path,
    issuerFor: () => claiming('https://idp.test', {
      'at-1': { subject: 'ana', claims: { groups: ['operators'] } },
    }),
  });

  const held = await users.verify('at-1');
  expect(held?.roles).toEqual(['guest', 'operators']);
  expect(held?.rolesFromSignIn).toEqual(['operators']);
  expect(() => { (held as { rolesFromSignIn: unknown }).rolesFromSignIn = []; }).toThrow(TypeError);
  expect(() => { (held!.rolesFromSignIn as string[]).push('admin'); }).toThrow(TypeError);

  // A minted secret reads no claim, so it adds no roles.
  const secret = await users.mint('sam');
  const sam = await users.verify(secret);
  expect(sam?.id).toBe('sam');
  expect(sam?.rolesFromSignIn).toBeUndefined();
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

/*
 * The JWT check: a token the issuer signed itself, read here rather than asked
 * about.
 *
 * The keys are made in the case rather than kept as a fixture, so what passes
 * is the signature check and not a file: a key copied correctly into a fixture
 * says nothing about a forged token. No network, as above.
 */

type Alg = 'RS256' | 'PS256' | 'ES256' | 'EdDSA';

const ISSUER = 'https://idp.test';
const AUDIENCE = 'https://ahpd.test/';

/** The key generation parameters of each algorithm, which differ by family. */
const GEN = {
  RS256: { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  PS256: { name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  ES256: { name: 'ECDSA', namedCurve: 'P-256' },
  EdDSA: { name: 'Ed25519' },
} as const;

/** What signing is told, which is the algorithm and, for two of them, a hash. */
const SIGN = {
  RS256: { name: 'RSASSA-PKCS1-v1_5' },
  PS256: { name: 'RSA-PSS', saltLength: 32 },
  ES256: { name: 'ECDSA', hash: 'SHA-256' },
  EdDSA: { name: 'Ed25519' },
} as const;

const base64url = (held: unknown): string => Buffer.from(JSON.stringify(held), 'utf8').toString('base64url');

/** One part of a token, decoded, as the object it holds. */
const decoded = (value: string | undefined): Record<string, unknown> =>
  JSON.parse(Buffer.from(value ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;

/** A key made here, and the tokens it signs. */
interface Minted {
  /** The key as a key set publishes it. */
  readonly published: Record<string, unknown>;
  /** A token this key signs, for the claims and the header a case names. */
  token(claims?: Record<string, unknown>, header?: Record<string, unknown>): Promise<string>;
}

const minted = async (alg: Alg, kid: string = 'k1'): Promise<Minted> => {
  const pair = await crypto.subtle.generateKey(GEN[alg], true, ['sign', 'verify']) as webcrypto.CryptoKeyPair;
  const published = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid, alg, use: 'sig' };
  return {
    published,
    token: async (claims = {}, header = {}) => {
      const head = { alg, typ: 'at+jwt', kid, ...header };
      const body = {
        iss: ISSUER,
        sub: 'sam',
        aud: AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 300,
        ...claims,
      };
      const signed = `${base64url(head)}.${base64url(body)}`;
      const signature = await crypto.subtle.sign(SIGN[alg], pair.privateKey, Buffer.from(signed, 'utf8'));
      return `${signed}.${Buffer.from(signature).toString('base64url')}`;
    },
  };
};

/** One token with its header written over, which leaves the signature behind. */
const reheadered = (token: string, header: Record<string, unknown>): string => {
  const [head, body, signature] = token.split('.');
  return `${base64url({ ...decoded(head), ...header })}.${body}.${signature}`;
};

/** The metadata an issuer serves, and the key set it publishes. */
const idp = (...keys: readonly Record<string, unknown>[]): Record<string, unknown> => ({
  [`${ISSUER}/.well-known/openid-configuration`]: {
    issuer: ISSUER,
    userinfo_endpoint: `${ISSUER}/userinfo`,
    jwks_uri: `${ISSUER}/jwks`,
  },
  [`${ISSUER}/jwks`]: { keys },
});

it('reads the issuer out of a JWT, and nothing out of anything else', async () => {
  const key = await minted('EdDSA');
  expect(jwtIssuer(await key.token())).toBe(ISSUER);
  // An opaque token is not one, and neither is a token with no `iss` to read.
  expect(jwtIssuer('gho_secret')).toBeUndefined();
  expect(jwtIssuer('not.three.parts.at.all')).toBeUndefined();
  expect(jwtIssuer(await key.token({ iss: undefined }))).toBeUndefined();
});

it('checks a JWT against the key set the issuer publishes, and answers the subject', async () => {
  const key = await minted('RS256');
  const { fetch, seen } = answering(idp(key.published));
  const issuer = oidcIssuer({ issuer: ISSUER, fetch });

  const held = await issuer.verify?.(await key.token(), AUDIENCE);
  expect(held?.subject).toBe('sam');
  expect(held?.claims['iss']).toBe(ISSUER);
  // The `exp` the token carries, in milliseconds, which is what ends a sign-in.
  expect(held?.expiresAt).toBeGreaterThan(Date.now());
  // The metadata and the key set, and no question about the token itself.
  expect(seen).toEqual([`${ISSUER}/.well-known/openid-configuration`, `${ISSUER}/jwks`]);
});

it('checks all four algorithms, and refuses the rest', async () => {
  for (const alg of ['RS256', 'PS256', 'ES256', 'EdDSA'] as const) {
    const key = await minted(alg);
    const issuer = oidcIssuer({ issuer: ISSUER, fetch: answering(idp(key.published)).fetch });
    expect((await issuer.verify?.(await key.token(), AUDIENCE))?.subject).toBe('sam');
    // `none` is a token with no signature at all, and an `HS*` token is signed
    // with a secret a published key set never holds. Both are refused by name.
    for (const bad of ['none', 'HS256', 'RS512', 'ES384', '']) {
      expect(await issuer.verify?.(reheadered(await key.token(), { alg: bad }), AUDIENCE)).toBeUndefined();
    }
  }
});

it('refuses a token another key signed, which is what a forged one is', async () => {
  const key = await minted('EdDSA');
  const elsewhere = await minted('EdDSA');
  const { fetch } = answering(idp(key.published));
  const issuer = oidcIssuer({ issuer: ISSUER, fetch });

  // The same header and the same `kid`, signed by a key nobody published.
  expect(await issuer.verify?.(await elsewhere.token(), AUDIENCE)).toBeUndefined();
  // A signature that is not one at all, and one that is empty.
  const held = await key.token();
  const at = held.lastIndexOf('.');
  expect(await issuer.verify?.(`${held.slice(0, at)}.AAAA`, AUDIENCE)).toBeUndefined();
  expect(await issuer.verify?.(`${held.slice(0, at)}.`, AUDIENCE)).toBeUndefined();
});

it('refuses an expired token, one with no end, one not yet good, and one for another audience', async () => {
  const key = await minted('ES256');
  const { fetch } = answering(idp(key.published));
  const issuer = oidcIssuer({ issuer: ISSUER, fetch });
  const now = Math.floor(Date.now() / 1000);

  expect(await issuer.verify?.(await key.token({ exp: now - 3600 }), AUDIENCE)).toBeUndefined();
  expect(await issuer.verify?.(await key.token({ nbf: now + 600 }), AUDIENCE)).toBeUndefined();
  expect(await issuer.verify?.(await key.token({ exp: undefined }), AUDIENCE)).toBeUndefined();
  // An ID token is a JWT too, and the audience is what keeps it from signing in.
  expect(await issuer.verify?.(await key.token({ aud: 'the-client' }), AUDIENCE)).toBeUndefined();
  expect(await issuer.verify?.(await key.token({ aud: undefined }), AUDIENCE)).toBeUndefined();
  // A token from another issuer, whose signature is this issuer's key's.
  expect(await issuer.verify?.(await key.token({ iss: 'https://elsewhere.test' }), AUDIENCE)).toBeUndefined();
  // The allowance is a minute either side of the clock, and not an hour.
  expect((await issuer.verify?.(await key.token({ exp: now - 30 }), AUDIENCE))?.subject).toBe('sam');
  expect((await issuer.verify?.(await key.token({ nbf: now + 30 }), AUDIENCE))?.subject).toBe('sam');
});

it('takes a token typed `JWT` beside `at+jwt`, and refuses another type', async () => {
  const key = await minted('PS256');
  const { fetch } = answering(idp(key.published));
  const issuer = oidcIssuer({ issuer: ISSUER, fetch });

  expect((await issuer.verify?.(await key.token({}, { typ: 'JWT' }), AUDIENCE))?.subject).toBe('sam');
  // A header that names no type is taken as one of the two: a provider that
  // does not distinguish an access token from an ID token sends neither.
  expect((await issuer.verify?.(await key.token({}, { typ: undefined }), AUDIENCE))?.subject).toBe('sam');
  expect(await issuer.verify?.(await key.token({}, { typ: 'dpop+jwt' }), AUDIENCE)).toBeUndefined();
});

it('answers nobody for a token that is not a JWT at all', async () => {
  const key = await minted('RS256');
  const { fetch } = answering(idp(key.published));
  const issuer = oidcIssuer({ issuer: ISSUER, fetch });

  expect(await issuer.verify?.('gho_secret', AUDIENCE)).toBeUndefined();
  expect(await issuer.verify?.('a.b.c', AUDIENCE)).toBeUndefined();
  expect(await issuer.verify?.('', AUDIENCE)).toBeUndefined();
});

it('reads the key set once, and again only for a kid nobody published', async () => {
  const held = await minted('RS256', 'k1');
  const other = await minted('RS256', 'k2');
  const stranger = await minted('RS256', 'k9');
  const { fetch, seen } = answering(idp(held.published, other.published));
  const issuer = oidcIssuer({ issuer: ISSUER, fetch });
  const keys = `${ISSUER}/jwks`;
  const reads = (): number => seen.filter((one) => one === keys).length;
  // The clock is moved by hand: what is under test is how often the set is
  // read, and a minute of real time per assertion is not a test anybody runs.
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const token = await stranger.token();
    expect((await issuer.verify?.(await held.token(), AUDIENCE))?.subject).toBe('sam');
    // The second key was in the set that was already read, so nothing was asked.
    expect((await issuer.verify?.(await other.token(), AUDIENCE))?.subject).toBe('sam');
    expect(reads()).toBe(1);
    // A token naming a key nobody published is refused, and refused again:
    // a key rotated in does not make a flood of such tokens a flood of reads.
    expect(await issuer.verify?.(token, AUDIENCE)).toBeUndefined();
    expect(await issuer.verify?.(token, AUDIENCE)).toBeUndefined();
    expect(reads()).toBe(1);
    // Past that minute the set is read again, once, and the key that was
    // published all along is still the one a token is placed against.
    vi.setSystemTime(Date.now() + 61_000);
    expect(await issuer.verify?.(token, AUDIENCE)).toBeUndefined();
    expect(reads()).toBe(2);
    expect(await issuer.verify?.(token, AUDIENCE)).toBeUndefined();
    expect(reads()).toBe(2);
    expect((await issuer.verify?.(await held.token(), AUDIENCE))?.subject).toBe('sam');
  }
  finally { vi.useRealTimers(); }
});

it('places a token that names no kid against a set of one key, and no other set', async () => {
  const key = await minted('ES256');
  const both = await Promise.all([minted('ES256', 'a'), minted('ES256', 'b')]);
  const alone = oidcIssuer({ issuer: ISSUER, fetch: answering(idp(key.published)).fetch });
  const crowded = oidcIssuer({ issuer: ISSUER, fetch: answering(idp(...both.map((one) => one.published))).fetch });

  expect((await alone.verify?.(await key.token({}, { kid: undefined }), AUDIENCE))?.subject).toBe('sam');
  // Two keys and no name to choose between them is a token nothing here places.
  expect(await crowded.verify?.(await key.token({}, { kid: undefined }), AUDIENCE)).toBeUndefined();
});

it('reads the key set again for a token with no kid, once the issuer is back', async () => {
  const key = await minted('ES256');
  const answers: Record<string, unknown> = {};
  const { fetch } = answering(answers);
  const issuer = oidcIssuer({ issuer: ISSUER, fetch });
  const token = await key.token({}, { kid: undefined });
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    // The issuer is down at the first sign-in, so the set read is empty.
    expect(await issuer.verify?.(token, AUDIENCE)).toBeUndefined();
    Object.assign(answers, idp(key.published));
    expect(await issuer.verify?.(token, AUDIENCE)).toBeUndefined();
    vi.setSystemTime(Date.now() + 61_000);
    expect((await issuer.verify?.(token, AUDIENCE))?.subject).toBe('sam');
  }
  finally { vi.useRealTimers(); }
});

it('refuses a JWT when the issuer publishes no key set at all', async () => {
  const key = await minted('EdDSA');
  const metadata = `${ISSUER}/.well-known/openid-configuration`;
  const { fetch, seen } = answering({ [metadata]: { issuer: ISSUER, userinfo_endpoint: `${ISSUER}/userinfo` } });
  const issuer = oidcIssuer({ issuer: ISSUER, fetch });

  expect(await issuer.verify?.(await key.token(), AUDIENCE)).toBeUndefined();
  expect(seen).toEqual([metadata]);
});

it('checks a token the issuer signed for the identifier its metadata spells', async () => {
  const key = await minted('RS256');
  // The issuer is configured without the trailing slash its metadata uses.
  const { fetch } = answering(idp(key.published));
  const issuer = oidcIssuer({ issuer: `${ISSUER}/`, fetch });

  expect((await issuer.verify?.(await key.token(), AUDIENCE))?.subject).toBe('sam');
});

/*
 * The directory, which is where a token meets a person.
 *
 * An issuer says who a token belongs to and the file still says what they may
 * do. These cases are about the way in: which issuer a JWT is taken to, what an
 * opaque token does, and that a token naming an issuer this host does not know
 * is nobody's without a request being made.
 */

const ONE = 'https://one.test';
const TWO = 'https://two.test';

/** What one issuer serves under its own URL: its metadata and its key set. */
const idpAt = (issuer: string, ...keys: readonly Record<string, unknown>[]): Record<string, unknown> => ({
  [`${issuer}/.well-known/openid-configuration`]: {
    issuer,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/jwks`,
  },
  [`${issuer}/jwks`]: { keys },
});

/** A directory over the two issuers, each checked the way the case says. */
const directory = (fetch: Fetcher, verify?: IssuerVerify, issuer?: string): Users =>
  fileUsers({
    path,
    // The sign-in record is what a token has to have been issued for, so the
    // audience is not passed: it is this.
    resource: signInRecord(AUDIENCE),
    issuerFor: (name) => (name === ONE || name === TWO ? oidcIssuer({ issuer: name, fetch }) : undefined),
    ...(verify === undefined ? {} : { issuerVerify: verify }),
    ...(issuer === undefined ? {} : { issuer }),
  });

it('checks a JWT against the key set of the issuer its iss names, and no other', async () => {
  const one = await minted('RS256');
  const two = await minted('RS256');
  wrote({
    users: [
      { id: 'ana', roles: ['guest'], token: '', issuer: ONE },
      { id: 'sam', roles: ['guest'], token: '', issuer: TWO },
    ],
  });
  const { fetch, seen } = answering({ ...idpAt(ONE, one.published), ...idpAt(TWO, two.published) });
  const users = directory(fetch, 'jwt');

  expect((await users.verify(await one.token({ iss: ONE, sub: 'ana' })))?.id).toBe('ana');
  // The metadata and the key set of the issuer that signed it, and not one
  // request of the other's: `iss` is what chose.
  expect(seen).toEqual([`${ONE}/.well-known/openid-configuration`, `${ONE}/jwks`]);

  expect((await users.verify(await two.token({ iss: TWO })))?.id).toBe('sam');
  expect(seen.slice(2)).toEqual([`${TWO}/.well-known/openid-configuration`, `${TWO}/jwks`]);
});

it('takes an iss that differs from the configured name by a trailing slash', async () => {
  const key = await minted('RS256');
  wrote({ users: [{ id: 'ana', roles: ['guest'], token: '', issuer: ONE }] });
  const { fetch, seen } = answering(idpAt(ONE, key.published));

  // The name is configured without the slash the token spells it with, which is
  // one issuer and not two.
  expect((await directory(fetch, 'jwt').verify(await key.token({ iss: `${ONE}/`, sub: 'ana' })))?.id).toBe('ana');
  expect(seen).toEqual([`${ONE}/.well-known/openid-configuration`, `${ONE}/jwks`]);
});

it('answers nobody, with no request at all, for a JWT naming an issuer it does not know', async () => {
  const key = await minted('RS256');
  const elsewhere = await minted('RS256');
  wrote({ users: [{ id: 'ana', roles: ['guest'], token: '', issuer: ONE }] });
  const { fetch, seen } = answering(idpAt(ONE, key.published));
  const users = directory(fetch, 'jwt');

  // A signature from a key nobody here publishes and a subject that is on no
  // record: the answer is nobody either way, and the question was never asked.
  expect(await users.verify(await key.token({ iss: 'https://elsewhere.test' }))).toBeUndefined();
  expect(await users.verify(await elsewhere.token({ iss: 'https://elsewhere.test' }))).toBeUndefined();
  expect(seen).toEqual([]);
});

it('answers nobody for an opaque token when every issuer is checked here', async () => {
  const key = await minted('RS256');
  wrote({ users: [{ id: 'ana', roles: ['guest'], token: '', issuer: ONE }] });
  const { fetch, seen } = answering({ ...idpAt(ONE, key.published), [`${ONE}/userinfo`]: { sub: 'ana' } });

  // Nothing a key set can answer, and an issuer that was told not to be asked.
  expect(await directory(fetch, 'jwt').verify('gho_secret')).toBeUndefined();
  expect(seen).toEqual([]);
});

it('asks userinfo for an opaque token, which is all one can be checked with', async () => {
  wrote({ users: [{ id: 'ana', roles: ['guest'], token: '', issuer: ONE }] });
  const { fetch, seen } = answering({ [`${ONE}/.well-known/openid-configuration`]: { issuer: ONE, userinfo_endpoint: `${ONE}/userinfo` }, [`${ONE}/userinfo`]: { sub: 'ana' } });

  // The default setting, and what a host with no key cache has always done.
  expect((await directory(fetch).verify('gho_secret'))?.id).toBe('ana');
  expect(seen).toEqual([`${ONE}/.well-known/openid-configuration`, `${ONE}/userinfo`]);
});

it('asks the endpoint under auto for a JWT an issuer with no key set cannot answer', async () => {
  const key = await minted('RS256');
  wrote({ users: [{ id: 'ana', roles: ['guest'], token: '', issuer: ONE }] });
  const { fetch, seen } = answering({
    [`${ONE}/.well-known/openid-configuration`]: { issuer: ONE, userinfo_endpoint: `${ONE}/userinfo` },
    [`${ONE}/userinfo`]: { sub: 'ana' },
  });

  // `auto` is the setting for a provider that is both things at once, so a
  // token the keys cannot answer is not the end of the sign-in.
  expect((await directory(fetch, 'auto').verify(await key.token({ iss: ONE })))?.id).toBe('ana');
  expect(seen).toEqual([`${ONE}/.well-known/openid-configuration`, `${ONE}/userinfo`]);
});

it('reads the roles of a claim out of the token it checked, and asks nothing more', async () => {
  const key = await minted('RS256');
  wrote({
    roles: { operators: ['file:read'] },
    users: [{ id: 'ana', roles: ['guest'], token: '', issuer: ONE, rolesFrom: 'groups' }],
  });
  const { fetch, seen } = answering(idpAt(ONE, key.published));
  const users = directory(fetch, 'jwt');

  const held = await users.verify(await key.token({ iss: ONE, sub: 'ana', groups: ['operators'] }));
  expect(held?.roles).toEqual(['guest', 'operators']);
  // The file's roles are resolved live and the claim's are the ones the token
  // carried, which is why no `userinfo` question was needed for them.
  expect(held?.can('file:read')).toBe(true);
  expect(seen).toEqual([`${ONE}/.well-known/openid-configuration`, `${ONE}/jwks`]);
});

it('carries the token expiry onto the principal, and leaves it off an opaque sign-in', async () => {
  const key = await minted('RS256');
  const exp = Math.floor(Date.now() / 1000) + 300;
  wrote({ users: [{ id: 'ana', roles: ['guest'], token: '', issuer: ONE }] });
  const { fetch } = answering({ ...idpAt(ONE, key.published), [`${ONE}/userinfo`]: { sub: 'ana' } });

  expect((await directory(fetch, 'jwt').verify(await key.token({ iss: ONE, sub: 'ana', exp })))?.expiresAt).toBe(exp * 1000);
  // An endpoint answers who somebody is and not until when, so there is nothing
  // to end a sign-in through one but the connection.
  expect((await directory(fetch).verify('gho_secret'))?.expiresAt).toBeUndefined();
});

it('reports a record whose setting this host does not have, and checks it the default way', async () => {
  const said: string[] = [];
  wrote({ users: [{ id: 'ana', roles: ['guest'], token: '', issuer: ONE, issuerVerify: 'key-set' }] });
  const { fetch, seen } = answering({ [`${ONE}/.well-known/openid-configuration`]: { issuer: ONE, userinfo_endpoint: `${ONE}/userinfo` }, [`${ONE}/userinfo`]: { sub: 'ana' } });
  const users = fileUsers({
    path,
    resource: signInRecord(AUDIENCE),
    issuerFor: (name) => (name === ONE ? oidcIssuer({ issuer: name, fetch }) : undefined),
    onProblem: (line) => said.push(line),
  });

  // The token goes to the endpoint as every token did before there was a
  // setting, and what the file said is in the log rather than silently obeyed.
  expect((await users.verify('gho_secret'))?.id).toBe('ana');
  expect(seen).toEqual([`${ONE}/.well-known/openid-configuration`, `${ONE}/userinfo`]);
  expect(said.filter((one) => one.includes('issuerVerify')).length).toBe(1);
  expect(said.find((one) => one.includes('issuerVerify'))).toContain('user ana');
});

it('lets a record say its own issuer is checked the old way', async () => {
  const key = await minted('RS256');
  wrote({
    users: [
      { id: 'ana', roles: ['guest'], token: '', issuer: ONE, issuerVerify: 'userinfo' },
      { id: 'sam', roles: ['guest'], token: '', issuer: TWO },
    ],
  });
  const { fetch, seen } = answering({
    ...idpAt(ONE, key.published),
    ...idpAt(TWO, key.published),
    [`${ONE}/userinfo`]: { sub: 'ana' },
  });

  // The host checks keys, and the record that signs in elsewhere says its
  // provider is not one to check keys against.
  expect((await directory(fetch, 'jwt').verify(await key.token({ iss: ONE, sub: 'ana' })))?.id).toBe('ana');
  expect(seen).toEqual([`${ONE}/.well-known/openid-configuration`, `${ONE}/userinfo`]);
});
