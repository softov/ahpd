import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseYaml, stringifyYaml } from '@cofold/yaml';
import { fileRecords } from '../../server/src/records.js';
import { createHost, ROOT } from '../../sdk/src/host.js';
import { foldHostOptions, pluginHost } from '../../sdk/src/plugins/plugins.js';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { memorySessions } from '../../sdk/src/sessions/sessions.js';
import { sdkVersion } from '../../sdk/src/version.js';
import { uriOf } from '../../sdk/src/resources/fileuri.js';
import { holds } from '../../sdk/src/access/users.js';
import { echo } from '../../../examples/echo/agent.js';
import { apply } from '../src/plugin.js';
import { BOT_BODIES, BOT_COLORS } from '../src/record.js';
import { botStore } from '../src/store.js';
import type { Agent } from '../../sdk/src/types/agent.js';
import type { AgentOwner } from '../../sdk/src/types/agents.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { LoaderContext } from '../../sdk/src/types/plugin.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { Grant, Principal, Users } from '../../sdk/src/types/users.js';

/*
 * The scheme the bot plugin serves.
 *
 * A bot is a record a person makes, edits and deletes through the same four
 * commands every resource has: a write to `bot://<slug>` is a bot, a read is
 * its record, a list is the bots a reader may see, and a delete leaves a
 * tombstone behind. What is checked here is the whole of that seam - the gate
 * the host already has, the provider behind it, and the files it keeps.
 */

/** A temporary directory removed after the test that made it. */
let loose: string[] = [];
beforeEach(() => { loose = []; });
afterEach(() => {
  for (const dir of loose) rmSync(dir, { recursive: true, force: true });
  loose = [];
});

const RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.test/users'],
  required: false,
};

/**
 * A directory whose tokens are decided by hand.
 *
 * A grant is held the way a role holds one - exactly, by a wildcard in either
 * position, or through the group its operation is in - so `bot:*` is every
 * operation of the scheme and `bot:write` is each of the four that write.
 *
 * `members` is what each person belongs to, which is what a write naming a
 * `team:` or `project:` owner is checked against.
 */
const directory = (tokens: Record<string, Grant[]>, members: Record<string, string[]> = {}): Users => ({
  resource: RECORD,
  verify: async (token) => {
    const held = tokens[token];
    if (held === undefined) return undefined;
    const belongs = members[token];
    const person: Principal = {
      id: token,
      roles: ['r'],
      can: (one) => holds(new Set<string>(held), one),
      ...(belongs === undefined ? {} : { memberships: belongs }),
    };
    return person;
  },
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => '',
});

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/**
 * A host with the bot plugin on it, folded in the way the loader folds it.
 *
 * `people` is false for the host with no users directory, where no connection
 * is anybody: the one host whose writer and reader are both absent.
 *
 * `files` keeps the records in files under the configuration folder, as a
 * running daemon does, rather than in memory; `prepare` writes whatever was
 * there before the plugin loads, which is how an older layout is set up.
 */
function made(
  tokens: Record<string, Grant[]> = {},
  members: Record<string, string[]> = {},
  over: Partial<HostOptions> = {},
  people = true,
  extra: Agent[] = [],
  files = false,
  prepare?: (configDir: string, bots: string) => void,
) {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-bot-'));
  loose.push(root);
  /** Where a bot's own folder goes, which is the plugin's `root` option. */
  const bots = join(root, 'bots');
  /** The daemon's own configuration, which is where the records are kept. */
  const configDir = join(root, 'config');
  const context: LoaderContext = {
    path: root,
    paths: [root],
    version: sdkVersion(),
    hostName: 'test',
    configDir,
    ...(people ? { hasUsers: true } : {}),
    log: () => {},
    say: () => {},
    // The host's YAML, which a bot's `AGENTS.md` is read and written with: the
    // daemon gives its own, and a test gives the parser the other tests use.
    parseYaml,
    stringifyYaml,
  };
  // The sessions this host keeps, which is where a chat is started: read live
  // off the host rather than held by the plugin, so the two are the same store
  // a running daemon would hand it.
  const sessions = memorySessions();
  // The record store in place of a folder by default: the plugin keeps its bots
  // in collections of this. With `files` it is the daemon's own, so what the
  // plugin reads and writes is on the disk in the layout a daemon keeps. Read
  // live off the host, the way the sessions are, so the plugin and the host
  // hold the same one.
  const records = files ? fileRecords(configDir) : memoryRecords();
  /** The problems the plugin reported while the host ran. */
  const reported: string[] = [];
  /**
   * The agents this host serves, which the host folds in below.
   *
   * Built before the plugin is applied so the plugin can be handed the live
   * list, as the loader hands it: a bot whose agent this host no longer serves
   * is answered `unavailable`, and that is a question about this list.
   */
  const agents: Agent[] = [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }, ...extra];
  const { host: plugin, contribution } = pluginHost('bot', context, {
    sessions: () => sessions,
    records: () => records,
    agents: () => agents,
    // The loader hands a plugin the host's own map; this is the same wire, so a
    // case can say who the agents are.
    ...(over.agentOwners === undefined ? {} : { agentOwners: over.agentOwners }),
    alert: (alert) => { reported.push(alert.text); },
    // The grant a wake's start of a back session asks for, which the daemon's
    // entry for this plugin holds: a bot's work runs in the bot's own folder,
    // and a folder is trusted only where the plugin may ask for that.
    grants: ['session:trust'],
  });
  prepare?.(configDir, bots);
  apply(plugin, { root: bots });

  const base: HostOptions = {
    path: root,
    agents,
    resources: fileResources(),
    sessions,
    records,
    ...(people ? { users: directory(tokens, members) } : {}),
    ...over,
  };
  const { options, problems } = foldHostOptions(base, [contribution]);
  return { host: createHost(options), bots, root, configDir, problems, reported, sessions, records };
}

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** A client signed in as `token`, which is what the gate reads a grant off. */
async function as(host: ReturnType<typeof createHost>, token: string): Promise<Client> {
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: token, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token } });
  return client;
}

/**
 * The host's own key: signed in as nobody, and answerable to no grant.
 *
 * A root connection is what the deployment's token gets, and it is the one
 * writer that may name an owner it has no membership for.
 */
async function door(host: ReturnType<typeof createHost>): Promise<Client> {
  const client = host.accept(peer(), undefined, true);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'root', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  return client;
}

/** The result, or the refusal, whichever the host answered with. */
const call = async (client: Client, method: string, params: Bag) => client.handle({ method, params }).then(
  (result) => ({ result: result as Bag }),
  (error: { code: number; message: string; data?: unknown }) => error,
);

const write = (client: Client, uri: string, body: unknown, extra: Bag = {}) =>
  call(client, 'resourceWrite', { uri, data: JSON.stringify(body), ...extra });

/** The result of an answer the test expects to be one, or the refusal it named. */
const got = (answer: Awaited<ReturnType<typeof call>>): Bag => {
  if (!('result' in answer)) throw new Error(`refused: ${answer.code} ${answer.message}`);
  return answer.result;
};

const listing = async (client: Client, uri: string): Promise<string[]> => {
  const answer = got(await call(client, 'resourceList', { uri }));
  const entries = answer['entries'] as { name: string }[] | undefined;
  return (entries ?? []).map((one) => one.name);
};

/** One bot's record as a client reads it, which is what these cases assert on. */
const record = async (client: Client, uri: string): Promise<Bag> => {
  const answer = got(await call(client, 'resourceRead', { uri }));
  expect(answer['encoding']).toBe('utf-8');
  return JSON.parse(String(answer['data'])) as Bag;
};

