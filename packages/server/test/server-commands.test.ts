/*
 * The declarations themselves, checked before anything runs them.
 *
 * `pnpm test` runs this without a terminal or a daemon: what it asks is whether
 * the registry the program is built from is complete - every command valid,
 * every flag a run takes declared, and every command saying which grant it
 * needs. Building the registry validates each declaration, so an invalid one
 * fails here. A configuration file in a temporary directory is the one the
 * cases that run a command read, so none of them reads the configuration of
 * whoever runs the suite.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRegistry } from '@cofold/commands';
import type { AuthorizeRequest, Output } from '@cofold/commands';
import { fileUsers } from '@ahpd/sdk';
import type { Named } from '@ahpd/sdk';
import type { Options } from '../src/commands/options.js';
import { optionsFrom } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';
import { apiOrigins } from '../src/commands/run.js';
import { checkScopes } from '../src/commands/scopes.js';
import { servedRegistry } from '../src/commands/served.js';
import type { ServedFacts } from '../src/commands/served.js';
import { declareUser } from '../src/commands/user.js';
import { apiHandler } from '../src/http.js';

const registry = cliRegistry();

let root: string;
let config: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-commands-'));
  config = join(root, 'config.json');
  writeFileSync(config, '{}\n');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** Every flag the pinning cases pin, which `ahpd start` has to declare. */
const DAEMON_FLAGS = [
  '--port', '--host', '--stdio', '--path', '--connection-token',
  '--connection-token-file', '--without-connection-token', '--config-file',
  '--users', '--resource', '--issuer', '--trust-token', '--advanced-tools',
  '--automations', '--sessions', '--wire', '--plugin', '--no-plugins',
  '--update-check', '--plugin-option',
];

