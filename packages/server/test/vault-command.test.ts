/*
 * `ahpd vault set|delete|list`, run in this process.
 *
 * One declaration on two surfaces: the terminal, whose caller is the process
 * owner and holds the file, and `/api`, whose caller is a person with a token.
 * What is pinned here is that neither surface can be made to print a value,
 * that the value comes from standard input at a terminal and from the body over
 * HTTP, and that which name a caller may write follows the scope of the name -
 * the rule of decision `a-secret-is-named-in-a-host-team-or-user-scope`, asked
 * of the grants the host already had rather than of a grant of its own.
 *
 * The vault is the real file, under a temporary configuration directory, so a
 * terminal case and a served case read and write the same bytes.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Output } from '@cofold/commands';
import { fileUsers } from '@ahpd/sdk';
import type { Users } from '@ahpd/sdk';
import { optionsFrom } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';
import { apiOrigins } from '../src/commands/run.js';
import { servedRegistry, type ServedFacts } from '../src/commands/served.js';
import { apiHandler } from '../src/http.js';
import { fileVault } from '../src/vault.js';

const AUTHORITY = '127.0.0.1:9361';
const SECRET = 'kept-out-of-every-answer';

let home: string;
let config: string;
let at: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-vault-command-'));
  config = join(home, 'config.json');
  // The terminal reads its vault out of the configuration directory, as the
  // daemon does, so a case here is the same file the served cases read.
  at = join(home, 'ahpd', 'vault.json');
  const had = process.env['XDG_CONFIG_HOME'];
  process.env['XDG_CONFIG_HOME'] = home;
  afterEach(() => { if (had === undefined) delete process.env['XDG_CONFIG_HOME']; else process.env['XDG_CONFIG_HOME'] = had; });
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const put = (held: unknown): void => { writeFileSync(config, `${JSON.stringify(held, null, 2)}\n`); };

/** The vault file as it stands, or nothing at all when no verb has written it. */
const held = (): string => existsSync(at) ? readFileSync(at, 'utf8') : '';

/** What one verb answered at the terminal, with standard input as it was given. */
const run = async (id: string, input: Record<string, unknown>, stdin?: string): Promise<Output> => {
  const registry = cliRegistry();
  const command = registry.find(id);
  if (command === undefined) throw new Error(`no ${id}`);
  const said = await registry.execute(command, {
    surface: 'cli',
    input: { configFile: config, ...input },
    readStdin: async () => stdin ?? '',
  });
  if (said === null) throw new Error(`${id} answered nothing`);
  return said;
};

/** The rows the listing answered. */
const rows = (said: Output): { name: string; set: boolean; referenced?: string }[] => said.data as { name: string; set: boolean; referenced?: string }[];

/** The people a served case signs in as, each holding exactly what it is about. */
const people = async (): Promise<{ directory: Users; ana: string; reader: string }> => {
  const directory = fileUsers({ path: join(home, 'users.json') });
  await directory.addTeam('backend');
  await directory.addTeam('frontend');
  await directory.addRole('secret-writer', ['team:write']);
  await directory.addRole('config-reader', ['config:read']);
  await directory.add('ana', ['secret-writer'], { memberships: ['backend'] });
  await directory.add('beto', ['config-reader']);
  return { directory, ana: await directory.mint('ana'), reader: await directory.mint('beto') };
};

/** The daemon's own facts, which every served case reads through. */
const facts = (): ServedFacts => ({
  options: optionsFrom({ configFile: config }),
  configFile: config,
  running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9361, paths: [], startedAt: '' }),
  turning: () => [],
  vault: () => fileVault({ file: at }),
  restart: () => {},
});