it('makes a bot from a name alone', async () => {
  const { host, bots } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true })).toEqual({ result: {} });

  const bot = await record(soft, 'bot://motion');
  expect(bot).toMatchObject({
    id: 'motion',
    name: 'Motion',
    labels: [],
    // The maker owns it, and its folder is its own.
    owner: 'user:soft',
    workspace: join(bots, 'motion'),
  });
  expect(BOT_BODIES).toContain(bot['body']);
  expect(BOT_COLORS).toContain(bot['color']);
  expect(Date.parse(String(bot['createdAt']))).not.toBeNaN();
  expect(bot['updatedAt']).toBe(bot['createdAt']);
});

it('refuses a second bot on a slug that is taken', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  const again = await write(soft, 'bot://motion', { name: 'Another' }, { createOnly: true });

  expect(again).toMatchObject({ code: -32010 });
  expect((await record(soft, 'bot://motion'))['name']).toBe('Motion');
});

it('refuses a slug that is not one', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  // An upper-case letter, a slash and a name that starts with a digit are all
  // the same refusal: the slug is the URI path, so there is nowhere else for it
  // to be written and nothing for a bad one to fall back to.
  expect(await write(soft, 'bot://Motion', { name: 'Motion' }, { createOnly: true })).toMatchObject({ code: -32602 });
  expect(await write(soft, 'bot://mo/tion', { name: 'Motion' }, { createOnly: true })).toMatchObject({ code: -32602 });
  expect(await write(soft, 'bot://2motion', { name: 'Motion' }, { createOnly: true })).toMatchObject({ code: -32602 });
});

it('offers in the make form every field a write takes', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const client = host.accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  }) as { _meta?: Record<string, Record<string, unknown>> };

  // The form a client draws a make from, which has to offer what the check
  // takes: a field the check accepts and the form does not offer is one no
  // client can give, and a field the form offers and the check refuses is a
  // form that lies.
  const entry = ready._meta?.['ahpd.resourceProviders']?.['bot'] as Bag | undefined;
  expect(entry).toMatchObject({ title: 'Bot', root: 'bot://' });
  const properties = ((entry?.['manifest'] as Bag)?.['properties'] ?? {}) as Bag;
  expect(Object.keys(properties)).toEqual(expect.arrayContaining([
    'name', 'labels', 'description', 'body', 'color', 'instructions', 'template', 'harness', 'model', 'preset',
    'workspace', 'computer', 'owner',
  ]));
  // A colour is a name or a hex, and the manifest says both.
  expect(properties['color']).toMatchObject({ anyOf: [{ enum: [...BOT_COLORS] }, { pattern: '^#[0-9a-fA-F]{6}$' }] });
});

it('makes a bot with any word as its body, and refuses a colour outside the list', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://dragon', { name: 'Dragon', body: 'dragon' }, { createOnly: true }))
    .toEqual({ result: {} });
  expect(await record(soft, 'bot://dragon')).toMatchObject({ body: 'dragon' });
  expect(await write(soft, 'bot://motion', { name: 'Motion', body: '' }, { createOnly: true }))
    .toMatchObject({ code: -32602 });
  expect(await write(soft, 'bot://motion', { name: 'Motion', color: 'chartreuse' }, { createOnly: true }))
    .toMatchObject({ code: -32602 });
  // And neither refused one was made, which is the half a refusal has to mean.
  expect(await call(soft, 'resourceRead', { uri: 'bot://motion' })).toMatchObject({ code: -32008 });
});

it('makes a bot in a hex colour, and reads it back after a restart', async () => {
  const { host, records } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion', color: '#2f6fdf' }, { createOnly: true })).toEqual({ result: {} });
  expect(await record(soft, 'bot://motion')).toMatchObject({ color: '#2f6fdf' });

  // A daemon that starts again reads the collection, and a hex colour is a
  // colour there too. Its persona comes from the file, as any other read is
  // answered, so the name survives a daemon that never saw the make.
  const problems: string[] = [];
  const held = botStore(
    await records.collection('bots'),
    await records.collection('bots-gone'),
    (line) => problems.push(line),
    { yaml: { parseYaml, stringifyYaml } },
  );
  await held.ready();
  expect(held.get('motion')).toMatchObject({ color: '#2f6fdf', name: 'Motion' });
  expect(problems).toEqual([]);
});

it('gives a bot its own folder, and refuses one another bot has', async () => {
  const { host, bots } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  expect((await record(soft, 'bot://motion'))['workspace']).toBe(join(bots, 'motion'));

  // Two bots in one folder would be two sessions working in the same tree,
  // which is the one thing the folder is for.
  const taken = await write(soft, 'bot://other', { name: 'Other', workspace: join(bots, 'motion') }, { createOnly: true });
  expect(taken).toMatchObject({ code: -32602 });

  // And a bot whose folder somebody named keeps it.
  await write(soft, 'bot://other', { name: 'Other', workspace: join(bots, 'elsewhere') }, { createOnly: true });
  expect((await record(soft, 'bot://other'))['workspace']).toBe(join(bots, 'elsewhere'));

  // A named folder is one under the plugin's root, never one beside it.
  for (const outside of [join(bots, '..', 'escaped'), bots, '/tmp/anywhere']) {
    const refused = await write(soft, 'bot://third', { name: 'Third', workspace: outside }, { createOnly: true });
    expect(refused).toMatchObject({ code: -32602 });
  }
});

it('edits a bot, keeping the slug it was made with', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  const before = await record(soft, 'bot://motion');

  // The way a client edits: read the record, read the validator with it, and
  // write both back - so a second writer who got there first is a conflict
  // rather than a lost update.
  const at = got(await call(soft, 'resourceResolve', { uri: 'bot://motion' }));
  expect(await write(soft, 'bot://motion', { name: 'Moved' }, { ifMatch: String(at['etag']) }))
    .toEqual({ result: {} });

  const after = await record(soft, 'bot://motion');
  expect(after).toMatchObject({ id: 'motion', name: 'Moved', owner: 'user:soft', createdAt: before['createdAt'] });

  // A write against a validator that is not the bot's own is refused, and the
  // bot is left as it was.
  expect(await write(soft, 'bot://motion', { name: 'Stale' }, { ifMatch: 'not-this-one' }))
    .toMatchObject({ code: -32011 });
  expect((await record(soft, 'bot://motion'))['name']).toBe('Moved');

  // And an edit may not name another bot, or another owner: both are the slug
  // and the maker, which a write is not a way to change.
  expect(await write(soft, 'bot://motion', { name: 'Moved', id: 'other' })).toMatchObject({ code: -32602 });
  expect(await write(soft, 'bot://motion', { name: 'Moved', owner: 'user:ana' })).toMatchObject({ code: -32602 });
});

/*
 * The persona is the file's.
 *
 * A bot's `AGENTS.md` is the one copy of its `name`, `description` and
 * `instructions`: a make writes the template filled with them, an edit writes
 * them into the file that is there, and a read answers what the file says. The
 * record keeps what the file cannot - the folder, the owner, the body and
 * colour, the session a message wakes - and never a second copy that would go
 * stale the first time the bot rewrote its own file.
 */