describe('the command registry', () => {
  it('validates every command and every need', () => {
    expect(() => registry.verify()).not.toThrow();
  });

  it('gives start every daemon flag, spelled as it always was', () => {
    const start = registry.find('daemon.start');
    expect(start).toBeDefined();
    const options = start?.options ?? [];
    const names = new Set(options.map((option) => option.name));
    expect(DAEMON_FLAGS.filter((name) => !names.has(name))).toEqual([]);
    // The two repeatable ones collect rather than overwrite.
    const repeatable = new Set(options.filter((option) => option.repeatable === true).map((option) => option.name));
    expect([...repeatable].sort()).toEqual(['--path', '--plugin', '--plugin-option']);
  });

  it('says which grant each command needs', () => {
    const scopes = (id: string): readonly string[] => registry.find(id)?.scopes ?? [];
    expect(scopes('daemon.status')).toEqual(['config:read']);
    expect(scopes('plugin.list')).toEqual(['config:read']);
    expect(scopes('daemon.config')).toEqual(['config:write']);
    expect(scopes('plugin.install')).toEqual(['config:write']);
    expect(scopes('plugin.remove')).toEqual(['config:write']);
    expect(scopes('plugin.update')).toEqual(['config:write']);
    expect(scopes('daemon.restart')).toEqual(['config:write']);
    const only = (id: string): string | undefined => registry.find(id)?.meta?.deploymentTokenOnly;
    for (const id of ['plugin.install', 'plugin.remove']) expect(only(id)).toBe('install or remove a plugin');
    expect(only('plugin.update')).toBe('update a plugin');
    for (const id of ['plugin.config', 'plugin.config.set']) expect(only(id)).toBe("change a plugin's options");
    for (const id of ['plugin.enable', 'plugin.disable']) expect(only(id)).toBe('enable or disable a plugin');
    expect(only('daemon.restart')).toBe('restart the daemon');
    for (const id of ['plugin.config', 'plugin.config.set', 'plugin.enable', 'plugin.disable']) {
      expect(scopes(id)).toEqual(['config:write']);
    }
    // Each scheme is its own subject, and a verb is gated by the one its own
    // verb touches - decision `people-are-resource-schemes-with-a-grant-each`.
    expect(scopes('user.list')).toEqual(['user:read', 'role:read']);
    for (const id of ['user.add', 'user.rm', 'user.token', 'user.member']) {
      expect(scopes(id)).toEqual(['user:write']);
    }
    for (const id of ['team.list', 'project.list']) expect(scopes(id)).toEqual([
      id.split('.')[0] === 'team' ? 'team:read' : 'project:read',
    ]);
    for (const id of ['team.add', 'team.rm', 'project.add', 'project.rm']) {
      expect(scopes(id)).toEqual([`${id.split('.')[0]}:write`]);
    }
    // A person sets their own primary, so the declaration names no grant at
    // all and the body asks for `user:write` only about somebody else's.
    expect(scopes('user.primary')).toEqual([]);
  });

  it('refuses each verb without its own subject, and allows it with that one', async () => {
    const people = join(root, 'people.json');
    writeFileSync(people, JSON.stringify({ roles: { keeper: ['user:write'] }, teams: [], projects: [], users: [] }));
    /** A caller holding exactly the grants named, and nobody else. */
    const caller = (grants: string[]) => ({
      id: 'sam',
      roles: ['holder'],
      can: (grant: string) => grants.includes(grant),
    });
    /** One verb over `/api`, which is where a caller's grant is checked. */
    const ask = async (id: string, input: Record<string, unknown>, grants: string[]): Promise<number> => {
      const directory = fileUsers({ path: people });
      const facts: ServedFacts = {
        options: { users: people } as Options,
        configFile: config,
        users: directory,
        running: () => ({ pid: process.pid, url: 'ws://127.0.0.1:9350', host: '127.0.0.1', port: 9350, paths: [], startedAt: '' }),
        turning: () => [],
        restart: () => {},
      };
      const served = servedRegistry(facts);
      const command = served.find(id);
      expect(command, id).toBeDefined();
      return registry.execute(command!, { surface: 'remote', input, request: { actor: caller(grants) } })
        .then(() => 200, (error: { status?: number }) => error.status ?? 500);
    };

    // A team grant lets a caller name and take out teams, and nothing else.
    expect(await ask('team.add', { id: 'backend' }, ['team:write'])).toBe(200);
    expect(await ask('team.list', {}, ['team:read'])).toBe(200);
    expect(await ask('team.rm', { id: 'backend' }, ['team:write'])).toBe(200);
    // The same calls under somebody else's subject are refused, which is the
    // whole of what the split bought.
    expect(await ask('team.list', {}, ['project:read'])).toBe(403);
    expect(await ask('team.add', { id: 'backend' }, ['user:write'])).toBe(403);
    expect(await ask('project.add', { id: 'controllr' }, ['team:write'])).toBe(403);
    // And a person's own grant does not reach their teams or projects.
    expect(await ask('user.list', {}, ['user:write'])).toBe(403);
    expect(await ask('user.add', { id: 'eve' }, ['team:write'])).toBe(403);
    // The role given is bounded by what the caller holds, so it is one the
    // caller has: decision `a-caller-gives-only-the-grants-it-holds`.
    expect(await ask('user.add', { id: 'eve', role: ['keeper'] }, ['user:write'])).toBe(200);
    expect(await ask('user.add', { id: 'eve', role: ['admin'] }, ['user:write'])).toBe(403);
    // Listing people asks for the roles it prints, so a caller who may not
    // read roles is refused.
    expect(await ask('user.list', {}, ['user:read'])).toBe(403);
    expect(await ask('user.list', {}, ['user:read', 'role:read'])).toBe(200);
  });

  it('checks a command scopes in the hook, on the remote surface', async () => {
    const command = registry.find('daemon.config');
    expect(command).toBeDefined();
    const caller = { id: 'ada', roles: ['member'], can: () => false };
    await expect(registry.execute(command!, {
      surface: 'remote',
      input: { configFile: config },
      request: { actor: caller },
    })).rejects.toThrow('ada may not config:write here');
  });

  it('refuses a remote request that carries no actor', () => {
    const command = registry.find('daemon.status');
    expect(command).toBeDefined();
    expect(() => checkScopes({
      command: command!,
      scopes: ['config:read'],
      context: { surface: 'remote' },
    } as unknown as AuthorizeRequest)).toThrow('Sign in to use this host');
  });

  it('refuses a served user add with no actor, whatever the hook let through', async () => {
    const bare = createRegistry({ authorize: () => undefined });
    declareUser(bare);
    const command = bare.find('user.add');
    expect(command).toBeDefined();
    const users = join(root, 'users.json');
    await expect(bare.execute(command!, {
      surface: 'remote',
      input: { users, id: 'eve' },
    })).rejects.toMatchObject({ status: 401 });
  });

  it('lets a remote caller holding the grant through the hook', async () => {
    const command = registry.find('daemon.config');
    expect(command).toBeDefined();
    const caller = { id: 'root', roles: ['admin'], can: () => true };
    const answer = await registry.execute(command!, {
      surface: 'remote',
      input: { configFile: config },
      request: { actor: caller },
    });
    expect(answer).not.toBeNull();
  });
});