/** The daemon's own answer to a path under the API, as one bearer. */
const call = async (path: string, bearer: string | undefined, directory?: Users, body?: unknown): Promise<Response> => {
  const handler = apiHandler({
    registry: servedRegistry(facts()),
    token: 'root-secret',
    ...(directory === undefined ? {} : { users: directory }),
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

describe('vault at the terminal', () => {
  it('keeps a value piped on standard input and lists the name, never the value', async () => {
    put({});

    const kept = await run('vault.set', { name: 'host:probe' }, `${SECRET}\n`);
    expect(kept.data).toEqual({ name: 'host:probe', set: true });
    expect(kept.plain).toBe('Kept host:probe.\n');
    // The trailing newline is the pipe's, so a file piped in keeps its last line.
    expect(JSON.parse(held())).toEqual({ version: 1, secrets: { 'host:probe': SECRET } });

    const said = await run('vault.list', {});
    expect(rows(said)).toEqual([{ name: 'host:probe', set: true }]);
    expect(said.plain).toBe('host:probe  set\n');
    // Nothing that came back carries the value, on either reading of the answer.
    expect(JSON.stringify(said.data)).not.toContain(SECRET);
    expect(String(said.plain)).not.toContain(SECRET);
  });

  it('refuses a value that standard input did not carry', async () => {
    put({});
    // A terminal here is `readAllStdin()` answering "", and there is no way to
    // ask for one without echoing it, so the verb says what to do instead.
    await expect(run('vault.set', { name: 'host:probe' })).rejects.toThrow('pipe the value on standard input');
    expect(held()).toBe('');
  });

  it('lists a name the configuration references and the vault does not hold, and where', async () => {
    put({
      plugins: [
        { name: 'orders', options: { apiKey: { $secret: 'host:orders' } } },
        { name: 'reports', options: { token: { $secret: 'team:backend/reports' } } },
      ],
    });

    const said = await run('vault.list', {});
    expect(rows(said)).toEqual([
      { name: 'host:orders', set: false, referenced: 'plugins[0].options.apiKey' },
      { name: 'team:backend/reports', set: false, referenced: 'plugins[1].options.token' },
    ]);
    expect(said.plain).toBe('host:orders  not set, named at plugins[0].options.apiKey\n'
      + 'team:backend/reports  not set, named at plugins[1].options.token\n');
  });

  it('lists nothing rather than an empty listing', async () => {
    put({});
    const said = await run('vault.list', {});
    expect(rows(said)).toEqual([]);
    expect(said.plain).toBe('no secrets\n');
  });

  it('takes a name out, and refuses one the vault does not hold', async () => {
    put({});
    await run('vault.set', { name: 'host:probe' }, SECRET);
    await run('vault.set', { name: 'host:kept' }, SECRET);

    expect((await run('vault.delete', { name: 'host:probe' })).data).toEqual({ name: 'host:probe', set: false });
    expect(rows(await run('vault.list', {}))).toEqual([{ name: 'host:kept', set: true }]);

    // A name that is not there is a conflict, so a script can tell it from a taken one.
    await expect(run('vault.delete', { name: 'host:probe' })).rejects.toThrow('The vault holds no host:probe.');
  });

  it('refuses a name that is not one', async () => {
    put({});
    await expect(run('vault.set', { name: 'probe' }, SECRET)).rejects.toThrow('probe is not a secret name');
    expect(held()).toBe('');
  });
});

describe('vault, served', () => {
  it('refuses a host: set to a member with no config:write, and gives it to one that has it', async () => {
    put({});
    const { directory, ana } = await people();

    const refused = await call('/vault/set/host%3Aprobe', ana, directory, { value: SECRET });
    expect(refused.status).toBe(403);
    expect((await refused.json() as { message: string }).message).toBe('ana may not config:write here');
    expect(held()).toBe('');

    const wrote = await call('/vault/set/host%3Aprobe', 'root-secret', directory, { value: SECRET });
    expect(wrote.status).toBe(200);
    expect(await wrote.json()).toEqual({ name: 'host:probe', set: true });
  });

  it('lets a team writer write its own team\'s name and refuses another team\'s', async () => {
    put({});
    const { directory, ana } = await people();

    const own = await call('/vault/set/team%3Abackend%2Forders', ana, directory, { value: SECRET });
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ name: 'team:backend/orders', set: true });

    const other = await call('/vault/set/team%3Afrontend%2Forders', ana, directory, { value: SECRET });
    expect(other.status).toBe(403);
    expect((await other.json() as { message: string }).message).toBe('ana is not on frontend, so team:frontend/orders is not theirs to write');
  });

  it('lets a person write their own name and refuses another person\'s', async () => {
    put({});
    const { directory, ana } = await people();

    const own = await call('/vault/set/user%3Aana%2Ftoken', ana, directory, { value: SECRET });
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ name: 'user:ana/token', set: true });

    const other = await call('/vault/set/user%3Abeto%2Ftoken', ana, directory, { value: SECRET });
    expect(other.status).toBe(403);
    expect((await other.json() as { message: string }).message).toBe("user:beto/token is beto's own secret");
  });

  it('lists the host\'s names to a caller with config:read and to none without it', async () => {
    put({ plugins: [{ name: 'orders', options: { apiKey: { $secret: 'host:orders' } } }] });
    const { directory, reader, ana } = await people();
    await fileVault({ file: at }).set('host:probe', SECRET);
    await fileVault({ file: at }).set('user:ana/token', SECRET);

    const said = await call('/vault/list', reader, directory);
    expect(said.status).toBe(200);
    // The host's names, both the one the vault holds and the one the
    // configuration references; somebody else's is not one of this caller's rows.
    const body = await said.text();
    expect(JSON.parse(body)).toEqual([{ name: 'host:orders', set: false, referenced: 'plugins[0].options.apiKey' }, { name: 'host:probe', set: true }]);
    expect(body).not.toContain(SECRET);

    // ana writes teams' secrets and reads no configuration, so the host's own
    // names are not hers to be told about and only her own is left.
    const own = await call('/vault/list', ana, directory);
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual([{ name: 'user:ana/token', set: true }]);
  });

  it('lets root write and list anything', async () => {
    put({});
    await call('/vault/set/team%3Afrontend%2Forders', 'root-secret', undefined, { value: SECRET });

    const said = await call('/vault/list', 'root-secret');
    const body = await said.text();
    expect(JSON.parse(body)).toEqual([{ name: 'team:frontend/orders', set: true }]);
    expect(body).not.toContain(SECRET);

    const took = await call('/vault/delete/team%3Afrontend%2Forders', 'root-secret', undefined, {});
    expect(await took.json()).toEqual({ name: 'team:frontend/orders', set: false });
  });

  it('refuses a caller with no credential at all, before any name is asked for', async () => {
    put({});
    const { directory } = await people();
    expect((await call('/vault/list', undefined, directory)).status).toBe(401);
  });

  it('says a daemon that was started with no vault has nothing to manage', async () => {
    put({});
    const { vault: _absent, ...without } = facts();
    const handler = apiHandler({
      registry: servedRegistry(without),
      token: 'root-secret',
      program: { name: 'ahpd', version: '0.0.0' },
      origins: () => apiOrigins('127.0.0.1', undefined, 9361),
    });
    const answered = await handler(new Request(`http://${AUTHORITY}/api/vault/list`, { headers: { host: AUTHORITY, authorization: 'Bearer root-secret' } }));
    expect(answered.status).toBe(400);
    expect((await answered.json() as { message: string }).message).toContain('no vault');
  });
});