it('writes a bot\'s persona into its AGENTS.md, and keeps none of it in the record', async () => {
  const { host, bots, records } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', {
    name: 'Motion', description: 'Moves things', instructions: 'Be calm',
  }, { createOnly: true });

  // The file a make leaves is its template, filled and with the parts set: the
  // same file a first wake would have made, there from the moment it exists.
  const written = readFileSync(join(bots, 'motion', 'AGENTS.md'), 'utf8');
  expect(written).toContain('name: Motion');
  expect(written).toContain('description: Moves things');
  expect(written).toContain('## Instructions');
  expect(written).toContain('Be calm');
  expect(readFileSync(join(bots, 'motion', 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');

  // And the record has no persona at all: what is there is what the file
  // cannot say.
  const kept = await (await records.collection('bots')).get('motion');
  expect(kept).not.toHaveProperty('name');
  expect(kept).not.toHaveProperty('description');
  expect(kept).not.toHaveProperty('instructions');
  expect(kept).toMatchObject({
    id: 'motion', labels: [], owner: 'user:soft', session: 'work', workspace: join(bots, 'motion'),
  });

  // An edit in the UI writes the parts it owns and leaves the rest of the file
  // as it was, so the template's own section survives it.
  expect(await write(soft, 'bot://motion', { name: 'Moved', instructions: 'Be louder' })).toEqual({ result: {} });
  const edited = readFileSync(join(bots, 'motion', 'AGENTS.md'), 'utf8');
  expect(edited).toContain('name: Moved');
  expect(edited).toContain('Be louder');
  expect(edited).not.toContain('Be calm');
  expect(edited).toContain('## How you work');
  expect(await record(soft, 'bot://motion')).toMatchObject({
    name: 'Moved', description: 'Moves things', instructions: 'Be louder',
  });
});

it('answers a read from the bot\'s own file, so its own edit shows on the next read', async () => {
  const { host, bots } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  // The bot rewrote its own file, which is the thing no record can follow
  // without being a second copy: the file is read at each read of the bot.
  writeFileSync(join(bots, 'motion', 'AGENTS.md'), [
    '---',
    'version: 1',
    'name: Renamed',
    'description: What it calls itself',
    '---',
    '',
    '## Instructions',
    '',
    'Say less.',
    '',
  ].join('\n'));

  expect(await record(soft, 'bot://motion')).toMatchObject({
    name: 'Renamed',
    description: 'What it calls itself',
    instructions: 'Say less.',
  });
});

/** An older record, as a daemon before the file was the one copy wrote it. */
const olderRecord = (folder: string) => ({
  id: 'older',
  name: 'Older',
  description: 'An old bot',
  instructions: 'Be careful',
  labels: [],
  body: 'robot',
  color: 'red',
  session: 'work',
  workspace: folder,
  owner: 'user:soft',
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
});

it('moves an older record\'s parts into the AGENTS.md it already has, and keeps its text', async () => {
  const { host, bots, records } = made({ soft: ['bot:*', 'session:create'] });
  const folder = join(bots, 'older');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'AGENTS.md'), '# Our rules\n\nAsk before pushing.\n');
  await (await records.collection('bots')).put(olderRecord(folder));

  const soft = await as(host, 'soft');
  // The persona is answered from the record that carried it, then from the file
  // it was moved into.
  const read = await record(soft, 'bot://older');
  expect(read).toMatchObject({ name: 'Older', description: 'An old bot', instructions: 'Be careful\n\n# Our rules\n\nAsk before pushing.' });

  // The file got a frontmatter and an Instructions section on top of what the
  // bot had written, and every byte of it is still there.
  const file = readFileSync(join(folder, 'AGENTS.md'), 'utf8');
  expect(file.startsWith('---\n')).toBe(true);
  expect(file).toContain('name: Older');
  expect(file).toContain('description: An old bot');
  expect(file).toContain('## Instructions');
  expect(file).toContain('Be careful');
  expect(file).toContain('# Our rules');
  expect(file).toContain('Ask before pushing.');

  // And the record was put back without the parts, so the next load finds none
  // to move.
  const kept = await (await records.collection('bots')).get('older');
  expect(kept).not.toHaveProperty('name');
  expect(kept).not.toHaveProperty('description');
  expect(kept).not.toHaveProperty('instructions');
  expect(kept).toMatchObject({ id: 'older', color: 'red', workspace: folder });
});

it('makes the AGENTS.md of an older record whose folder has none, from its template', async () => {
  const { host, bots, records } = made({ soft: ['bot:*', 'session:create'] });
  const folder = join(bots, 'older');
  await (await records.collection('bots')).put(olderRecord(folder));
  expect(existsSync(folder)).toBe(false);

  const soft = await as(host, 'soft');
  expect(await record(soft, 'bot://older')).toMatchObject({
    name: 'Older', description: 'An old bot', instructions: 'Be careful',
  });

  // A folder with no file gets the file a bot made today has: the template,
  // filled with its words, and the line that makes Claude read it.
  const file = readFileSync(join(folder, 'AGENTS.md'), 'utf8');
  expect(file.startsWith('---\n')).toBe(true);
  expect(file).toContain('name: Older');
  expect(file).toContain('Be careful');
  expect(file).toContain('## How you work');
  expect(readFileSync(join(folder, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n');

  const kept = await (await records.collection('bots')).get('older');
  expect(kept).not.toHaveProperty('name');
  expect(kept).not.toHaveProperty('instructions');
});

it('leaves a tombstone where a bot was deleted', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  expect(await call(soft, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });

  // Gone from the listing, gone to a read, and never made again: the slug is
  // what a client had the address of, so a different bot under it would be a
  // different bot answering to a name somebody already knows.
  expect(await listing(soft, 'bot://')).toEqual([]);
  expect(await call(soft, 'resourceRead', { uri: 'bot://motion' })).toMatchObject({ code: -32008 });
  expect(await write(soft, 'bot://motion', { name: 'Again' }, { createOnly: true })).toMatchObject({ code: -32010 });
});

it('shows a bot to its owner, to their team, and to whoever holds the grant', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'], ana: ['bot:write', 'session:create'], rob: ['bot:get', 'bot:list'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  // Not hers, and nothing of this scheme held: refused, and not in a listing
  // either - a list that showed a bot a read would refuse is a list of names
  // its reader cannot open.
  const ana = await as(host, 'ana');
  expect(await call(ana, 'resourceRead', { uri: 'bot://motion' })).toMatchObject({ code: -32009 });
  expect(await listing(ana, 'bot://')).toEqual([]);

  // `bot:write` alone is enough to make one of her own, and hers is what she is
  // shown.
  expect(await write(ana, 'bot://hers', { name: 'Hers' }, { createOnly: true })).toEqual({ result: {} });
  expect(await listing(ana, 'bot://')).toEqual(['hers']);

  // And the grant is the other way in: whoever may read every bot reads this
  // one, which is what makes a scheme the host's own rather than each maker's.
  const rob = await as(host, 'rob');
  expect((await record(rob, 'bot://motion'))['name']).toBe('Motion');
  expect(await listing(rob, 'bot://')).toEqual(['hers', 'motion']);
});

it('answers a reader with bot:list only the bots they own when asked', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'], rob: ['bot:list', 'bot:write', 'session:create'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  const rob = await as(host, 'rob');
  await write(rob, 'bot://mine', { name: 'Mine' }, { createOnly: true });

  // The grant is still the listing of every bot.
  expect(await listing(rob, 'bot://')).toEqual(['mine', 'motion']);
  // Asked for the reader's own, it is the one rob made.
  expect(await listing(rob, 'bot://?owner=me')).toEqual(['mine']);
});

it('leaves a team bot out of the listing asked for me', async () => {
  const { host } = made(
    { soft: ['bot:*', 'session:create'], rob: ['bot:list'] },
    { soft: ['backend'], rob: ['backend'] },
  );
  const soft = await as(host, 'soft');
  await write(soft, 'bot://team', { name: 'Team', owner: 'team:backend' }, { createOnly: true });
  const rob = await as(host, 'rob');

  // Readable, because rob is in the team the bot belongs to...
  expect(await listing(rob, 'bot://')).toEqual(['team']);
  // ...and not rob's own, so the filtered listing has it not.
  expect(await listing(rob, 'bot://?owner=me')).toEqual([]);
});