describe('the update check', () => {
  it('is on unless the input or the file turns it off', () => {
    expect(optionsFrom({ configFile: config, updateCheck: false }).updateCheck).toBe(false);
    expect(optionsFrom({ configFile: config, updateCheck: true }).updateCheck).toBe(true);
    expect(optionsFrom({ configFile: config }).updateCheck).toBe(true);
  });
});

describe('--plugin-option', () => {
  const plugins = (input: Record<string, unknown>) => optionsFrom({ configFile: config, ...input }).plugins;

  it('merges over the file\'s options for that plugin, one flag per option', () => {
    writeFileSync(config, JSON.stringify({ plugins: [{ name: 'a', options: { x: 1, y: 2 } }, 'b'] }));
    expect(plugins({ pluginOptions: ['a.y=3', 'a.z=x'] })).toEqual([{ name: 'a', options: { x: 1, y: 3, z: 'x' } }, 'b']);
  });

  it('reads the value as JSON when it parses and as text otherwise', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['a'] }));
    expect(plugins({ pluginOptions: ['a.n=1', 'a.s=x', 'a.b=true', 'a.o={"k":[1]}', 'a.e=x=y'] }))
      .toEqual([{ name: 'a', options: { n: 1, s: 'x', b: true, o: { k: [1] }, e: 'x=y' } }]);
  });

  it('keeps a number only when it reads back as typed, and a JSON string as text', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['a'] }));
    expect(plugins({ pluginOptions: ['a.id=12345678901234567890', 'a.f=1.0', 'a.n=42', 'a.x=-1.5', 'a.s="123"'] }))
      .toEqual([{ name: 'a', options: { id: '12345678901234567890', f: '1.0', n: 42, x: -1.5, s: '123' } }]);
  });

  it('refuses a JSON value holding a number that would not read back as typed, and says to quote it', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['a'] }));
    expect(() => plugins({ pluginOptions: ['a.ids={"id":12345678901234567890}'] }))
      .toThrow('{"id":12345678901234567890} holds 12345678901234567890, which would be kept as 12345678901234567000; write it in quotes, as a JSON string.');
    expect(() => plugins({ pluginOptions: ['a.ids=[1,[9007199254740993]]'] })).toThrow('holds 9007199254740993, which would be kept as 9007199254740992');
    expect(() => plugins({ pluginOptions: ['a.f={"a":1.0}'] })).toThrow('{"a":1.0} holds 1.0, which would be kept as 1;');
    expect(() => plugins({ pluginOptions: ['a.f={"a":1e21}'] })).toThrow('holds 1e21, which would be kept as 1e+21;');
    expect(() => plugins({ pluginOptions: ['a.f={"a":0.12345678901234567890}'] })).toThrow('holds 0.12345678901234567890, which would be kept as 0.12345678901234568;');
    expect(() => plugins({ pluginOptions: ['a.big={"x":1e400}'] }))
      .toThrow('{"x":1e400} holds 1e400, too large to be a number; write it in quotes, as a JSON string.');
    // What reads back as typed is kept, and digits inside a string are the string's.
    expect(plugins({ pluginOptions: ['a.ids={"id":"12345678901234567890","n":9007199254740992,"x":-1.5,"s":"1.0"}'] }))
      .toEqual([{ name: 'a', options: { ids: { id: '12345678901234567890', n: 9007199254740992, x: -1.5, s: '1.0' } } }]);
  });

  it('splits a scoped name and a path at the last dot before the value', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['@ahpd/agent-claude', './p/index.ts'] }));
    expect(plugins({ pluginOptions: ['@ahpd/agent-claude.workerStop=session', './p/index.ts.mode=fast'] })).toEqual([
      { name: '@ahpd/agent-claude', options: { workerStop: 'session' } },
      { name: './p/index.ts', options: { mode: 'fast' } },
    ]);
  });

  it('sets an option on a plugin named by a typed --plugin', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['a'] }));
    expect(plugins({ plugins: ['b'], pluginOptions: ['b.k=true'] })).toEqual([{ name: 'b', options: { k: true } }]);
  });

  it('refuses a plugin this run does not load, naming it', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['a'] }));
    expect(() => plugins({ pluginOptions: ['c.k=1'] })).toThrow('--plugin-option names c, which is not a plugin this run loads.');
    expect(() => plugins({ plugins: ['b'], pluginOptions: ['a.k=1'] })).toThrow('--plugin-option names a');
  });

  it('refuses a plugin whose entry is switched off, which this run does not load', () => {
    writeFileSync(config, JSON.stringify({ plugins: [{ name: 'a', enabled: false }, 'b'] }));
    expect(() => plugins({ pluginOptions: ['a.k=1'] })).toThrow('--plugin-option names a, which is not a plugin this run loads.');
    expect(plugins({ pluginOptions: ['b.k=1'] })).toEqual([{ name: 'a', enabled: false }, { name: 'b', options: { k: 1 } }]);
  });

  it('refuses one that is not <plugin>.<key>=<value>', () => {
    writeFileSync(config, JSON.stringify({ plugins: ['a'] }));
    for (const bad of ['a.k', 'ak=1', '.k=1', 'a.=1']) {
      expect(() => plugins({ pluginOptions: [bad] })).toThrow(`--plugin-option takes <plugin>.<key>=<value>, not ${bad}`);
    }
  });

  it('is not a key the configuration file may hold', () => {
    writeFileSync(config, JSON.stringify({ pluginOptions: ['a.k=1'] }));
    expect(optionsFrom({ configFile: config }).warnings.join('\n')).toContain('pluginOptions is not a setting ahpd knows');
  });
});

