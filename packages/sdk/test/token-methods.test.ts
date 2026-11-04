/*
 * The three token methods, each beside the `ahpd token` command it repeats.
 *
 * A reader without `user:write` may mint, list and revoke their own tokens, as
 * `usageMethods` lets one read their own pools. A reader that signed in with a
 * minted token is not the person, so it may do none of the three. Another
 * person's tokens need `user:write` and are bounded by the grants that person
 * holds, exactly as the commands are.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { tokenMethods } from '../src/access/tokens.js';
import { fileUsers } from '../src/access/users.js';
import { call, hello, host, peer, root, signIn } from './users-gate-helpers.js';
import type { ServedMethod } from '../src/types/plugin.js';
import type { MintedToken, Principal, Users } from '../src/types/users.js';

/** What a minted token is told when it asks to manage tokens. */
const MINTED = 'A minted token cannot manage tokens; sign in as yourself.';

/** Three roles of this deployment's own: one reads, one writes, one manages people. */
const ROLES = {
  reader: ['proxy:read'],
  writer: ['proxy:read', 'proxy:write'],
  // `user:write` and only a read of the proxy, so naming another person is
  // bounded by that person's `proxy:write`.
  lister: ['user:write', 'proxy:read'],
  manager: ['user:write', 'proxy:read', 'proxy:write'],
};

let people: Users;
let secrets: Record<string, string>;
let methods: ReturnType<typeof tokenMethods>;

beforeEach(async () => {
  const path = join(root, 'users.json');
  writeFileSync(path, JSON.stringify({ roles: ROLES, users: [] }));
  people = fileUsers({ path });
  await people.add('ana', ['reader']);
  await people.add('bob', ['writer']);
  await people.add('look', ['lister']);
  await people.add('boss', ['manager']);
  secrets = {};
  for (const id of ['ana', 'bob', 'look', 'boss']) secrets[id] = await people.mint(id);
  methods = tokenMethods(people);
});

/** A principal as the directory hands one out, from the record's own full secret. */
const person = async (id: string): Promise<Principal> => {
  const one = await people.verify(secrets[id]!);
  expect(one).toBeDefined();
  return one!;
};

/** One command, as the gate would call it after admitting the reader. */
const ask = (name: string, params: Record<string, unknown>, reader: Principal | undefined) =>
  methods[`x-ahpd/tokens/${name}`]!.handle(params, reader, 'probe');

/** The three, served by the host as the daemon registers them. */
const served = (): Record<string, ServedMethod> =>
  Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, { by: 'ahpd', name, method }]));

it('names three commands, each needing user:write, each with an authorize and a describe', () => {
  expect(Object.keys(methods)).toEqual(['x-ahpd/tokens/mint', 'x-ahpd/tokens/list', 'x-ahpd/tokens/revoke']);
  for (const one of Object.values(methods)) {
    expect(one.grant).toBe('user:write');
    expect(one.authorize).toBeDefined();
    expect(one.describe!().title).not.toBe('');
  }
});

it('lets a person mint, list and revoke their own tokens without user:write', async () => {
  const ana = await person('ana');
  expect(ana.can('user:write')).toBe(false);

  const before = Date.now();
  const minted = await ask('mint', { label: 'laptop', grants: ['proxy:read'] }, ana) as MintedToken;
  expect(minted).toMatchObject({ user: 'ana', label: 'laptop', grants: ['proxy:read'] });
  expect(typeof minted.secret).toBe('string');
  expect(minted.created).toBeGreaterThanOrEqual(before);
  // The answer is what the mint made, and nothing of the stored hash.
  expect(minted).not.toHaveProperty('token');

  // The listing shows the record and never the secret or the hash.
  const listed = await ask('list', {}, ana) as Record<string, unknown>[];
  expect(listed).toHaveLength(1);
  expect(listed[0]).toMatchObject({ id: minted.id, user: 'ana', label: 'laptop', grants: ['proxy:read'] });
  expect(listed[0]).not.toHaveProperty('token');
  expect(JSON.stringify(listed)).not.toContain(minted.secret);
  expect(JSON.stringify(listed)).not.toContain('sha256:');

  // The file keeps the hash alone.
  const kept = readFileSync(join(root, 'users.tokens.json'), 'utf8');
  expect(kept).not.toContain(minted.secret);
  expect(kept).toContain('sha256:');

  // The secret signs in as ana, carrying the token's id.
  const narrowed = await people.verify(minted.secret);
  expect(narrowed?.id).toBe('ana');
  expect(narrowed?.token).toBe(minted.id);

  expect(await ask('revoke', { id: minted.id }, ana)).toEqual({});
  expect(await people.verify(minted.secret)).toBeUndefined();
  expect(await ask('list', {}, ana)).toEqual([]);
});