/*
 * The agent a bot's record names.
 *
 * A bot's `preset` or `harness` is an agent of this host, and the host asks its
 * own rule of whoever starts a session on one. A bot is its owner's work, so a
 * write asks the same rule of the owner rather than of the person writing: one
 * person cannot point a bot at another person's agent.
 */
it('refuses a bot naming an agent its owner may not use, on a make and on an edit', async () => {
  const owners = (): ReadonlyMap<string, AgentOwner | undefined> => new Map([
    ['base', 'host'],
    ['theirs', 'user:cy'],
  ]);
  const { host } = made({ soft: ['bot:*', 'session:create'] }, {}, { agentOwners: owners });
  const soft = await as(host, 'soft');

  // The host's own agent is everybody's, and taken.
  expect(await write(soft, 'bot://mine', { name: 'Mine', preset: 'base' }, { createOnly: true })).toEqual({ result: {} });
  // Another person's is refused, with the id and the owner the record is for.
  const refused = await write(soft, 'bot://theirs', { name: 'Theirs', preset: 'theirs' }, { createOnly: true });
  expect(refused).toMatchObject({ code: -32009 });
  expect('code' in refused ? refused.message : '').toContain('theirs is not an agent user:soft may use');
  // And an edit is checked the same way: a record that exists is not a licence.
  const edited = await write(soft, 'bot://mine', { name: 'Mine', preset: 'theirs' });
  expect(edited).toMatchObject({ code: -32009 });
  expect((await record(soft, 'bot://mine'))['preset']).toBe('base');
});

it('answers a bot unavailable when the agent it names is not one this host serves', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  // A bot may name an agent that is not installed yet, so the write is taken;
  // what the read says is that a message to it would wake nothing. The agent a
  // record names is an id, and a plugin removed or an agent record deleted
  // leaves a bot naming one this host no longer has.
  expect(await write(soft, 'bot://gone', { name: 'Gone', preset: 'not-an-agent' }, { createOnly: true }))
    .toEqual({ result: {} });
  expect((await record(soft, 'bot://gone'))['state']).toBe('unavailable');

  // One the host serves is answered as it was written, and one naming no agent
  // at all is not unavailable: there is nothing it named to be missing.
  expect(await write(soft, 'bot://here', { name: 'Here', preset: 'base' }, { createOnly: true }))
    .toEqual({ result: {} });
  expect(await record(soft, 'bot://here')).not.toHaveProperty('state');
  expect(await write(soft, 'bot://plain', { name: 'Plain' }, { createOnly: true })).toEqual({ result: {} });
  expect(await record(soft, 'bot://plain')).not.toHaveProperty('state');
});

/*
 * An agent record the migration made.
 *
 * `presets` became host records with the same ids, and the host owns them, so a
 * bot that named a preset by its id names the record it became: a bot of
 * somebody else's may still wake on it, and the id is the one it wrote.
 */
it('takes a bot naming an agent record the migration made, which the host owns', async () => {
  const owners = (): ReadonlyMap<string, AgentOwner | undefined> => new Map([
    ['claude-deepseek-build', 'host'],
  ]);
  const migrated: Agent = { ...echo({ path: '/', pace: 0 }), provider: 'claude-deepseek-build', displayName: 'DeepSeek build' };
  const { host } = made(
    { soft: ['bot:*', 'session:create'] }, {}, { agentOwners: owners }, true, [migrated],
  );
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://build', { name: 'Build', preset: 'claude-deepseek-build' }, { createOnly: true }))
    .toEqual({ result: {} });
  const held = await record(soft, 'bot://build');
  expect(held['preset']).toBe('claude-deepseek-build');
  // The host's record is one every caller with `session:write` may use, and the
  // host serves the kind it names, so the bot is not unavailable.
  expect(held).not.toHaveProperty('state');
});

/*
 * Who a bot may be made for.
 *
 * A bot belongs to a person, or to a team or a project they are part of, and
 * the last two are the writer's to name only where they are the writer's own.
 * The rule is the read road's, so what a write may make is what its maker may
 * then read.
 */
it('lets a member of a team make a bot the team owns', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] }, { soft: ['backend'] });
  const soft = await as(host, 'soft');

  const answer = await write(soft, 'bot://motion', { name: 'Motion', owner: 'team:backend' }, { createOnly: true });
  expect(answer).toEqual({ result: {} });
  expect((await record(soft, 'bot://motion'))['owner']).toBe('team:backend');
});

it('refuses a bot for a team the writer is not in', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] }, { soft: ['frontend'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion', owner: 'team:backend' }, { createOnly: true }))
    .toMatchObject({ code: -32009 });
  // And nothing was made: a refused write leaves no bot behind it.
  expect(await listing(soft, 'bot://')).toEqual([]);
});

it('lets a member of a project make a bot the project owns', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] }, { soft: ['shop:website'] });
  const soft = await as(host, 'soft');

  const answer = await write(soft, 'bot://storefront', { name: 'Storefront', owner: 'project:shop:website' }, { createOnly: true });
  expect(answer).toEqual({ result: {} });
  expect((await record(soft, 'bot://storefront'))['owner']).toBe('project:shop:website');
});

it('refuses a bot for a project the writer is not in', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] }, { soft: ['shop:billing'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://storefront', { name: 'Storefront', owner: 'project:shop:website' }, { createOnly: true }))
    .toMatchObject({ code: -32009 });
  expect(await listing(soft, 'bot://')).toEqual([]);
});

/*
 * Who an admin may make a bot for.
 *
 * A holder of `*:*` administers the host, so the membership rule is not theirs
 * to meet: they may name any person, any team or project, and this host's own
 * owner. A `root:` that is not this host's is nobody's to name but the root
 * connection's.
 */
it('lets an admin make a bot for another person, who then reads it', async () => {
  const { host } = made({ soft: ['*:*'], ana: ['bot:write', 'session:create'] });
  // A host starts a session for a person only once they have signed in, and a
  // chat is a session: ana signs in before she reads the bot of hers.
  const ana = await as(host, 'ana');
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion', owner: 'user:ana' }, { createOnly: true }))
    .toEqual({ result: {} });
  expect((await record(ana, 'bot://motion'))['owner']).toBe('user:ana');
});