describe('teams, projects and memberships', () => {
  const AUTHORITY = '127.0.0.1:9350';
  let file: string;

  beforeEach(() => {
    file = join(root, 'users.json');
    writeFileSync(file, JSON.stringify({ roles: {}, teams: [], projects: [], users: [] }));
  });

  /** A command run as the terminal runs it, against this case's file. */
  const cli = async (id: string, input: Record<string, unknown> = {}): Promise<Output> =>
    (await registry.execute(registry.find(id)!, {
      surface: 'cli',
      input: { configFile: config, users: file, ...input },
    })) as Output;

  /** The same file served under `/api`, with a deployment token when one is named. */
  const api = (token?: string) => {
    const directory = fileUsers({ path: file });
    const facts: ServedFacts = {
      options: { users: file } as Options,
      configFile: config,
      users: directory,
      running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9350, paths: [], startedAt: '' }),
      turning: () => [],
      restart: () => {},
    };
    return apiHandler({
      registry: servedRegistry(facts),
      ...(token === undefined ? {} : { token }),
      users: directory,
      program: { name: 'ahpd', version: '0.0.0' },
      origins: () => apiOrigins('127.0.0.1', undefined, 9350),
    });
  };

  /** A request to the API at `path`, with the `Host` a client sends and the credential when there is one. */
  const call = (
    handler: ReturnType<typeof api>,
    method: 'GET' | 'POST',
    path: string,
    token?: string,
    body: unknown = {},
  ): Promise<Response> => handler(new Request(`http://${AUTHORITY}/api${path}`, {
    method,
    headers: {
      host: AUTHORITY,
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  }));

  /** What a command printed, whether it spent anything printing it. */
  const plain = async (id: string, input: Record<string, unknown> = {}): Promise<string> => {
    const said = (await cli(id, input)).plain;
    return typeof said === 'function' ? said() : String(said);
  };

  /**
   * The file as it stands, which is what every one of these verbs writes.
   *
   * An absent list is an empty one: taking the last team out leaves the key
   * behind once and the read drops it, because the file never had to say so.
   */
  const held = (): { teams: Named[]; projects: Named[]; users: { id: string; memberships?: string[]; primary?: string }[] } => {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<{
      teams: Named[]; projects: Named[]; users: { id: string; memberships?: string[]; primary?: string }[];
    }>;
    return { teams: parsed.teams ?? [], projects: parsed.projects ?? [], users: parsed.users ?? [] };
  };

  it('names, lists and takes out, at the terminal', async () => {
    await cli('team.add', { id: 'backend', title: 'Backend' });
    await cli('project.add', { id: 'controllr' });
    expect(await plain('team.list')).toBe('backend  Backend\n');
    expect(await plain('project.list')).toBe('controllr\n');
    // Naming one that is there keeps the title it was not given, and moves nobody off it.
    expect(await plain('team.add', { id: 'backend' })).toContain('is already named');
    expect(held().teams).toEqual([{ id: 'backend', title: 'Backend' }]);
    await cli('team.rm', { id: 'backend' });
    await cli('project.rm', { id: 'controllr' });
    expect(held()).toMatchObject({ teams: [], projects: [] });
    await expect(cli('team.rm', { id: 'backend' })).rejects.toThrow('No team called backend.');
  });

  it('names, lists and takes out, under /api', async () => {
    const handler = api('root-secret');
    const statuses = await Promise.all([
      call(handler, 'POST', '/team/add/backend', 'root-secret', { title: 'Backend' }),
      call(handler, 'POST', '/project/add/controllr', 'root-secret'),
    ]);
    expect(statuses.map((one) => one.status)).toEqual([200, 200]);
    const listed = await call(handler, 'GET', '/team/list', 'root-secret');
    expect(await listed.json()).toEqual([{ id: 'backend', title: 'Backend' }]);
    expect(await (await call(handler, 'GET', '/project/list', 'root-secret')).json()).toEqual([{ id: 'controllr' }]);
    expect((await call(handler, 'POST', '/team/rm/backend', 'root-secret')).status).toBe(200);
    expect((await call(handler, 'POST', '/project/rm/controllr', 'root-secret')).status).toBe(200);
    expect(held()).toMatchObject({ teams: [], projects: [] });
  });

  it('refuses to take out a team or a project a membership names, saying who', async () => {
    await cli('team.add', { id: 'backend' });
    await cli('project.add', { id: 'controllr' });
    await cli('user.add', { id: 'ada' });
    await cli('user.member', { id: 'ada', entries: ['backend:controllr'] });
    await expect(cli('team.rm', { id: 'backend' })).rejects.toThrow('backend is still a team of ada; take them out of it first');
    await expect(cli('project.rm', { id: 'controllr' })).rejects.toThrow('controllr is still a project of ada; take them out of it first');
    // Served, the same refusal is a 400 with the sentence in it.
    const handler = api('root-secret');
    const refused = await call(handler, 'POST', '/team/rm/backend', 'root-secret');
    expect(refused.status).toBe(400);
    expect((await refused.json() as { message: string }).message).toContain('still a team of ada');
    // Nothing went, and the membership still says what it said.
    expect(held().teams).toEqual([{ id: 'backend' }]);
    expect(held().users[0]?.memberships).toEqual(['backend:controllr']);
  });

  it('replaces the memberships, and refuses an entry naming nothing the file holds', async () => {
    await cli('team.add', { id: 'backend' });
    await cli('project.add', { id: 'controllr' });
    await cli('user.add', { id: 'ada' });
    await cli('user.member', { id: 'ada', entries: ['backend:controllr'] });
    // A team or a project the file does not name is refused here rather than
    // written and dropped on the next read.
    await expect(cli('user.member', { id: 'ada', entries: ['backend:other'] })).rejects.toThrow('membership backend:other names no project called other');
    await expect(cli('user.member', { id: 'ada', entries: ['sales'] })).rejects.toThrow('membership sales names no team called sales');
    // And the whole list goes: the second entry is not left behind.
    await cli('user.member', { id: 'ada', entries: ['backend:*', 'backend'] });
    expect(held().users[0]?.memberships).toEqual(['backend:*', 'backend']);
    await expect(cli('user.member', { id: 'eve', entries: ['backend'] })).rejects.toThrow('No user called eve.');
    // An empty list takes the whole thing away rather than being refused, and
    // takes the primary with it: it is the only way out of a team whose primary
    // you are on.
    expect(await plain('user.member', { id: 'ada', entries: [] })).toContain('may charge their work to nothing');
    expect(held().users[0]).toMatchObject({ memberships: [] });
    expect(held().users[0]?.primary).toBeUndefined();
    // On a line the entries are positional, so the same request is spelled --unset.
    await cli('user.member', { id: 'ada', entries: ['backend:controllr'] });
    await cli('user.primary', { id: 'ada', entry: 'backend:controllr' });
    expect(await plain('user.member', { id: 'ada', unset: true })).toContain('their primary backend:controllr was taken away with it');
    expect(held().users[0]).toMatchObject({ memberships: [] });
    await expect(cli('user.member', { id: 'ada', entries: ['backend'], unset: true })).rejects.toThrow('--unset and a membership cannot both be given');
  });

  it('adds a person with the memberships and the primary in one call', async () => {
    await cli('team.add', { id: 'backend' });
    await cli('project.add', { id: 'controllr' });
    expect(await plain('user.add', { id: 'bob', membership: ['backend:controllr'], primary: 'backend:controllr' }))
      .toContain('Added bob (guest), of backend:controllr');
    expect(held().users[0]).toMatchObject({ memberships: ['backend:controllr'], primary: 'backend:controllr' });
    // A team or a project the file does not name is refused here as it is on
    // `user member`, because both are written through the same directory call.
    await expect(cli('user.add', { id: 'eve', membership: ['backend:other'] })).rejects.toThrow('membership backend:other names no project called other');
    // Adding a role to somebody who already has a team leaves the team alone.
    await cli('user.add', { id: 'bob', role: ['member'] });
    expect(held().users[0]).toMatchObject({ roles: ['member'], memberships: ['backend:controllr'], primary: 'backend:controllr' });
    // And the record fields are only offered where they are read.
    const offered = (id: string): readonly string[] => (registry.find(id)?.options ?? []).map((one) => one.name);
    expect(offered('user.add')).toEqual(expect.arrayContaining(['--membership', '--primary']));
    for (const id of ['user.list', 'user.rm', 'user.token', 'user.member', 'user.primary']) {
      expect(offered(id)).not.toContain('--membership');
      expect(offered(id)).not.toContain('--primary');
    }
    // The unset is on the two verbs that can take something away.
    expect(offered('user.member')).toContain('--unset');
    expect(offered('user.primary')).toContain('--unset');
  });

  it('says what each person may charge their work to, and takes it away', async () => {
    await cli('team.add', { id: 'backend' });
    await cli('project.add', { id: 'controllr' });
    await cli('user.add', { id: 'ada' });
    await cli('user.member', { id: 'ada', entries: ['backend:controllr'] });
    await cli('user.primary', { id: 'ada', entry: 'backend:controllr' });
    const said = await plain('user.list');
    expect(said).toContain('of backend:controllr');
    expect(said).toContain('primary backend:controllr');
    // The same, over the API, where the answer is the data rather than a line.
    const listed = await call(api('root-secret'), 'GET', '/user/list', 'root-secret');
    expect(await listed.json()).toMatchObject([{ id: 'ada', memberships: ['backend:controllr'], primary: 'backend:controllr' }]);
  });

  it('sets a primary only inside the memberships, and takes it away when they move', async () => {
    await cli('team.add', { id: 'backend' });
    await cli('project.add', { id: 'controllr' });
    await cli('user.add', { id: 'ada' });
    await cli('user.member', { id: 'ada', entries: ['backend:*'] });
    await cli('user.primary', { id: 'ada', entry: 'backend:controllr' });
    expect(held().users[0]?.primary).toBe('backend:controllr');
    // A wildcard is not a place, and neither is a project nobody named.
    await expect(cli('user.primary', { id: 'ada', entry: 'backend:*' })).rejects.toThrow('primary backend:* is not team or team:project');
    await expect(cli('user.primary', { id: 'ada', entry: 'backend:other' })).rejects.toThrow('primary backend:other names no project called other');
    await expect(cli('user.primary', { id: 'ada', entry: 'sales' })).rejects.toThrow('primary sales names no team called sales');
    // Leaving the team the primary named is the way their work moves, so it is
    // not refused: the primary goes with the memberships and the line says so.
    expect(await plain('user.member', { id: 'ada', entries: ['backend'] }))
      .toContain('their primary backend:controllr is not one of these, so it was taken away');
    expect(held().users[0]).toMatchObject({ memberships: ['backend'] });
    expect(held().users[0]?.primary).toBeUndefined();
    await cli('user.primary', { id: 'ada', entry: 'backend' });
    expect(held().users[0]?.primary).toBe('backend');
  });

  it('lets a person whose role was taken out still set their own primary', async () => {
    await cli('team.add', { id: 'backend' });
    await cli('user.add', { id: 'ada' });
    await cli('user.member', { id: 'ada', entries: ['backend'] });
    // The role is defined, held, and then taken out of the file, which says
    // nothing about the record that still holds it. `user primary` and `user
    // member` write the whole record back, and refusing them over a role nobody
    // is being given would lock the person out of the file for wanting to say
    // where their work is charged.
    const held0 = JSON.parse(readFileSync(file, 'utf8')) as {
      roles?: Record<string, string[]>;
      users: { id: string; roles: string[] }[];
    };
    held0.roles = { writer: ['file:write'] };
    for (const one of held0.users) one.roles = ['writer'];
    writeFileSync(file, JSON.stringify(held0));
    delete held0.roles;
    writeFileSync(file, JSON.stringify(held0));

    await cli('user.primary', { id: 'ada', entry: 'backend' });
    expect(held().users[0]?.primary).toBe('backend');
    await cli('user.member', { id: 'ada', entries: ['backend'] });
    expect(held().users[0]).toMatchObject({ roles: ['writer'], memberships: ['backend'], primary: 'backend' });
  });

  it('lets a person set their own primary over /api, and not somebody else\'s', async () => {
    await cli('team.add', { id: 'backend' });
    await cli('project.add', { id: 'controllr' });
    await cli('user.add', { id: 'ada' });
    await cli('user.add', { id: 'bob' });
    await cli('user.member', { id: 'ada', entries: ['backend:controllr'] });
    await cli('user.member', { id: 'bob', entries: ['backend:controllr'] });
    const secret = await fileUsers({ path: file }).mint('ada');
    const handler = api();
    const mine = await call(handler, 'POST', '/user/primary/ada', secret, { entry: 'backend:controllr' });
    expect(mine.status).toBe(200);
    expect(held().users.find((one) => one.id === 'ada')?.primary).toBe('backend:controllr');
    // `unset` is the same request as naming nothing, which the path cannot say.
    expect((await call(handler, 'POST', '/user/primary/ada', secret, { unset: true })).status).toBe(200);
    expect(held().users.find((one) => one.id === 'ada')?.primary).toBeUndefined();
    // A body that says neither is not a request at all.
    const neither = await call(handler, 'POST', '/user/primary/ada', secret, {});
    expect(neither.status).toBe(400);
    expect((await neither.json() as { message: string }).message).toContain('or --unset to take theirs away');
    // And a body that says both is two requests.
    expect((await call(handler, 'POST', '/user/primary/ada', secret, { entry: 'backend:controllr', unset: true })).status).toBe(400);
    // Their own memberships are as much a grant's business as a role.
    expect((await call(handler, 'POST', '/user/member/bob', secret, { entries: [] })).status).toBe(403);
    expect((await call(handler, 'POST', '/user/member/bob', secret, { entries: ['backend'] })).status).toBe(403);
    // Somebody else's is a person managing people, which is what the grant is.
    const refused = await call(handler, 'POST', '/user/primary/bob', secret, { entry: 'backend:controllr' });
    expect(refused.status).toBe(403);
    expect((await refused.json() as { message: string }).message).toBe('ada may not user:write here');
    // And no credential at all is nobody.
    expect((await call(handler, 'POST', '/user/primary/ada', undefined, { entry: 'backend:controllr' })).status).toBe(401);
  });

  it('takes the whole list away over /api when the body carries an empty one', async () => {
    await cli('team.add', { id: 'backend' });
    await cli('user.add', { id: 'ada' });
    await cli('user.member', { id: 'ada', entries: ['backend'] });
    await cli('user.primary', { id: 'ada', entry: 'backend' });
    const handler = api('root-secret');
    // The memberships are a list, so an empty one clears them; the primary is
    // one value, and it goes with them because they were all it covered.
    const cleared = await call(handler, 'POST', '/user/member/ada', 'root-secret', { entries: [] });
    expect(cleared.status).toBe(200);
    expect(held().users[0]).toMatchObject({ memberships: [] });
    expect(held().users[0]?.primary).toBeUndefined();
  });
});
