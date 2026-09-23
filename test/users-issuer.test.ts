import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fileUsers, signInRecord } from '../packages/sdk/src/users.js';
import { githubIssuer, oidcIssuer } from '../packages/sdk/src/issuers.js';
import type { Fetcher } from '../packages/sdk/src/issuers.js';

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

it('asks GitHub who a token belongs to, and answers with the login', async () => {
  const { fetch, seen } = answering({ [GITHUB]: { login: 'ana' } });
  const issuer = githubIssuer({ fetch });

  expect(await issuer.subject('gho_secret')).toBe('ana');
  expect(issuer.id).toBe('https://github.com/login/oauth');
  expect(issuer.scopes).toEqual(['read:user']);
  expect(seen).toEqual([GITHUB]);
});

it('answers nobody for a token the issuer refuses', async () => {
  // A 401 from GitHub is a token that is not anybody's, not an error here.
  const { fetch } = answering({});
  expect(await githubIssuer({ fetch }).subject('nope')).toBeUndefined();
});

it('answers nobody when the issuer cannot be reached, and does not throw', async () => {
  const fetch: Fetcher = async () => { throw new Error('offline'); };
  expect(await githubIssuer({ fetch }).subject('gho_secret')).toBeUndefined();
});

it('matches an issuer subject against a record and keeps its roles', async () => {
  const { fetch } = answering({ [GITHUB]: { login: 'ana' } });
  const users = fileUsers({ path, issuer: githubIssuer({ fetch }) });
  await users.add('ana', ['admin']);
  // A record with an issuer and no minted secret: `add` leaves the hash empty,
  // so this person can only arrive through the issuer.
  expect((await users.list())[0]).toEqual({ id: 'ana', roles: ['admin'] });

  const held = await users.verify('gho_secret');
  expect(held?.id).toBe('ana');
  expect(held?.can('session')).toBe(true);
});

it('answers nobody for a subject no record names', async () => {
  const { fetch } = answering({ [GITHUB]: { login: 'stranger' } });
  const users = fileUsers({ path, issuer: githubIssuer({ fetch }) });
  await users.add('ana', ['admin']);
  expect(await users.verify('gho_secret')).toBeUndefined();
});

it('checks a minted secret first, and never asks the issuer for it', async () => {
  const { fetch, seen } = answering({ [GITHUB]: { login: 'ana' } });
  const users = fileUsers({ path, issuer: githubIssuer({ fetch }) });
  await users.add('ana', ['member']);
  const secret = await users.mint('ana');

  const held = await users.verify(secret);
  expect(held?.id).toBe('ana');
  expect(held?.can('write')).toBe(true);
  // The local hash answered, so the issuer was never consulted: a deployment
  // that mints secrets does not depend on a network it may not have.
  expect(seen).toEqual([]);
});

it('discovers an OpenID Connect endpoint once, and takes the subject from it', async () => {
  const discovery = 'https://idp.test/.well-known/openid-configuration';
  const userinfo = 'https://idp.test/userinfo';
  const { fetch, seen } = answering({
    [discovery]: { userinfo_endpoint: userinfo },
    [userinfo]: { sub: 'sam' },
  });
  const issuer = oidcIssuer({ issuer: 'https://idp.test', fetch });

  expect(await issuer.subject('at-1')).toBe('sam');
  expect(await issuer.subject('at-2')).toBe('sam');
  expect(issuer.id).toBe('https://idp.test');
  expect(issuer.scopes).toEqual(['openid']);
  // The metadata answered once and was kept; the userinfo endpoint was asked
  // per token, which is the one call that has to be per token.
  expect(seen).toEqual([discovery, userinfo, userinfo]);
});

it('refuses a userinfo endpoint that is not https', async () => {
  // The document is remote, and a person's token must not go out in clear.
  const discovery = 'https://idp.test/.well-known/openid-configuration';
  const { fetch, seen } = answering({ [discovery]: { userinfo_endpoint: 'http://idp.test/userinfo' } });
  expect(await oidcIssuer({ issuer: 'https://idp.test', fetch }).subject('at-1')).toBeUndefined();
  expect(seen).toEqual([discovery]);
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
