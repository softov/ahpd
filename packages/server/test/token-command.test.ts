/*
 * `ahpd token mint|list|rm`, run in this process.
 *
 * One declaration on two surfaces: the terminal, whose caller is the process
 * owner and names the person they act for, and `/api`, whose caller is the
 * person the request signed in as. What is pinned here is that a person mints
 * their own tokens with no grant, that a token never holds a grant its person
 * lacks, that a minted token is refused at all three verbs, and that a revoke
 * lands on the very next call.
 *
 * The directory and its tokens file are the real files, under a temporary home,
 * so a terminal case and a served case read and write the same bytes.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Output } from '@cofold/commands';
import { fileUsers } from '@ahpd/sdk';
import type { Users } from '@ahpd/sdk';
import { optionsFrom } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';
import { apiOrigins } from '../src/commands/run.js';
import { servedRegistry, type ServedFacts } from '../src/commands/served.js';
import { apiHandler } from '../src/http.js';

// The bytes a case hands the next draw, and the real source after them. A mint
// draws its id before its secret, so a queued buffer is an id.
const nextBytes = vi.hoisted(() => ({ waiting: [] as Buffer[] }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomBytes: (size: number) => nextBytes.waiting.shift() ?? actual.randomBytes(size),
  };
});

const AUTHORITY = '127.0.0.1:9361';

let home: string;
let config: string;
let usersFile: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-token-command-'));
  config = join(home, 'config.json');
  usersFile = join(home, 'users.json');
  put({ users: usersFile });
});
afterEach(() => {
  nextBytes.waiting.length = 0;
  rmSync(home, { recursive: true, force: true });
});

const put = (held: unknown): void => { writeFileSync(config, `${JSON.stringify(held, null, 2)}\n`); };

/** A token as a mint answers it, and as a listing answers one without its secret. */
interface Shown {
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
  secret: string;
}

/** One row of a listing: a token record with no secret to strip. */
type Row = Omit<Shown, 'secret'>;

const minted = (said: Output): Shown => said.data as Shown;
const rows = (said: Output): Row[] => said.data as Row[];

/** What one verb answered at the terminal, with the configuration under it. */
const run = async (id: string, input: Record<string, unknown>): Promise<Output> => {
  const registry = cliRegistry();
  const command = registry.find(id);
  if (command === undefined) throw new Error(`no ${id}`);
  const said = await registry.execute(command, {
    surface: 'cli',
    input: { configFile: config, ...input },
    readStdin: async () => '',
  });
  if (said === null) throw new Error(`${id} answered nothing`);
  return said;
};

/**
 * The people a case signs in as: a member with a read grant, one who also holds
 * a write grant, and a manager with `user:write` and the member's read grant.
 * The host names one team and one project, so a key can carry a scope.
 */
const people = async (): Promise<{ directory: Users; ana: string; bob: string; boss: string }> => {
  const directory = fileUsers({ path: usersFile });
  await directory.addRole('reader', ['proxy:read']);
  await directory.addRole('writer', ['proxy:write']);
  await directory.addRole('manager', ['user:write']);
  await directory.addTeam('backend');
  await directory.addProject('ahpd');
  await directory.add('ana', ['reader'], { memberships: ['backend:ahpd'] });
  await directory.add('bob', ['reader', 'writer']);
  await directory.add('boss', ['manager', 'reader']);
  return { directory, ana: await directory.mint('ana'), bob: await directory.mint('bob'), boss: await directory.mint('boss') };
};

/** The daemon's own facts, which every served case reads through. */
const facts = (directory: Users): ServedFacts => ({
  options: optionsFrom({ configFile: config }),
  configFile: config,
  users: directory,
  running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9361, paths: [], startedAt: '' }),
  turning: () => [],
  restart: () => ({ restartDelayMs: 0 }),
});