it('lets an admin make a bot for a team they are not in', async () => {
  const { host } = made({ soft: ['*:*'] }, { soft: ['frontend'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion', owner: 'team:backend' }, { createOnly: true }))
    .toEqual({ result: {} });
  expect((await record(soft, 'bot://motion'))['owner']).toBe('team:backend');
});

it('lets an admin make a bot for this host, which a person without bot:get does not see', async () => {
  const { host } = made({ soft: ['*:*'], ana: ['bot:write', 'session:create'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://keeper', { name: 'Keeper', owner: 'root:test' }, { createOnly: true }))
    .toEqual({ result: {} });
  expect((await record(soft, 'bot://keeper'))['owner']).toBe('root:test');

  const ana = await as(host, 'ana');
  expect(await call(ana, 'resourceRead', { uri: 'bot://keeper' })).toMatchObject({ code: -32009 });
  expect(await listing(ana, 'bot://')).toEqual([]);
});

it('writes any root: an admin names as the host under its name today', async () => {
  const { host } = made({ soft: ['*:*'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion', owner: 'root:old-name' }, { createOnly: true }))
    .toEqual({ result: {} });
  expect((await record(soft, 'bot://motion'))['owner']).toBe('root:test');
});

it('takes an edit that names the host under another name, and keeps the owner on record', async () => {
  const { host } = made({ soft: ['*:*'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion', owner: 'root:test' }, { createOnly: true }))
    .toEqual({ result: {} });
  // The machine was renamed since: a client sends the name the manifest gives it now.
  expect(await write(soft, 'bot://motion', { name: 'Moved', owner: 'root:new-name' })).toEqual({ result: {} });
  const bot = await record(soft, 'bot://motion');
  expect(bot['name']).toBe('Moved');
  expect(bot['owner']).toBe('root:test');
});

it('refuses the host as the owner to a writer without *:*', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion', owner: 'root:test' }, { createOnly: true }))
    .toMatchObject({ code: -32009 });
  expect(await listing(soft, 'bot://')).toEqual([]);
});

it('still refuses a bot for another person to a writer without *:*', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion', owner: 'user:ana' }, { createOnly: true }))
    .toMatchObject({ code: -32009 });
  expect(await listing(soft, 'bot://')).toEqual([]);
});

it('names this host\'s own owner in the manifest', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const client = host.accept(peer());
  const ready = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  }) as { _meta?: Record<string, Record<string, unknown>> };

  // A client is never told the host's key, so the manifest is where it reads
  // the owner a host bot is made with.
  const entry = ready._meta?.['ahpd.resourceProviders']?.['bot'] as Bag | undefined;
  const properties = ((entry?.['manifest'] as Bag)?.['properties'] ?? {}) as Bag;
  expect(properties['owner']).toMatchObject({
    anyOf: [{ type: 'string' }, { const: 'root:test', title: 'This host' }],
  });
});

/*
 * Who may change a bot that is already there.
 *
 * Making one is any holder of the grant a write asks for. Changing one is the
 * four ways in: its owner, a member of the team or project it belongs to, an
 * admin, and this host. A bot belongs to somebody, so the grant that makes one
 * may not reach into somebody else's - and neither may a read of every bot.
 */
it('refuses an edit and a delete to a bot whose writer it is not', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'], ana: ['bot:write'], rob: ['bot:*'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion', instructions: 'Be calm' }, { createOnly: true });

  // `bot:write` is the group a write and a delete both ask the host for, so the
  // gate lets all four of these through and the bot is what refuses them.
  const ana = await as(host, 'ana');
  expect(await write(ana, 'bot://motion', { name: 'Ana was here' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('motion') });
  expect(await call(ana, 'resourceDelete', { uri: 'bot://motion' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('motion') });

  // And every operation on this scheme is not the grant that is every grant: a
  // holder of `bot:*` may make a bot of their own and change no other.
  const rob = await as(host, 'rob');
  expect(await write(rob, 'bot://motion', { name: 'Rob was here' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('motion') });
  expect(await call(rob, 'resourceDelete', { uri: 'bot://motion' }))
    .toMatchObject({ code: -32009, message: expect.stringContaining('motion') });

  // Both of them left it exactly as it was.
  expect(await record(soft, 'bot://motion')).toMatchObject({ name: 'Motion', instructions: 'Be calm' });
});

it('lets the owner edit and delete their own bot', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  expect(await write(soft, 'bot://motion', { name: 'Moved' })).toEqual({ result: {} });
  expect((await record(soft, 'bot://motion'))['name']).toBe('Moved');
  expect(await call(soft, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });
  expect(await listing(soft, 'bot://')).toEqual([]);
});

it('lets a member of the team a bot belongs to change it', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'], ana: ['bot:write'] }, { soft: ['backend'], ana: ['backend'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion', owner: 'team:backend' }, { createOnly: true });

  const ana = await as(host, 'ana');
  expect(await write(ana, 'bot://motion', { name: 'Moved' })).toEqual({ result: {} });
  expect((await record(ana, 'bot://motion'))['name']).toBe('Moved');
  expect(await call(ana, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });
});

it('lets an admin change a bot that is not theirs', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'], ana: ['*:*'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  const ana = await as(host, 'ana');
  expect(await write(ana, 'bot://motion', { name: 'Moved' })).toEqual({ result: {} });
  expect((await record(ana, 'bot://motion'))['name']).toBe('Moved');
  expect(await call(ana, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });
});

it('lets the host change any bot', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  // The root connection is the host's own key, and it is not a person whose
  // membership of anything could be asked.
  const root = await door(host);
  expect(await write(root, 'bot://motion', { name: 'Moved' })).toEqual({ result: {} });
  expect(await call(root, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });
});

it('lets a host with no users directory change any bot', async () => {
  // No directory means no principal means nobody to ask, so this host is
  // exactly as open as it was before there was an owner to check.
  const { host } = made({}, {}, {}, false);
  const anyone = host.accept(peer());
  await anyone.handle({
    method: 'initialize',
    params: { clientId: 'anyone', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });

  await write(anyone, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  expect(String((await record(anyone, 'bot://motion'))['owner'])).toMatch(/^root:/);
  expect(await write(anyone, 'bot://motion', { name: 'Moved' })).toEqual({ result: {} });
  expect(await call(anyone, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });
});

it('lets the host make a bot for a team it holds no membership of', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const root = await door(host);

  expect(await write(root, 'bot://motion', { name: 'Motion', owner: 'team:backend' }, { createOnly: true }))
    .toEqual({ result: {} });
  expect((await record(root, 'bot://motion'))['owner']).toBe('team:backend');
});

/*
 * A bot made with no session is made anyway.
 *
 * A bot is a record, a folder, a chat, and the name of the session a message to
 * it wakes. A make leaves the record and the folder behind - the folder because
 * that is where the bot works - and opens nothing: what anybody says to a bot is
 * said in a chat, and a chat is opened by a read of the bot rather than by its
 * maker. The name is written rather than started, so nothing is running until
 * somebody says something.
 */

/**
 * The row a client reads for one session, or the failure of it not being there.
 *
 * A session is in the listing when this host has it, so an empty listing is
 * what a host that started nothing answers with.
 */
const row = async (client: Client, uri: string): Promise<Bag> => {
  const answer = got(await call(client, 'listSessions', { channel: ROOT }));
  const items = (answer['items'] ?? []) as Bag[];
  const found = items.find((one) => one['resource'] === uri);
  if (found === undefined) throw new Error(`${uri} is in no listing`);
  return found;
};

/** Every session this host holds, by URI. */
const allSessions = async (client: Client): Promise<string[]> => {
  const answer = got(await call(client, 'listSessions', { channel: ROOT }));
  return ((answer['items'] ?? []) as Bag[]).map((one) => String(one['resource']));
};

it('runs a bot in its own folder, and makes the folder first', async () => {
  const { host, bots } = made({ soft: ['bot:*', 'session:*'] });
  const soft = await as(host, 'soft');

  const workspace = join(bots, 'motion');
  expect(existsSync(workspace)).toBe(false);
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  // The folder is there for the bot to work in, and it is the bot's whether or
  // not anybody has talked to it: a read answers the same path.
  expect(existsSync(workspace)).toBe(true);
  expect((await record(soft, 'bot://motion'))['workspace']).toBe(workspace);
});

it('starts no session on a make', async () => {
  // A bot is not talked to in a session of its own: what is said to it is said
  // in a chat, and a chat is opened by a read of the bot. So a make opens
  // nothing at all, whatever the body named - a preset, a harness or neither.
  const { host } = made({ soft: ['bot:*', 'session:*'] });
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', { name: 'Motion', preset: 'loud', harness: 'whisper', model: 'the-big-one' }, { createOnly: true });
  await write(soft, 'bot://quiet', { name: 'Quiet' }, { createOnly: true });

  expect(await allSessions(soft)).toEqual([]);
  // The name is on the record, and a name is not a session: the one a bot that
  // names none has is `work`.
  expect((await record(soft, 'bot://motion'))['session']).toBe('work');
});

it('edits a bot whose template was removed, and refuses an edit that names a missing one', async () => {
  const { host, records } = made({ soft: ['bot:*', 'session:*'] });
  const soft = await as(host, 'soft');
  const templates = await records.collection('templates', { body: 'text' });
  await templates.put({ id: 'short', title: 'Short', text: '{{name}}' });
  got(await write(soft, 'bot://motion', { name: 'Motion', template: 'short' }, { createOnly: true }));
  await templates.remove('short');

  got(await write(soft, 'bot://motion', { name: 'Calm' }));
  expect(await write(soft, 'bot://motion', { name: 'Calm', template: 'short' }))
    .toMatchObject({ code: -32602, message: 'The template short does not exist.' });
});

it('refuses a make that names a template that does not exist', async () => {
  const { host } = made({ soft: ['bot:*', 'session:*'] });
  const soft = await as(host, 'soft');

  expect(await write(soft, 'bot://motion', { name: 'Motion', template: 'missing' }, { createOnly: true }))
    .toMatchObject({ code: -32602, message: 'The template missing does not exist.' });
  // Nothing was made, so the name is still free.
  expect(await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true })).toMatchObject({ result: {} });
});