it('lets authorize in for one\'s own tokens and not for another person\'s', async () => {
  const ana = await person('ana');
  for (const name of ['mint', 'list']) {
    const authorize = methods[`x-ahpd/tokens/${name}`]!.authorize!;
    expect(await authorize({}, ana)).toBe(true);
    expect(await authorize({ user: 'ana' }, ana)).toBe(true);
    expect(await authorize({ user: 'bob' }, ana)).toBe(false);
  }
  // Revoke names no person, so its body is where another's token is refused.
  expect(await methods['x-ahpd/tokens/revoke']!.authorize!({ id: 'any' }, ana)).toBe(true);
});

it('refuses a reader that signed in with a minted token on each of the three', async () => {
  const ana = await person('ana');
  const minted = await ask('mint', {}, ana) as MintedToken;
  const token = await people.verify(minted.secret);
  expect(token?.token).toBe(minted.id);

  await expect(ask('mint', {}, token)).rejects.toMatchObject({ code: -32009, message: MINTED });
  await expect(ask('list', {}, token)).rejects.toMatchObject({ code: -32009, message: MINTED });
  await expect(ask('revoke', { id: minted.id }, token)).rejects.toMatchObject({ code: -32009, message: MINTED });
  for (const name of ['mint', 'list', 'revoke']) {
    expect(await methods[`x-ahpd/tokens/${name}`]!.authorize!({}, token!)).toBe(false);
  }
});

it('refuses another person\'s tokens to a caller without user:write, and lets a manager in', async () => {
  const ana = await person('ana');
  const boss = await person('boss');
  const bobs = await ask('mint', { label: 'bob laptop' }, await person('bob')) as MintedToken;

  for (const name of ['mint', 'list']) {
    await expect(ask(name, { user: 'bob' }, ana)).rejects.toMatchObject({ code: -32009, message: 'ana may not user:write here' });
  }
  // A caller who holds `user:write` but not one of bob's grants is refused by
  // that grant, as `user token` refuses the caller.
  await expect(ask('list', { user: 'bob' }, await person('look')))
    .rejects.toMatchObject({ code: -32009, message: 'look may not proxy:write here' });

  const listed = await ask('list', { user: 'bob' }, boss) as Record<string, unknown>[];
  expect(listed.map((one) => one.id)).toEqual([bobs.id]);
  // The manager mints for ana, and only with a grant ana holds.
  const forAna = await ask('mint', { user: 'ana', label: 'from boss', grants: ['proxy:read'] }, boss) as MintedToken;
  expect(forAna.user).toBe('ana');
  await expect(ask('mint', { user: 'ana', grants: ['proxy:write'] }, boss)).rejects.toMatchObject({
    code: -32009,
    message: 'user ana does not hold proxy:write; a token may not hold what its person does not',
  });
});

it('revokes by the token id, finds its person, and answers no token for an unknown id', async () => {
  const ana = await person('ana');
  const boss = await person('boss');
  const bobs = await ask('mint', {}, await person('bob')) as MintedToken;

  // Ana holds no `user:write`, so bob's token is not hers to take, and she is
  // answered as for a token that does not exist.
  await expect(ask('revoke', { id: bobs.id }, ana))
    .rejects.toMatchObject({ code: -32008, message: `No token called ${bobs.id}.` });
  expect(await ask('revoke', { id: bobs.id, user: 'bob' }, boss)).toEqual({});
  expect(await people.verify(bobs.secret)).toBeUndefined();

  await expect(ask('revoke', { id: 'nowhere' }, boss))
    .rejects.toMatchObject({ code: -32008, message: 'No token called nowhere.' });
  const anas = await ask('mint', {}, ana) as MintedToken;
  await expect(ask('revoke', { id: anas.id, user: 'bob' }, boss))
    .rejects.toMatchObject({ code: -32008, message: `No token called ${anas.id}.` });
  await expect(ask('revoke', {}, ana))
    .rejects.toMatchObject({ code: -32602, message: 'x-ahpd/tokens/revoke needs id, a token id' });
});

it('mints a key with meta, which its calls add to', async () => {
  const ana = await person('ana');
  const meta = { env: 'prod', client: 'pi' };
  const minted = await ask('mint', { meta }, ana) as MintedToken;

  expect(minted.meta).toEqual(meta);
  expect((await ask('list', {}, ana) as Omit<MintedToken, 'secret'>[])[0]?.meta).toEqual(meta);
});