/** The daemon's own answer to a path under the API, as one bearer. */
const call = async (path: string, bearer: string | undefined, directory: Users, body?: unknown): Promise<Response> => {
  const handler = apiHandler({
    registry: servedRegistry(facts(directory)),
    token: 'root-secret',
    users: directory,
    program: { name: 'ahpd', version: '0.0.0' },
    origins: () => apiOrigins('127.0.0.1', undefined, 9361),
  });
  return handler(new Request(`http://${AUTHORITY}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      host: AUTHORITY,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
};

/** The sentence a refusal answered. */
const message = async (said: Response): Promise<string> => (await said.json() as { message: string }).message;

describe('token at the terminal', () => {
  it('mints for the person named with --user, shows the secret once, and lists no hash', async () => {
    const { directory } = await people();

    const said = await run('token.mint', { user: 'ana', label: 'laptop', grants: ['proxy:read'] });
    const one = minted(said);
    expect(one).toMatchObject({ user: 'ana', label: 'laptop', grants: ['proxy:read'] });
    // stdout is the credential alone, so it can be piped.
    expect(said.plain).toBe(`${one.secret}\n`);

    const stored = await directory.tokens!('ana');
    expect(stored).toEqual([{ id: one.id, user: 'ana', label: 'laptop', grants: ['proxy:read'], created: one.created }]);
    expect(JSON.stringify(stored)).not.toContain(one.secret);

    const listed = await run('token.list', { user: 'ana' });
    expect(rows(listed)).toEqual(stored);
    expect(listed.plain).toContain(one.id);
    expect(listed.plain).toContain('laptop');
    expect(listed.plain).toContain('proxy:read');
    // Neither reading of the answer carries the secret or the stored hash.
    expect(JSON.stringify(listed.data)).not.toContain(one.secret);
    expect(String(listed.plain)).not.toContain(one.secret);
    expect(JSON.stringify(listed.data)).not.toContain('sha256:');
  });

  it('refuses a mint and a revoke with no --user, and lists everybody without one', async () => {
    const { directory } = await people();
    await directory.mintToken!('ana', { label: 'ana-laptop' });
    await directory.mintToken!('bob', { label: 'bob-desktop' });

    // A terminal has nobody signed in, so the verbs that act on a person say who.
    await expect(run('token.mint', {})).rejects.toThrow('token mint needs --user');
    await expect(run('token.rm', { id: 'anything' })).rejects.toThrow('token rm needs --user');

    const all = await run('token.list', {});
    expect(rows(all).map((one) => one.label).sort()).toEqual(['ana-laptop', 'bob-desktop']);
    expect(all.plain).toContain('every grant of ana');
    expect(all.plain).toContain('every grant of bob');
  });

  it('takes a date for --expires, says it back, and refuses one in the past', async () => {
    await people();

    const one = minted(await run('token.mint', { user: 'ana', expires: '2999-01-01' }));
    expect(one.expires).toBe(Date.parse('2999-01-01'));

    await expect(run('token.mint', { user: 'ana', expires: '2000-01-01' }))
      .rejects.toThrow('expires 2000-01-01T00:00:00.000Z is not in the future');
    await expect(run('token.mint', { user: 'ana', expires: 'the day after tomorrow' }))
      .rejects.toThrow('the day after tomorrow is not a date.');
  });

  it('writes each --limit on the record, and says it back in the listing', async () => {
    const { directory } = await people();
    const limits = [
      { amount: 5, measure: 'usd', period: 'day', pool: 'shared' },
      { amount: 100, measure: 'calls', period: 'day', pool: 'shared' },
    ];

    const one = minted(await run('token.mint', { user: 'ana', limits: ['5:usd:day', '100:calls:day'] }));
    expect(one).toMatchObject({ limits });
    expect((await directory.tokens!('ana'))[0]?.limits).toEqual(limits);

    const listed = await run('token.list', { user: 'ana' });
    expect(listed.plain).toContain('limit 5 usd/day');
    expect(listed.plain).toContain('limit 100 calls/day');
  });

  it('refuses a --limit that is not amount:measure:period', async () => {
    await people();

    await expect(run('token.mint', { user: 'ana', limits: ['5:usd'] }))
      .rejects.toThrow('5:usd is not a limit; write one as <amount>:<measure>:<period>, such as 5:usd:day.');
    await expect(run('token.mint', { user: 'ana', limits: ['five:usd:day'] }))
      .rejects.toThrow('five:usd:day is not a limit; write one as <amount>:<measure>:<period>, such as 5:usd:day.');
  });

  it('writes each --meta on the record, and says it back in the listing', async () => {
    const { directory } = await people();
    const meta = { env: 'prod', client: 'pi' };

    const one = minted(await run('token.mint', { user: 'ana', meta: ['env=prod', 'client=pi'] }));
    expect(one).toMatchObject({ meta });
    expect((await directory.tokens!('ana'))[0]?.meta).toEqual(meta);

    const listed = await run('token.list', { user: 'ana' });
    expect(String(listed.plain)).toContain('meta env=prod,client=pi');
  });

  it('refuses a --meta with no =, and a name written twice', async () => {
    await people();

    await expect(run('token.mint', { user: 'ana', meta: ['env'] }))
      .rejects.toThrow('env is not a meta entry; write one as name=value');
    await expect(run('token.mint', { user: 'ana', meta: ['env=prod', 'env=dev'] }))
      .rejects.toThrow('env is named twice in --meta.');
  });

  it('refuses the second mint when the configuration allows one per person', async () => {
    put({ users: usersFile, tokensPerPerson: 1 });
    await people();

    await run('token.mint', { user: 'ana' });
    await expect(run('token.mint', { user: 'ana' }))
      .rejects.toThrow('user ana may hold 1 tokens at most; revoke one before minting another');
  });

  it('mints a key with a scope, refuses one the person is not in, and lists it', async () => {
    await people();

    const one = minted(await run('token.mint', { user: 'ana', label: 'pi', scope: 'backend:ahpd' }));
    expect(one.scope).toBe('backend:ahpd');

    // A team the person is not in gets the sentence every call would give; a
    // wildcard is not a scope at all.
    await expect(run('token.mint', { user: 'ana', scope: 'sales:ahpd' })).rejects.toThrow('ana may name backend:ahpd');
    await expect(run('token.mint', { user: 'ana', scope: 'backend:*' }))
      .rejects.toThrow('backend:* is not a scope: a scope is team or team:project');

    const listed = await run('token.list', { user: 'ana' });
    expect(rows(listed)).toEqual([{ id: one.id, user: 'ana', label: 'pi', scope: 'backend:ahpd', created: one.created }]);
    expect(String(listed.plain)).toContain('scope backend:ahpd');
  });

  it('mints, lists and revokes a team key with --team', async () => {
    const { directory } = await people();

    const one = minted(await run('token.mint', { team: 'backend', grants: ['proxy:call'], label: 'ci' }));
    expect(one).toMatchObject({ team: 'backend', grants: ['proxy:call'], label: 'ci', scope: 'backend' });
    expect(one.user).toBeUndefined();
    expect(await directory.tokens!()).toEqual([
      { id: one.id, team: 'backend', label: 'ci', grants: ['proxy:call'], scope: 'backend', created: one.created },
    ]);

    const listed = await run('token.list', { team: 'backend' });
    expect(rows(listed)).toHaveLength(1);
    expect(rows(listed)[0]).toMatchObject({ id: one.id, team: 'backend', grants: ['proxy:call'] });
    expect(String(listed.plain)).toContain('team backend');
    expect(String(listed.plain)).toContain('proxy:call');

    const took = await run('token.rm', { team: 'backend', id: one.id });
    expect(took.data).toEqual({ id: one.id, team: 'backend' });
    expect(String(took.plain)).toContain('team backend');
    expect(await directory.tokens!()).toEqual([]);
  });

  it('refuses --team beside --user, and --url for a team key', async () => {
    await people();

    for (const [id, input] of [
      ['token.mint', { user: 'ana', team: 'backend', grants: ['proxy:call'] }],
      ['token.list', { user: 'ana', team: 'backend' }],
      ['token.rm', { user: 'ana', team: 'backend', id: 'any' }],
    ] as const) {
      await expect(run(id, input)).rejects.toThrow(`token ${id.slice('token.'.length)} takes --user or --team, not both.`);
    }
    await expect(run('token.mint', { team: 'backend', grants: ['proxy:call'], url: true }))
      .rejects.toThrow('a team key opens the proxy alone');
  });
});

describe('token, served', () => {
  it('lets a member mint one of their own with no grant, and refuses a grant they do not hold', async () => {
    const { directory, ana } = await people();

    const said = await call('/token/mint', ana, directory, { label: 'laptop', grants: ['proxy:read'] });
    expect(said.status).toBe(200);
    const one = await said.json() as Shown;
    expect(one).toMatchObject({ user: 'ana', label: 'laptop', grants: ['proxy:read'] });
    expect(typeof one.secret).toBe('string');

    // The secret is the token that signed in for nobody; the minted one signs in
    // as ana, carrying its own id.
    const who = await directory.verify(one.secret);
    expect(who?.id).toBe('ana');
    expect(who?.token).toBe(one.id);

    const refused = await call('/token/mint', ana, directory, { grants: ['user:write'] });
    expect(refused.status).toBe(400);
    expect(await message(refused)).toBe('user ana does not hold user:write; a token may not hold what its person does not');
    expect(await directory.tokens!('ana')).toHaveLength(1);
  });

  it('refuses a minted token at mint, list and rm', async () => {
    const { directory } = await people();
    const one = await directory.mintToken!('ana', { label: 'laptop' });

    for (const [path, body] of [['/token/mint', {}], ['/token/list', undefined], [`/token/rm/${one.id}`, {}]] as const) {
      const said = await call(path, one.secret, directory, body);
      expect(said.status).toBe(403);
      expect(await message(said)).toBe('A minted token cannot manage tokens; sign in as yourself.');
    }
    // Nothing was minted or revoked on the way.
    expect(await directory.tokens!('ana')).toHaveLength(1);
  });

  it('revokes its own token, and the next request with it is refused 401', async () => {
    const { directory, ana } = await people();
    const one = await directory.mintToken!('ana', { label: 'laptop', grants: ['proxy:read'] });

    const took = await call(`/token/rm/${one.id}`, ana, directory, {});
    expect(took.status).toBe(200);
    expect(await took.json()).toEqual({ id: one.id, user: 'ana' });
    expect(await directory.tokens!('ana')).toEqual([]);

    // The revoked secret is a credential this host no longer knows.
    expect((await call('/token/list', one.secret, directory)).status).toBe(401);
  });

  it('revokes a token whose first drawn id began with a hyphen', async () => {
    const { directory, ana } = await people();
    /*
     * Base64url spells `-` once in 64 first characters, and an id that starts
     * with one is read by `token rm` as a flag: the mint makes another id, and
     * the token stays revocable.
     */
    nextBytes.waiting.push(Buffer.from([0xf8, 0, 0, 0, 0, 0]), Buffer.from([0, 0, 0, 0, 0, 0]));

    const said = await call('/token/mint', ana, directory, { label: 'laptop' });
    expect(said.status).toBe(200);
    const one = await said.json() as Shown;
    expect(one.id).toBe('AAAAAAAA');

    const took = await call(`/token/rm/${one.id}`, ana, directory, {});
    expect(took.status).toBe(200);
    expect(await took.json()).toEqual({ id: 'AAAAAAAA', user: 'ana' });
    expect(await directory.tokens!('ana')).toEqual([]);
  });

  it('refuses a member who names another person, or names a token of one', async () => {
    const { directory, ana } = await people();
    const bobs = await directory.mintToken!('bob', { label: 'bob-desktop' });

    const mintedForBob = await call('/token/mint', ana, directory, { user: 'bob', grants: ['proxy:read'] });
    expect(mintedForBob.status).toBe(403);
    expect(await message(mintedForBob)).toBe('ana may not user:write here');

    const listed = await call('/token/list?user=bob', ana, directory);
    expect(listed.status).toBe(403);
    expect(await message(listed)).toBe('ana may not user:write here');

    // Another person's token is not a token this caller may be told exists.
    const took = await call(`/token/rm/${bobs.id}`, ana, directory, {});
    expect(took.status).toBe(409);
    expect(await message(took)).toBe(`No token called ${bobs.id}.`);
  });

  it('lets a manager list and remove a person\'s tokens with --user', async () => {
    const { directory, boss } = await people();
    const one = await directory.mintToken!('ana', { label: 'laptop', grants: ['proxy:read'] });

    const listed = await call('/token/list?user=ana', boss, directory);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([{ id: one.id, user: 'ana', label: 'laptop', grants: ['proxy:read'], created: one.created }]);

    const took = await call(`/token/rm/${one.id}`, boss, directory, { user: 'ana' });
    expect(took.status).toBe(200);
    expect(await took.json()).toEqual({ id: one.id, user: 'ana' });
    expect(await directory.tokens!('ana')).toEqual([]);
  });

  it('refuses a manager who lacks a grant of the person they name', async () => {
    const { directory, boss } = await people();

    // bob holds proxy:write, which boss does not, and a mint for him is bounded
    // by everything he holds rather than by what the new token would.
    const said = await call('/token/mint', boss, directory, { user: 'bob', grants: ['proxy:read'] });
    expect(said.status).toBe(403);
    expect(await message(said)).toBe('boss may not proxy:write here');
    expect(await directory.tokens!('bob')).toEqual([]);

    // The same bound holds the revoke of one of his tokens.
    const bobs = await directory.mintToken!('bob', { grants: ['proxy:read'] });
    const took = await call(`/token/rm/${bobs.id}`, boss, directory, { user: 'bob' });
    expect(took.status).toBe(403);
    expect(await message(took)).toBe('boss may not proxy:write here');
  });

  it('lets a manager mint, list and revoke a team key, and refuses a member who names one', async () => {
    const { directory, ana, boss } = await people();

    const mine = await call('/token/mint', boss, directory, { team: 'backend', grants: ['proxy:call'], label: 'ci' });
    expect(mine.status).toBe(200);
    const one = await mine.json() as Shown;
    expect(one).toMatchObject({ team: 'backend', grants: ['proxy:call'], scope: 'backend' });
    expect(one.user).toBeUndefined();

    const listed = await call('/token/list?team=backend', boss, directory);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject([{ id: one.id, team: 'backend', label: 'ci' }]);

    // A member holds no `user:write`, so no team key is theirs to manage.
    for (const [path, body] of [
      ['/token/mint', { team: 'backend', grants: ['proxy:call'] }],
      ['/token/list?team=backend', undefined],
      [`/token/rm/${one.id}`, { team: 'backend' }],
    ] as const) {
      const refused = await call(path, ana, directory, body);
      expect(refused.status).toBe(403);
      expect(await message(refused)).toBe('ana may not user:write here');
    }

    // The deployment token reaches a team as it reaches a person.
    const byRoot = await call('/token/mint', 'root-secret', directory, { team: 'backend', grants: ['proxy:models'] });
    expect(byRoot.status).toBe(200);
    expect(await byRoot.json()).toMatchObject({ team: 'backend' });

    const took = await call(`/token/rm/${one.id}`, boss, directory, { team: 'backend' });
    expect(took.status).toBe(200);
    expect(await took.json()).toEqual({ id: one.id, team: 'backend' });
    // The key is gone from the directory, and from the team's listing.
    expect(await directory.tokens!()).toHaveLength(1);
    expect(await call('/token/list?team=backend', boss, directory).then((said) => said.json())).toHaveLength(1);
  });

  it('refuses the deployment token a verb without --user, and lets it list a person with one', async () => {
    const { directory } = await people();
    await directory.mintToken!('ana', { label: 'laptop' });

    const unnamed = await call('/token/list', 'root-secret', directory);
    expect(unnamed.status).toBe(400);
    expect(await message(unnamed)).toContain('token list needs --user');

    const named = await call('/token/list?user=ana', 'root-secret', directory);
    expect(named.status).toBe(200);
    expect(await named.json()).toMatchObject([{ user: 'ana', label: 'laptop' }]);
  });
});