it('takes the name of a back session, and fills one a bot named none of', async () => {
  const { host, bots, records } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  await write(soft, 'bot://motion', { name: 'Motion', session: 'reviews' }, { createOnly: true });
  expect((await record(soft, 'bot://motion'))['session']).toBe('reviews');

  // A name a session can have is a slug, and `{turn}` is the one word it may
  // hold: a body that names anything else is refused, so a name read back off a
  // bot is always a name a message can wake.
  expect(await write(soft, 'bot://other', { name: 'Other', session: 'claude:/one' }, { createOnly: true }))
    .toMatchObject({
      code: -32602,
      message: 'claude:/one is not a name a back session can have: lowercase letters, digits, a dash and {turn}, starting with a letter',
    });
  expect(await write(soft, 'bot://job', { name: 'Job', session: 'job-{turn}' }, { createOnly: true }))
    .toMatchObject({ result: {} });

  // A file written before a bot named one is read as a bot that named none: the
  // store fills the name in, so nothing that reads a bot has to know the default.
  await (await records.collection('bots')).put({
    id: 'older',
    name: 'Older',
    labels: [],
    body: 'robot',
    color: 'red',
    workspace: join(bots, 'older'),
    owner: 'user:soft',
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
  });

  expect((await record(soft, 'bot://older'))['session']).toBe('work');
});

/*
 * The writes `docs/plugins/BOTS.md` prints, sent as the file prints them.
 *
 * The examples in that file are bodies a client may copy, so they are bodies
 * this host has to answer. A change on either side the other did not follow is
 * a doc that has stopped being true.
 */
it('answers the writes docs/plugins/BOTS.md shows', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');

  // A make from a name alone.
  expect(await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true })).toEqual({ result: {} });

  // A bot on a harness of its own, with a body and a colour of its choosing.
  expect(await write(soft, 'bot://reader', {
    name: 'Motion',
    labels: ['review', 'ci'],
    description: 'Reads pull requests and says what would break.',
    body: 'robot',
    color: 'teal',
    instructions: 'You review pull requests. Say what would break, in one paragraph.',
    harness: 'claude',
    model: 'claude-sonnet-5',
  }, { createOnly: true })).toEqual({ result: {} });
  expect(await record(soft, 'bot://reader')).toMatchObject({
    body: 'robot', color: 'teal', harness: 'claude', model: 'claude-sonnet-5',
  });
});

/*
 * A watch on the scheme.
 *
 * `createResourceWatch` on `bot://` hears every bot its reader may see being
 * made, edited and deleted, and a watch on `bot://<slug>` hears that one bot.
 * What a watcher hears is what a read or a listing would show it.
 */

/** A client signed in as `token` whose peer keeps every notification it is sent. */
async function listening(host: ReturnType<typeof createHost>, token: string) {
  const notes: { method: string; params: unknown }[] = [];
  const client = host.accept({ ...peer(), notify: (method, params) => { notes.push({ method, params }); } });
  await client.handle({
    method: 'initialize',
    params: { clientId: token, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token } });
  /** Open a watch on `uri` and subscribe to it, and answer the channel. */
  const watch = async (uri: string): Promise<string> => {
    const { channel } = got(await call(client, 'createResourceWatch', { channel: ROOT, uri })) as { channel: string };
    got(await call(client, 'subscribe', { channel }));
    return channel;
  };
  /** Every change told on one channel so far, as `<type> <uri>`. */
  const heard = (channel: string): string[] => notes
    .filter((n) => n.method === 'action')
    .map((n) => n.params as { channel: string; action: { type: string; changes?: { items: { uri: string; type: string }[] } } })
    .filter((n) => n.channel === channel && n.action.type === 'resourceWatch/changed')
    .flatMap((n) => n.action.changes?.items ?? [])
    .map((one) => `${one.type} ${one.uri}`);
  return { client, watch, heard };
}

it('tells a watch on bot:// about a bot its owner makes, edits and deletes', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await listening(host, 'soft');
  const channel = await soft.watch('bot://');

  await write(soft.client, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  await write(soft.client, 'bot://motion', { name: 'Motion two' });
  expect(await call(soft.client, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });

  expect(soft.heard(channel)).toEqual(['added bot://motion', 'updated bot://motion', 'deleted bot://motion']);
});

it('tells a watch on one bot about that bot and nothing else', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await listening(host, 'soft');
  await write(soft.client, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  const channel = await soft.watch('bot://motion');

  await write(soft.client, 'bot://other', { name: 'Other' }, { createOnly: true });
  await write(soft.client, 'bot://motion', { name: 'Motion two' });

  expect(soft.heard(channel)).toEqual(['updated bot://motion']);
});

it('refuses a watch on a bot that does not exist, or on a path under one', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await listening(host, 'soft');
  await write(soft.client, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  expect(await call(soft.client, 'createResourceWatch', { channel: ROOT, uri: 'bot://nobody' })).toMatchObject({ code: expect.any(Number) });
  expect(await call(soft.client, 'createResourceWatch', { channel: ROOT, uri: 'bot://motion/leaf' })).toMatchObject({ code: expect.any(Number) });
});

it('tells a watcher only about the bots it may read', async () => {
  const { host } = made(
    { soft: ['bot:*', 'session:create'], ana: ['bot:watch'], bea: ['bot:watch'], rob: ['bot:watch', 'bot:list'] },
    { soft: ['backend'], ana: ['backend'] },
  );
  const soft = await listening(host, 'soft');
  const ana = await listening(host, 'ana');
  const bea = await listening(host, 'bea');
  const rob = await listening(host, 'rob');
  const [own, member, stranger, granted] = [await soft.watch('bot://'), await ana.watch('bot://'), await bea.watch('bot://'), await rob.watch('bot://')];

  await write(soft.client, 'bot://team', { name: 'Team', owner: 'team:backend' }, { createOnly: true });
  await write(soft.client, 'bot://mine', { name: 'Mine' }, { createOnly: true });

  // The owner hears both, the team member hears the team's bot, a person of
  // no team hears neither, and whoever may list every bot hears both.
  expect(soft.heard(own)).toEqual(['added bot://team', 'added bot://mine']);
  expect(ana.heard(member)).toEqual(['added bot://team']);
  expect(bea.heard(stranger)).toEqual([]);
  expect(rob.heard(granted)).toEqual(['added bot://team', 'added bot://mine']);
});

it('tells a watch nothing once its last subscriber leaves', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await listening(host, 'soft');
  const channel = await soft.watch('bot://');
  await write(soft.client, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  got(await call(soft.client, 'unsubscribe', { channel }));
  await write(soft.client, 'bot://motion', { name: 'Motion two' });

  expect(soft.heard(channel)).toEqual(['added bot://motion']);
});