it('refuses a param of the wrong shape, and a directory refusal with its sentence', async () => {
  const ana = await person('ana');
  await expect(ask('mint', { user: 7 }, ana)).rejects.toMatchObject({ code: -32602, message: 'x-ahpd/tokens/mint takes user as a string' });
  await expect(ask('mint', { label: 7 }, ana)).rejects.toMatchObject({ code: -32602, message: 'x-ahpd/tokens/mint takes label as a string' });
  await expect(ask('mint', { grants: 'proxy:read' }, ana)).rejects.toMatchObject({ code: -32602, message: 'x-ahpd/tokens/mint takes grants as a list of grant strings' });
  await expect(ask('mint', { expires: 'tomorrow' }, ana)).rejects.toMatchObject({ code: -32602, message: 'x-ahpd/tokens/mint takes expires as epoch milliseconds' });
  await expect(ask('mint', { scope: 7 }, ana)).rejects.toMatchObject({ code: -32602, message: 'x-ahpd/tokens/mint takes scope as a string' });
  await expect(ask('mint', { meta: 'env=prod' }, ana)).rejects.toMatchObject({ code: -32602, message: 'x-ahpd/tokens/mint takes meta as an object of names to values' });
  // The bounds are the proxy header's, so a name it would refuse is refused here.
  await expect(ask('mint', { meta: { 'a b': '1' } }, ana)).rejects.toMatchObject({ code: -32602, message: 'A meta\'s name a b is 1 to 64 characters of A to Z, a to z, 0 to 9, _, . and -' });
  // The directory refuses a grant the person does not hold and an expiry in the
  // past; its own sentence is the answer.
  await expect(ask('mint', { grants: ['proxy:write'] }, ana)).rejects.toMatchObject({
    code: -32009,
    message: 'user ana does not hold proxy:write; a token may not hold what its person does not',
  });
  await expect(ask('mint', { expires: Date.now() - 1000 }, ana))
    .rejects.toMatchObject({ code: -32009, message: expect.stringMatching(/is not in the future$/) });
});

it('refuses the root connection, which has no reader, when it names nobody', async () => {
  for (const [name, params] of [['mint', {}], ['list', {}], ['revoke', { id: 'any' }]] as const) {
    await expect(ask(name, params, undefined))
      .rejects.toMatchObject({ code: -32602, message: `x-ahpd/tokens/${name} needs user when nobody is signed in` });
  }
  // Naming a person is how a root connection manages one, as over `/api`.
  const minted = await ask('mint', { user: 'ana', label: 'by root' }, undefined) as MintedToken;
  expect(minted.user).toBe('ana');
  expect(await ask('list', { user: 'ana' }, undefined)).toHaveLength(1);
});

it('lets a manager mint, list and revoke a team key, and refuses a reader who may not', async () => {
  await people.addTeam('backend');
  const boss = await person('boss');
  const ana = await person('ana');

  const minted = await ask('mint', { team: 'backend', grants: ['proxy:call'], label: 'ci' }, boss) as MintedToken;
  expect(minted).toMatchObject({ team: 'backend', grants: ['proxy:call'], label: 'ci', scope: 'backend' });
  expect(minted.user).toBeUndefined();

  const listed = await ask('list', { team: 'backend' }, boss) as Record<string, unknown>[];
  expect(listed.map((one) => one.id)).toEqual([minted.id]);
  expect(listed[0]).toMatchObject({ team: 'backend', grants: ['proxy:call'] });
  // Another team's keys are not in this listing.
  expect(await ask('list', { team: 'sales' }, boss)).toEqual([]);

  // A reader holds no `user:write`, so no team key is theirs.
  for (const [name, params] of [
    ['mint', { team: 'backend', grants: ['proxy:call'] }],
    ['list', { team: 'backend' }],
    ['revoke', { id: minted.id, team: 'backend' }],
  ] as const) {
    await expect(ask(name, params, ana)).rejects.toMatchObject({ code: -32009, message: 'ana may not user:write here' });
  }
  // The gate refuses the reader before the body does.
  for (const name of ['mint', 'list', 'revoke']) {
    expect(await methods[`x-ahpd/tokens/${name}`]!.authorize!({ team: 'backend' }, ana)).toBe(false);
  }

  // A team key opens the proxy, so a reader who may not call it mints none,
  // and still lists and revokes the team's keys.
  const look = await person('look');
  await expect(ask('mint', { team: 'backend', grants: ['proxy:call'] }, look))
    .rejects.toMatchObject({ code: -32009, message: 'look may not proxy:call here' });
  expect(await ask('list', { team: 'backend' }, look)).toHaveLength(1);

  // The root connection has no reader, and reaches a team as it reaches a person.
  const byRoot = await ask('mint', { team: 'backend', grants: ['proxy:models'] }, undefined) as MintedToken;
  expect(byRoot.team).toBe('backend');
  expect(await ask('revoke', { id: byRoot.id, team: 'backend' }, undefined)).toEqual({});

  expect(await ask('revoke', { id: minted.id, team: 'backend' }, boss)).toEqual({});
  expect(await people.verifyTeamKey!(minted.secret)).toBeUndefined();
  expect(await ask('list', { team: 'backend' }, boss)).toEqual([]);
});

it('refuses a team beside a user, and a team that is no name', async () => {
  await people.addTeam('backend');
  const boss = await person('boss');

  for (const [name, params] of [
    ['mint', { user: 'ana', team: 'backend', grants: ['proxy:call'] }],
    ['list', { user: 'ana', team: 'backend' }],
    ['revoke', { id: 'any', user: 'ana', team: 'backend' }],
  ] as const) {
    await expect(ask(name, params, boss)).rejects.toMatchObject({
      code: -32602,
      message: `x-ahpd/tokens/${name} takes user or team, not both`,
    });
  }
  await expect(ask('mint', { team: '', grants: ['proxy:call'] }, boss)).rejects.toMatchObject({
    code: -32602,
    message: 'x-ahpd/tokens/mint takes team as a non-empty string',
  });
});

it('the host gates a member\'s own tokens in and another person\'s out', async () => {
  const made = host({ users: people, methods: served() });
  const ana = made.accept(peer());
  await hello(ana, 'ana');
  await signIn(ana, secrets['ana']!);

  const minted = await call(ana, 'x-ahpd/tokens/mint', { label: 'laptop' });
  expect(minted).toMatchObject({ result: { user: 'ana', label: 'laptop' } });
  const listed = await call(ana, 'x-ahpd/tokens/list', {});
  expect(listed).toMatchObject({ result: [{ user: 'ana', label: 'laptop' }] });
  // The listing the host answers carries neither the secret nor the hash.
  expect(JSON.stringify(listed)).not.toContain('secret');
  expect(JSON.stringify(listed)).not.toContain('sha256:');

  // Another person is not hers: the method's grant refuses before the body.
  expect(await call(ana, 'x-ahpd/tokens/list', { user: 'bob' }))
    .toMatchObject({ code: -32009, message: 'ana may not user:write here' });
  expect(await call(ana, 'x-ahpd/tokens/mint', { user: 'bob' }))
    .toMatchObject({ code: -32009, message: 'ana may not user:write here' });

  const id = (minted as { result: { id: string } }).result.id;
  expect(await call(ana, 'x-ahpd/tokens/revoke', { id })).toEqual({ result: {} });

  // The manager does the same for ana, with user:write and ana's grants.
  const boss = made.accept(peer());
  await hello(boss, 'boss');
  await signIn(boss, secrets['boss']!);
  expect(await call(boss, 'x-ahpd/tokens/mint', { user: 'ana', label: 'from boss' }))
    .toMatchObject({ result: { user: 'ana' } });
  const hers = (await call(boss, 'x-ahpd/tokens/list', { user: 'ana' })) as { result: { id: string }[] };
  expect(hers).toMatchObject({ result: [{ user: 'ana', label: 'from boss' }] });
  // And one of her tokens is his to take, since he holds what she holds.
  expect(await call(boss, 'x-ahpd/tokens/revoke', { id: hers.result[0]!.id })).toMatchObject({ result: {} });
  await made.close();
});

it('the host answers a minted token\'s own calls with the sentence, even when it holds user:write', async () => {
  const boss = await person('boss');
  const minted = await ask('mint', {}, boss) as MintedToken;
  const made = host({ users: people, methods: served() });
  const token = made.accept(peer());
  await hello(token, 'boss');
  await signIn(token, minted.secret);
  // It holds `user:write`, so the gate admits it, and the body is what refuses.
  expect(await call(token, 'x-ahpd/tokens/list', {}))
    .toMatchObject({ code: -32009, message: MINTED });
  expect(await call(token, 'x-ahpd/tokens/revoke', { id: minted.id }))
    .toMatchObject({ code: -32009, message: MINTED });
  await made.close();
});

it('advertises the three methods with their grant on initialize', async () => {
  const made = host({ users: people, methods: served() });
  const ana = made.accept(peer());
  const ready = await hello(ana, 'ana') as { _meta?: Record<string, unknown> };
  const entries = (ready._meta?.['ahpd.methods'] ?? []) as { method: string; title: string; grant: string }[];
  const tokens = entries.filter((one) => one.method.startsWith('x-ahpd/tokens/')).sort((one, other) => one.method.localeCompare(other.method));
  expect(tokens).toEqual([
    { method: 'x-ahpd/tokens/list', title: 'Tokens', description: 'The tokens you hold, without their hashes.', grant: 'user:write' },
    { method: 'x-ahpd/tokens/mint', title: 'Mint a token', description: 'A token of yours, limited to grants you hold, shown once.', grant: 'user:write' },
    { method: 'x-ahpd/tokens/revoke', title: 'Revoke a token', description: 'Take one of your tokens out; the next call with it is refused.', grant: 'user:write' },
  ]);
  await made.close();
});