/*
 * The chat a read of a bot answers.
 *
 * A bot is talked to in a chat: one session of the `bot-chat` provider per bot
 * and person, which runs no model and keeps what was said a line at a time. A
 * read of `bot:/<slug>` is the one door onto it, so that is where one is opened:
 * whoever holds `bot:chat`, or owns the bot, is answered the URI of their own,
 * and reads the same bot again to find the same conversation. A reader who may
 * not chat is answered the record alone, which is not a refusal - there is
 * nothing wrong with their read, there is simply no conversation of theirs.
 */

/** The id inside a session URI, which is what the session store is keyed by. */
const idIn = (uri: string): string => uri.slice(uri.indexOf(':') + 1).replace(/^\/+/, '');

it('answers a read with the reader\'s own chat, and the same chat again', async () => {
  const { host, bots, sessions } = made({
    soft: ['bot:*', 'session:create'],
    ana: ['bot:get', 'bot:chat', 'session:create', 'session:read'],
  });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  const ana = await as(host, 'ana');
  const first = await record(ana, 'bot://motion');
  const chat = String(first['chat']);
  expect(chat).toMatch(/^ahp-session:\//);
  // A session of the plugin's own provider, in the bot's folder, named after
  // the bot, and hers: it is the same session she would have started herself.
  expect(await row(ana, chat)).toMatchObject({
    title: 'Motion',
    workingDirectories: [uriOf(join(bots, 'motion'))],
  });
  expect(sessions.owner(idIn(chat))).toBe('user:ana');

  // And the second read is the same conversation: a person reads a bot over and
  // over, and a session started for each read would be a chat per glance.
  expect((await record(ana, 'bot://motion'))['chat']).toBe(chat);
});

it('gives two people a chat each with one bot', async () => {
  const { host } = made({
    // The owner holds no chat grant of her own and chats anyway: the grant is
    // for everybody else, which is the read road's rule for `bot:get`.
    soft: ['bot:write', 'session:create'],
    ana: ['bot:get', 'bot:chat', 'session:create'],
  });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  const hers = String((await record(soft, 'bot://motion'))['chat']);
  const ana = await as(host, 'ana');
  const theirs = String((await record(ana, 'bot://motion'))['chat']);

  // One bot, two conversations: what each of them says to it is their own.
  expect(hers).toMatch(/^ahp-session:\//);
  expect(theirs).toMatch(/^ahp-session:\//);
  expect(theirs).not.toBe(hers);
});

it('answers a reader who may not chat with the record alone', async () => {
  const { host } = made({ soft: ['bot:*', 'session:create'], rob: ['bot:get', 'session:read'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  const rob = await as(host, 'rob');
  const read = await record(rob, 'bot://motion');
  expect(read).toMatchObject({ id: 'motion', name: 'Motion' });
  expect(read).not.toHaveProperty('chat');

  // And nothing was opened for him: a chat he may not have is not started on
  // the way to being withheld.
  const listed = got(await call(rob, 'listSessions', { channel: ROOT }));
  const items = (listed['items'] ?? []) as Bag[];
  expect(items.map((one) => String(one['resource'])).filter((one) => one.startsWith('ahp-session:/'))).toEqual([]);
});

/*
 * One bot, one folder.
 *
 * All the data of one bot is `<configDir>/bots/<slug>/`: its record is
 * `bot.md`, its main chat rows are in `chats/`, its back session rows in
 * `sessions/` and its chat logs in `logs/`. A delete removes that folder, and
 * the bot's work folder under the plugin root is not part of it and stays.
 */

it('keeps a bot, its chat rows, its back session rows and its logs in bots/<slug>/', async () => {
  const { host, bots, configDir, reported } = made(
    { soft: ['bot:*', 'chat:*', 'session:create', 'session:state', 'session:write'] }, {}, {}, true, [], true,
  );
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  // The record is the file of the bot's own folder.
  const folder = join(configDir, 'bots', 'motion');
  expect(readFileSync(join(folder, 'bot.md'), 'utf8')).toContain('id: motion');

  // A read opens the main chat, whose row is in the folder beside the record.
  const read = await record(soft, 'bot://motion');
  const session = String(read['chat']);
  const chats = readdirSync(join(folder, 'chats'));
  expect(chats).toHaveLength(1);
  expect(readFileSync(join(folder, 'chats', String(chats[0])), 'utf8')).toContain(`chat: ${session}`);

  // A message wakes the back session behind the chat: the row that names the
  // session, and the log of the chat, are in the same folder.
  const opened = got(await call(soft, 'subscribe', { channel: session })) as { snapshot: { state: Bag } };
  const channel = String(opened.snapshot.state['defaultChat']);
  got(await call(soft, 'dispatchAction', {
    channel,
    action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } },
  }));
  await vi.waitFor(() => {
    expect(reported).toEqual([]);
    expect(readdirSync(join(folder, 'logs'))).toHaveLength(1);
    expect(readdirSync(join(folder, 'sessions'))).toHaveLength(1);
  });

  // The work folder is not data of the daemon's, and is untouched.
  expect(existsSync(join(bots, 'motion', 'AGENTS.md'))).toBe(true);
});

it('moves an older layout into each bot\'s folder at load, and keeps the instructions in its body', async () => {
  const { host, bots, configDir } = made(
    { soft: ['bot:*', 'session:create'] },
    {},
    {},
    true,
    [],
    true,
    (configDir, bots) => {
      // The record of an older daemon: `bots/<slug>.md`, with the persona still
      // in its body rather than in the bot's `AGENTS.md`.
      mkdirSync(join(configDir, 'bots'), { recursive: true });
      writeFileSync(join(configDir, 'bots', 'motion.md'), [
        '---',
        'id: motion',
        'name: Motion',
        'labels: []',
        'body: robot',
        'color: red',
        'session: work',
        `workspace: ${join(bots, 'motion')}`,
        'owner: user:soft',
        'createdAt: 2026-10-11T00:00:00.000Z',
        'updatedAt: 2026-10-11T00:00:00.000Z',
        '---',
        'Be brief.',
      ].join('\n'));
      // And the rows and the log, in the two collections they shared.
      mkdirSync(join(configDir, 'bot-chats'));
      writeFileSync(join(configDir, 'bot-chats', 'old-chat.md'), [
        '---', 'id: old-chat', 'bot: motion', 'owner: user:soft', 'chat: bot-chat:/old', '---', '',
      ].join('\n'));
      writeFileSync(join(configDir, 'bot-chats', 'old.jsonl'),
        `${JSON.stringify({ id: 't1', message: { text: 'hi' }, _meta: { bot: 'motion' } })}\n`);
      mkdirSync(join(configDir, 'bot-sessions'));
      writeFileSync(join(configDir, 'bot-sessions', 'old-back.md'), [
        '---', 'id: old-back', 'bot: motion', 'user: soft', 'name: work', 'session: ahp-session:/old', '---', '',
      ].join('\n'));
    },
  );

  // The record moved, and its body is still the instructions: the file was
  // renamed rather than read and written back.
  const folder = join(configDir, 'bots', 'motion');
  const recordFile = join(folder, 'bot.md');
  expect(readFileSync(recordFile, 'utf8')).toContain('Be brief.');
  expect(existsSync(join(configDir, 'bots', 'motion.md'))).toBe(false);
  expect(readdirSync(join(folder, 'chats'))).toEqual(['old-chat.md']);
  expect(readdirSync(join(folder, 'sessions'))).toEqual(['old-back.md']);
  expect(readdirSync(join(folder, 'logs'))).toEqual(['old.jsonl']);

  // A read moves the persona into the bot's `AGENTS.md`, which is its one copy.
  const soft = await as(host, 'soft');
  const read = await record(soft, 'bot://motion');
  expect(read['instructions']).toBe('Be brief.');
  expect(readFileSync(recordFile, 'utf8')).not.toContain('Be brief.');
  expect(readFileSync(join(bots, 'motion', 'AGENTS.md'), 'utf8')).toContain('Be brief.');
});

/** A tombstone as the `bots-gone` collection holds it. */
const tombstone = (id: string): string => `---\n${stringifyYaml({ id, deletedAt: '2026-10-11T00:00:00.000Z' })}---\n`;

/** A record as `bots/<slug>/bot.md` holds it, with no persona. */
const recordFile = (id: string, workspace: string): string => `---\n${stringifyYaml({
  id,
  labels: [],
  body: 'robot',
  color: 'red',
  session: 'work',
  workspace,
  owner: 'user:soft',
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
})}---\n`;

it('removes nothing for a tombstone whose name is not a bot\'s', async () => {
  const { configDir, reported } = made(
    { soft: ['bot:*', 'session:create'] },
    {},
    {},
    true,
    [],
    true,
    (configDir) => {
      mkdirSync(join(configDir, 'bots-gone'), { recursive: true });
      for (const name of ['..md', '...md', 'Foo.md']) writeFileSync(join(configDir, 'bots-gone', name), 'gone\n');
      // What a `..` or a `...` read as a slug would remove: the configuration
      // folder itself, and a folder an editor left in it.
      mkdirSync(join(configDir, 'templates'), { recursive: true });
      writeFileSync(join(configDir, 'templates', 'kept.md'), 'kept\n');
    },
  );

  for (const name of ['..md', '...md', 'Foo.md']) {
    expect(existsSync(join(configDir, 'bots-gone', name))).toBe(true);
  }
  expect(existsSync(join(configDir, 'templates', 'kept.md'))).toBe(true);
  expect(reported.join('\n')).toMatch(/bots-gone\/\.\.md was left where it is: \. is not a bot's name/);
  expect(reported.join('\n')).toMatch(/bots-gone\/Foo\.md was left where it is: Foo is not a bot's name/);
});

it('keeps a tombstoned folder that still holds its record, and reports the spent name', async () => {
  const { host, configDir, reported } = made(
    { soft: ['bot:*', 'session:create'] },
    {},
    {},
    true,
    [],
    true,
    (configDir, bots) => {
      mkdirSync(join(configDir, 'bots-gone'), { recursive: true });
      writeFileSync(join(configDir, 'bots-gone', 'motion.md'), tombstone('motion'));
      mkdirSync(join(configDir, 'bots', 'motion'), { recursive: true });
      writeFileSync(join(configDir, 'bots', 'motion', 'bot.md'), recordFile('motion', join(bots, 'motion')));
    },
  );
  const soft = await as(host, 'soft');

  // The folder is all that is left of a bot that was deleted, and a record
  // that came back inside it is not a bot the host answers.
  expect(existsSync(join(configDir, 'bots', 'motion', 'bot.md'))).toBe(true);
  expect(await listing(soft, 'bot://')).toEqual([]);
  expect(await call(soft, 'resourceRead', { uri: 'bot://motion' })).toMatchObject({ code: -32008 });
  expect(reported.join('\n')).toMatch(/bots\/motion was kept: motion has a tombstone, so the name is spent/);
  expect(reported.join('\n')).toMatch(/bots\/motion has a tombstone; the name is spent and it was left out/);
});

it('removes the rows and logs a deleted bot left in the older collections', async () => {
  const { configDir, reported } = made(
    { soft: ['bot:*', 'session:create'] },
    {},
    {},
    true,
    [],
    true,
    (configDir) => {
      mkdirSync(join(configDir, 'bots-gone'), { recursive: true });
      writeFileSync(join(configDir, 'bots-gone', 'motion.md'), tombstone('motion'));
      mkdirSync(join(configDir, 'bot-chats'), { recursive: true });
      writeFileSync(join(configDir, 'bot-chats', 'row.md'), '---\nid: row\nbot: motion\n---\n');
      writeFileSync(join(configDir, 'bot-chats', 'log.jsonl'), `${JSON.stringify({ _meta: { bot: 'motion' } })}\n`);
      mkdirSync(join(configDir, 'bot-sessions'), { recursive: true });
      writeFileSync(join(configDir, 'bot-sessions', 'back.md'), '---\nid: back\nbot: motion\n---\n');
    },
  );

  expect(existsSync(join(configDir, 'bot-chats', 'row.md'))).toBe(false);
  expect(existsSync(join(configDir, 'bot-chats', 'log.jsonl'))).toBe(false);
  expect(existsSync(join(configDir, 'bot-sessions', 'back.md'))).toBe(false);
  expect(reported.join('\n')).not.toMatch(/was left where it is/);
});

it('leaves a file the move cannot place, and reports it', async () => {
  const { configDir, reported } = made(
    { soft: ['bot:*', 'session:create'] },
    {},
    {},
    true,
    [],
    true,
    (configDir) => {
      mkdirSync(join(configDir, 'bot-chats'), { recursive: true });
      writeFileSync(join(configDir, 'bot-chats', 'anon.md'), '---\nid: anon\n---\n');
      writeFileSync(join(configDir, 'bot-chats', 'notes.txt'), 'not a row\n');
      mkdirSync(join(configDir, 'bot-sessions'), { recursive: true });
      writeFileSync(join(configDir, 'bot-sessions', 'anon.md'), '---\nid: anon\n---\n');
    },
  );

  expect(existsSync(join(configDir, 'bot-chats', 'anon.md'))).toBe(true);
  expect(existsSync(join(configDir, 'bot-chats', 'notes.txt'))).toBe(true);
  expect(existsSync(join(configDir, 'bot-sessions', 'anon.md'))).toBe(true);
  expect(reported.join('\n')).toMatch(/bot-chats\/anon\.md was left where it is: it names no bot/);
  expect(reported.join('\n')).toMatch(/bot-chats\/notes\.txt was left where it is: it is not a chat row or a log/);
  expect(reported.join('\n')).toMatch(/bot-sessions\/anon\.md was left where it is: it names no bot/);
});

it('deletes a bot by removing bots/<slug>/, and keeps its work folder', async () => {
  const { host, bots, configDir } = made({ soft: ['bot:*', 'session:create'] }, {}, {}, true, [], true);
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });
  // A read, so the folder holds a chat row beside the record.
  await record(soft, 'bot://motion');

  const folder = join(configDir, 'bots', 'motion');
  expect(readdirSync(folder).sort()).toEqual(['bot.md', 'chats']);
  const work = join(bots, 'motion', 'AGENTS.md');
  expect(existsSync(work)).toBe(true);

  expect(await call(soft, 'resourceDelete', { uri: 'bot://motion' })).toEqual({ result: {} });

  expect(existsSync(folder)).toBe(false);
  // The folder a bot works in is the operator's, not data of the daemon's.
  expect(existsSync(work)).toBe(true);
});

it('takes a write that carries a chat back, and keeps none of it', async () => {
  const { host, records } = made({ soft: ['bot:*', 'session:create'] });
  const soft = await as(host, 'soft');
  await write(soft, 'bot://motion', { name: 'Motion' }, { createOnly: true });

  // The way a client edits: it read the record, so what it writes back is the
  // record with the chat it was answered. `chat` is the reader's own rather
  // than a bot's field, so a body carrying one is a body about the rest.
  const read = await record(soft, 'bot://motion');
  expect(String(read['chat'])).toMatch(/^ahp-session:\//);
  expect(await write(soft, 'bot://motion', read)).toEqual({ result: {} });

  // None of it is kept, and the chat it was given is still the one it answers
  // with - a chat is not something a write can move.
  const kept = await (await records.collection('bots')).get('motion');
  expect(kept).not.toHaveProperty('chat');
  expect((await record(soft, 'bot://motion'))['chat']).toBe(read['chat']);
});
