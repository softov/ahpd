import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memoryRecords } from '@ahpd/sdk';
import type { PluginSpec, RecordCollection, ServedEngine, StoredRecord, Vault } from '@ahpd/sdk';
import { applyPresets, planPresets, splitModels } from '../src/agents/migrate.js';
import { fileRecords } from '../src/records.js';

/*
 * The presets a configuration file holds, made into host records at the start.
 *
 * A file written before records named its agents as `presets` of the plugin
 * that ran them, or as a `provider` beside `displayName`. This is the one start
 * that turns each of them into a record owned by the host - the owner the
 * plugins registered them for - and takes them out of the file, with a copy of
 * the file beside it first. The cases here are the whole of that: six presets
 * of four engines becoming six records of the same ids, a second start that finds
 * nothing to move, a record that cannot be written leaving the file alone, and
 * the ids that cannot become a record at all being said rather than kept.
 *
 * The secret a preset wrote in plaintext is a case of its own: a record may hold
 * no value a listing would serve, so it is moved to the vault under the record's
 * own name, as a put of the agents channel moves one, and the record keeps a
 * reference. A preset that did not become a record stays in the file, a removed
 * claude stays removed, and a value a flag set for one run is never made a
 * record.
 *
 * Every case is in a folder of its own under the system's temporary folder, and
 * the records are a store in memory: nothing here reads or writes a person's own
 * configuration.
 */

/** The moment every backup is stamped with, so a name is expectable. */
const WHEN = new Date('2026-10-24T12:00:00.000Z');

/** The value the ACP preset below writes in plaintext, which no record may hold. */
const KEY = 'sk-a-key-nobody may read in a log';

/** The file's own plugins: two Claude variants, two ACP rows, cofold and pi. */
const PLUGINS: PluginSpec[] = [
  {
    name: '@ahpd/agent-claude',
    options: {
      presets: {
        claude: { models: [{ id: 'opus', name: 'Opus' }] },
        'claude-deepseek-build': {
          name: 'DeepSeek build',
          models: [],
          env: {
            ANTHROPIC_BASE_URL: 'https://api.deepseek.example/anthropic',
            ANTHROPIC_AUTH_TOKEN: { $secret: 'host:deepseek' },
          },
        },
      },
    },
  },
  {
    name: '@ahpd/agent-acp',
    options: {
      hostTools: false,
      presets: {
        codex: { env: { CODEX_API_KEY: KEY } },
        work: { base: 'copilot', name: 'Copilot work', command: 'copilot', env: { COPILOT_HOME: '/tmp/copilot' } },
      },
    },
  },
  {
    name: '@ahpd/agent-cofold',
    options: { provider: 'cofold-build', displayName: 'cofold build', model: 'deepseek-chat' },
  },
  {
    name: '@ahpd/agent-pi',
    options: { provider: 'pi-local', displayName: 'pi local' },
  },
];

/** One engine as a plugin registers it, with only the fields the migration reads. */
const engineOf = (name: string, schema: Record<string, unknown>, keyVariables?: string[]): ServedEngine => ({
  name,
  title: name,
  description: `the ${name} engine`,
  schema,
  ...(keyVariables === undefined ? {} : { keyVariables }),
  by: 'test',
  open: () => { throw new Error('no record is opened here'); },
});

/**
 * The four engines, with the secret fields the channel's own put reads: an ACP
 * key and a claude token are `keyVariables`, and a cofold key is `writeOnly`.
 */
const KINDS: Record<string, ServedEngine> = {
  claude: engineOf('claude', { properties: { models: {}, env: {} } }, ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN']),
  acp: engineOf('acp', { properties: { command: {}, env: {} } }, ['CODEX_API_KEY', 'COPILOT_GITHUB_TOKEN', 'GEMINI_API_KEY']),
  cofold: engineOf('cofold', { properties: { apiKey: { type: 'string', writeOnly: true }, baseUrl: {} } }),
  pi: engineOf('pi', { properties: { env: {} } }, ['DEEPSEEK_API_KEY']),
};

let dir: string;
let configFile: string;
let records: RecordCollection;
let said: string[];
let secrets: Map<string, string>;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ahpd-migrate-'));
  configFile = join(dir, 'config.json');
  records = await memoryRecords().collection('agents', { format: 'json' });
  said = [];
  secrets = new Map();
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** A configuration file holding these plugins, as a person would have written it. */
const written = (plugins: unknown): string => {
  const text = `${JSON.stringify({ host: '127.0.0.1', port: 9187, plugins }, null, 2)}\n`;
  writeFileSync(configFile, text);
  return text;
};

/** The vault a start writes a record's key to, in memory. */
const vault = (): Vault => ({
  get: async (name) => secrets.get(name),
  set: async (name, value) => { secrets.set(name, value); },
  delete: async (name) => secrets.delete(name),
  list: async () => [...secrets.keys()].sort(),
});

/**
 * One start's migration: the plan the daemon makes before the plugins load,
 * then the write step once the engines are known.
 */
const migrate = async (
  plugins: PluginSpec[],
  store: RecordCollection = records,
  keyring: Vault | undefined = vault(),
  recordsDir: string = dir,
) => {
  const say = (line: string): void => { said.push(line); };
  const plan = planPresets({ plugins, configFile, recordsDir, log: say });
  const applied = await applyPresets({ plan, records: store, recordsDir, engines: KINDS, vault: keyring, log: say, now: () => WHEN });
  return { plugins: plan.plugins, written: applied.written };
};

/** Every record the store holds, by id. */
const held = async (store: RecordCollection = records): Promise<Map<string, StoredRecord>> =>
  new Map((await store.list()).map((one) => [one.id, one]));

/** The file as it is on disk, parsed. */
const file = (): Record<string, unknown> => JSON.parse(readFileSync(configFile, 'utf8')) as Record<string, unknown>;

/** The plugin entries the file now holds. */
const entries = (): Record<string, unknown>[] => (file()['plugins'] as Record<string, unknown>[]);

/** The plugins a run reads from the file when no flag names any. */
const filed = (): PluginSpec[] => entries() as unknown as PluginSpec[];

/** The one entry the file holds under this package. */
const entryOf = (name: string): Record<string, unknown> => {
  const found = entries().find((one) => one['name'] === name);
  if (found === undefined) throw new Error(`the file has no ${name} entry`);
  return found;
};

/** The backup the migration left beside the configuration. */
const backups = (): string[] => readdirSync(dir).filter((one) => one.startsWith('config.json.bak-'));

it('moves every preset to a host record of the same id, and takes them out of the file', async () => {
  written(PLUGINS);
  const before = readFileSync(configFile, 'utf8');

  const moved = await migrate(PLUGINS);
  expect(moved.written).toEqual(['claude', 'claude-deepseek-build', 'codex', 'work', 'cofold-build', 'pi-local']);

  const all = await held();
  expect([...all.keys()].sort()).toEqual(['claude', 'claude-deepseek-build', 'codex', 'cofold-build', 'pi-local', 'work']);
  // Every record is the host's, which is who owned the agents a preset
  // registered: a record with no readable owner is served to nobody.
  expect([...all.values()].map((one) => one['owner'])).toEqual(Array.from({ length: 6 }, () => 'host'));
  expect([...all.values()].map((one) => one['engine']).sort()).toEqual([
    'acp', 'acp', 'claude', 'claude', 'cofold', 'pi',
  ]);

  // The built-in claude, named by the plugin's own default and carrying its
  // models; and the variant, whose name is the record's and whose key stays the
  // name it was written as.
  expect(all.get('claude')).toMatchObject({
    id: 'claude',
    engine: 'claude',
    owner: 'host',
    name: 'Claude',
    config: { models: [{ id: 'opus', name: 'Opus' }] },
  });
  expect(all.get('claude-deepseek-build')).toMatchObject({
    name: 'DeepSeek build',
    config: {
      models: [],
      env: {
        ANTHROPIC_BASE_URL: 'https://api.deepseek.example/anthropic',
        // A `$secret` is moved as it was written: nothing here reads a value.
        ANTHROPIC_AUTH_TOKEN: { $secret: 'host:deepseek' },
      },
    },
  });

  // An ACP record takes the shipped row's name and keeps its own `base`, which
  // is how a record names a row it is not named after. Its key was written in
  // plaintext, so it is in the vault and the record holds a reference.
  expect(all.get('codex')).toMatchObject({
    engine: 'acp',
    name: 'Codex',
    config: { env: { CODEX_API_KEY: { $secret: 'host:agent/codex/env.CODEX_API_KEY' } } },
  });
  expect(secrets.get('host:agent/codex/env.CODEX_API_KEY')).toBe(KEY);
  expect(all.get('work')).toMatchObject({
    engine: 'acp',
    name: 'Copilot work',
    config: { base: 'copilot', command: 'copilot', env: { COPILOT_HOME: '/tmp/copilot' } },
  });
  // cofold and pi wrote one agent as their own options; its id is the record's
  // and every other option stays the plugin's default.
  expect(all.get('cofold-build')).toMatchObject({ engine: 'cofold', name: 'cofold build', config: {} });
  expect(all.get('pi-local')).toMatchObject({ engine: 'pi', name: 'pi local', config: {} });

  // The file lost what the records hold, and kept what is the plugin's own.
  expect(entries()).toEqual([
    { name: '@ahpd/agent-claude' },
    { name: '@ahpd/agent-acp', options: { hostTools: false } },
    { name: '@ahpd/agent-cofold', options: { model: 'deepseek-chat' } },
    { name: '@ahpd/agent-pi' },
  ]);

  // A copy of the file as it was, beside it and named after it.
  const kept = backups();
  expect(kept).toEqual(['config.json.bak-2026-10-24T12-00-00-000Z']);
  expect(readFileSync(join(dir, kept[0] as string), 'utf8')).toBe(before);

  // One line, naming the ids and no field value.
  expect(said).toHaveLength(1);
  expect(said[0]).toBe(
    `Moved 6 presets to agent records owned by the host: ${moved.written.join(', ')}. `
    + `${join(dir, 'config.json.bak-2026-10-24T12-00-00-000Z')} holds the file as it was.`,
  );
  expect(said.join('\n')).not.toContain('sk-a-key');
  expect(said.join('\n')).not.toContain('api.deepseek.example');
});

it('finds nothing to do at a second start', async () => {
  written(PLUGINS);
  await migrate(PLUGINS);
  const once = readFileSync(configFile, 'utf8');
  const recordsBefore = await held();
  said.length = 0;

  // The second start reads the file the first one left, which is what the
  // daemon does: the plugins are the ones the file names.
  const again = await migrate(filed());

  expect(again.written).toEqual([]);
  expect(await held()).toEqual(recordsBefore);
  expect(readFileSync(configFile, 'utf8')).toBe(once);
  // No second backup, and nothing said.
  expect(backups()).toHaveLength(1);
  expect(said).toEqual([]);
});

it('leaves the file untouched when a record cannot be written, and writes the rest next time', async () => {
  const before = written(PLUGINS);
  /** The store, refusing the one record this case cannot write. */
  const refusing: RecordCollection = {
    ...records,
    put: async (record) => {
      if (record.id === 'work') throw new Error('the disk is full');
      await records.put(record);
    },
  };

  const stopped = await migrate(PLUGINS, refusing);
  // The three before the failure are records; the rest is still in the file.
  expect(stopped.written).toEqual(['claude', 'claude-deepseek-build', 'codex']);
  expect([...await held()]).toHaveLength(3);
  expect(readFileSync(configFile, 'utf8')).toBe(before);
  expect(backups()).toEqual([]);
  // The loader was handed the cleaned specs before the writes, so a failure
  // cannot put the presets back into a plugin's options.
  expect(stopped.plugins).toEqual([
    { name: '@ahpd/agent-claude' },
    { name: '@ahpd/agent-acp', options: { hostTools: false } },
    { name: '@ahpd/agent-cofold', options: { model: 'deepseek-chat' } },
    { name: '@ahpd/agent-pi' },
  ]);
  expect(said.join('\n')).toContain('work could not be written as a record: the disk is full');
  expect(said.join('\n')).not.toContain('sk-a-key');

  // And the next start, with a store that can write, moves the rest.
  const then = await migrate(PLUGINS);
  expect(then.written).toEqual(['work', 'cofold-build', 'pi-local']);
  expect(entries()).toHaveLength(4);
});

it('says each preset whose id cannot be a record, and moves the others', async () => {
  written([
    {
      name: '@ahpd/agent-acp',
      options: { presets: { Bad_Id: { command: 'x' }, gemini: {} } },
    },
    { name: '@ahpd/agent-cofold', options: { provider: 'gemini', displayName: 'Gemini' } },
  ]);

  const moved = await migrate(filed());

  expect(moved.written).toEqual(['gemini']);
  expect([...(await held()).keys()]).toEqual(['gemini']);
  expect(said[0]).toMatch(/^The acp preset Bad_Id did not become a record: its id is not a slug: lowercase letters/u);
  expect(said[1]).toBe('The cofold preset gemini did not become a record: acp already names an agent of that id.');
  // The ids are named and no value is.
  expect(said.join('\n')).not.toContain('command');
});

it('keeps the presets of a plugin this run does not load', async () => {
  written([
    { name: '@ahpd/agent-claude', enabled: false, options: { presets: { claude: false, mine: { name: 'Mine' } } } },
    { name: '@ahpd/agent-acp', options: { presets: { gemini: {} } } },
  ]);
  const before = file();

  await migrate(filed());

  // The switched-off entry is the only copy of its agents, so it is as it was.
  expect(entryOf('@ahpd/agent-claude')).toEqual((before['plugins'] as Record<string, unknown>[])[0]);
  expect(entryOf('@ahpd/agent-acp')).toEqual({ name: '@ahpd/agent-acp' });
  expect([...(await held()).keys()]).toEqual(['gemini']);
});

it('writes the record a fresh install has no file for', async () => {
  // No configuration file at all: the daemon was started with the plugin named
  // on its command line, and the built-in claude is a record like any other.
  const moved = await migrate(['@ahpd/agent-claude']);

  expect(moved.written).toEqual(['claude']);
  expect(await held()).toMatchObject(new Map([['claude', {
    id: 'claude', engine: 'claude', owner: 'host', name: 'Claude', config: {},
  }]]));
  expect(existsSync(configFile)).toBe(false);
  expect(said).toEqual(['Moved 1 preset to agent records owned by the host: claude.']);
});

it('says a file it cannot read and leaves it as it was, quoting none of it', async () => {
  // A parser quotes the text it choked on, so the file's own words - a key
  // among them - are not repeated in the line.
  const broken = '{"plugins": [], "token": sk-live-9f2c}';
  writeFileSync(configFile, broken);

  const moved = await migrate([{ name: '@ahpd/agent-acp', options: { presets: { gemini: {} } } }]);

  // The record is written, and the file is the one that was there.
  expect(moved.written).toEqual(['gemini']);
  expect(readFileSync(configFile, 'utf8')).toBe(broken);
  expect(backups()).toEqual([]);
  expect(said).toEqual([`The presets were not taken out of ${configFile}: it could not be read, and is as it was.`]);
  expect(said.join('\n')).not.toContain('sk-live-9f2c');
});

it('does nothing when the file has no preset and its records are there', async () => {
  written(['@ahpd/agent-claude', '@ahpd/agent-acp']);
  await migrate(['@ahpd/agent-claude', '@ahpd/agent-acp']);
  const once = readFileSync(configFile, 'utf8');
  said.length = 0;

  const again = await migrate(['@ahpd/agent-claude', '@ahpd/agent-acp']);
  expect(again.written).toEqual([]);
  expect(readFileSync(configFile, 'utf8')).toBe(once);
  expect(said).toEqual([]);
  expect(backups()).toEqual([]);
});

it('moves a plaintext key into the vault, and keeps no value in the record, a listing or a line', async () => {
  written([{ name: '@ahpd/agent-acp', options: { presets: { codex: { env: { CODEX_API_KEY: KEY } } } } }]);

  const moved = await migrate(filed());

  expect(moved.written).toEqual(['codex']);
  // The record holds the name the channel's own put gives a host record's
  // secret, and the vault holds the value.
  expect((await held()).get('codex')).toMatchObject({
    config: { env: { CODEX_API_KEY: { $secret: 'host:agent/codex/env.CODEX_API_KEY' } } },
  });
  expect(secrets.get('host:agent/codex/env.CODEX_API_KEY')).toBe(KEY);
  // Nowhere a client, a reader of the records or a log reader looks carries it.
  expect(JSON.stringify(await records.list())).not.toContain('sk-a-key');
  expect(readFileSync(configFile, 'utf8')).not.toContain('sk-a-key');
  expect(said.join('\n')).not.toContain('sk-a-key');
});

it('gives a file with no presets its built-in claude once, and leaves a removed one removed', async () => {
  written([{ name: '@ahpd/agent-claude' }]);

  const first = await migrate(filed());
  expect(first.written).toEqual(['claude']);
  expect(existsSync(join(dir, 'presets-state.json'))).toBe(true);

  // A person removes the record. The file still names the plugin and holds no
  // presets, so nothing asks for it again.
  await records.remove('claude');
  said.length = 0;

  const again = await migrate(filed());
  expect(again.written).toEqual([]);
  expect(await held()).toEqual(new Map());
  expect(said).toEqual([]);
});

it('keeps a removed claude removed when the records and the file are in different folders', async () => {
  written([{ name: '@ahpd/agent-claude' }]);
  // What a `--config-file` in another folder does: the file is here, and the
  // records and the marker that they were made once are there.
  const elsewhere = mkdtempSync(join(tmpdir(), 'ahpd-agents-'));
  try {
    const first = await migrate(filed(), records, vault(), elsewhere);
    expect(first.written).toEqual(['claude']);
    expect(existsSync(join(elsewhere, 'presets-state.json'))).toBe(true);
    expect(existsSync(join(dir, 'presets-state.json'))).toBe(false);

    await records.remove('claude');
    said.length = 0;

    const again = await migrate(filed(), records, vault(), elsewhere);
    expect(again.written).toEqual([]);
    expect(await held()).toEqual(new Map());
    expect(said).toEqual([]);
  }
  finally {
    rmSync(elsewhere, { recursive: true, force: true });
  }
});

it('keeps a preset that did not become a record in the file', async () => {
  written([
    { name: '@ahpd/agent-acp', options: { presets: { Bad_Id: { command: 'x' }, gemini: {} } } },
    { name: '@ahpd/agent-cofold', options: { provider: 'gemini', displayName: 'Gemini' } },
  ]);

  const moved = await migrate(filed());

  expect(moved.written).toEqual(['gemini']);
  // The one that became a record is gone; the one whose id is not a slug is the
  // only copy of its agent and stays, in the object it was written in.
  expect(entryOf('@ahpd/agent-acp')).toEqual({
    name: '@ahpd/agent-acp',
    options: { presets: { Bad_Id: { command: 'x' } } },
  });
  // And the cofold entry, whose agent lost the id to the acp one, keeps the
  // provider that described it.
  expect(entryOf('@ahpd/agent-cofold')).toEqual({
    name: '@ahpd/agent-cofold',
    options: { provider: 'gemini', displayName: 'Gemini' },
  });
});

it('leaves the file as it is when the run loads a spec the file does not hold', async () => {
  written([{ name: '@ahpd/agent-claude', options: { presets: { mine: { name: 'Mine' } } } }]);
  const before = readFileSync(configFile, 'utf8');

  // A `--plugin` naming the package by a path: the file's entry is not the spec
  // this run loads, so its presets are neither made records nor touched. The
  // built-in claude is still the one agent an install has.
  const moved = await migrate(['./tools/agent-claude']);

  expect(moved.written).toEqual(['claude']);
  expect([...(await held()).keys()]).toEqual(['claude']);
  expect(readFileSync(configFile, 'utf8')).toBe(before);
  expect(backups()).toEqual([]);
});

describe('a Claude record written before models held one shape', () => {
  /** A record store in a temp folder, and its `agents` collection, the daemon's own. */
  const stored = async (): Promise<RecordCollection> => (await fileRecords(join(dir, 'records')).collection('agents', { format: 'json' }));

  /** The record's file, as the store wrote it. */
  const recordFile = (id: string): string => join(dir, 'records', 'agents', `${id}.json`);

  it('is split once into models and modelSources, keeping every other value and naming no key', async () => {
    const agents = await stored();
    const KEY = 'sk-a-model-source-key-nobody may read';
    await agents.put({
      id: 'deepseek',
      engine: 'claude',
      owner: 'host',
      name: 'DeepSeek',
      description: 'A second endpoint.',
      model: 'deepseek-chat',
      config: {
        thinking: 'disabled',
        models: [
          'deepseek-flash',
          { id: 'deepseek-chat', name: 'DeepSeek Chat' },
          { fetch: 'https://models.test/v1/models', match: 'deepseek/*', key: { fromEnv: 'DEEPSEEK_MODELS_KEY' } },
          { fetch: 'https://other.test/v1/models', key: KEY },
        ],
        env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.test/anthropic' },
      },
    });
    const before = JSON.parse(readFileSync(recordFile('deepseek'), 'utf8')) as StoredRecord;
    const say = (line: string): void => { said.push(line); };

    const written = await splitModels({ records: agents, log: say });

    expect(written).toEqual(['deepseek']);
    const after = JSON.parse(readFileSync(recordFile('deepseek'), 'utf8')) as StoredRecord;
    // Nothing but `models` changed, and the fetch entries moved beside it.
    expect(after).toEqual({
      ...before,
      config: {
        thinking: 'disabled',
        env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.test/anthropic' },
        models: [{ id: 'deepseek-flash' }, { id: 'deepseek-chat', name: 'DeepSeek Chat' }],
        modelSources: [
          { fetch: 'https://models.test/v1/models', match: 'deepseek/*', key: { fromEnv: 'DEEPSEEK_MODELS_KEY' } },
          { fetch: 'https://other.test/v1/models', key: KEY },
        ],
      },
    });
    // One line, naming the id and no value of the record.
    expect(said).toEqual(['Split one agent into models and modelSources: deepseek.']);
    expect(said.join('\n')).not.toContain(KEY);
    expect(said.join('\n')).not.toContain('DEEPSEEK_MODELS_KEY');
    expect(said.join('\n')).not.toContain('api.deepseek.test');
  });

  it('is not written a second time, and a record already in the two-list shape is left as it is', async () => {
    const agents = await stored();
    await agents.put({
      id: 'deepseek', engine: 'claude', owner: 'host', name: 'DeepSeek',
      config: { models: ['deepseek-flash'], modelSources: [{ fetch: 'https://models.test/v1/models' }] },
    });
    await agents.put({
      id: 'steadiest', engine: 'claude', owner: 'host', name: 'Steadiest',
      config: { models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }], keepCliModels: true },
    });
    const say = (line: string): void => { said.push(line); };

    await splitModels({ records: agents, log: say });
    const once = readFileSync(recordFile('deepseek'), 'utf8');
    const steady = readFileSync(recordFile('steadiest'), 'utf8');
    said.length = 0;

    // The second start finds both in the two-list shape and writes neither.
    expect(await splitModels({ records: agents, log: say })).toEqual([]);
    expect(readFileSync(recordFile('deepseek'), 'utf8')).toBe(once);
    expect(readFileSync(recordFile('steadiest'), 'utf8')).toBe(steady);
    expect(said).toEqual([]);
  });

  it('leaves a record whole when an entry is neither a model nor a fetch', async () => {
    const agents = await stored();
    await agents.put({
      id: 'odd', engine: 'claude', owner: 'host', name: 'Odd',
      config: { models: ['deepseek-flash', { nickname: 'x' }] },
    });
    const before = readFileSync(recordFile('odd'), 'utf8');
    const say = (line: string): void => { said.push(line); };

    expect(await splitModels({ records: agents, log: say })).toEqual([]);
    // Nothing a person wrote is dropped, and the record is the one it was.
    expect(readFileSync(recordFile('odd'), 'utf8')).toBe(before);
    expect(said).toEqual(['The models of odd were not split: models entry 1 is neither a model id, a model nor a fetch.']);
  });

  it('leaves a record whole when its modelSources is not a list', async () => {
    const agents = await stored();
    await agents.put({
      id: 'odd', engine: 'claude', owner: 'host', name: 'Odd',
      config: { models: [{ fetch: 'https://models.test/v1/models' }], modelSources: { fetch: 'https://kept.test' } },
    });
    const before = readFileSync(recordFile('odd'), 'utf8');
    const say = (line: string): void => { said.push(line); };

    expect(await splitModels({ records: agents, log: say })).toEqual([]);
    expect(readFileSync(recordFile('odd'), 'utf8')).toBe(before);
    expect(said).toEqual(['The models of odd were not split: modelSources is not a list.']);
  });

  it('moves a model source key written in plain text to the vault, in the owner\'s scope', async () => {
    const agents = await stored();
    const held = new Map<string, string>();
    const vault: Vault = {
      get: async (name) => held.get(name),
      set: async (name, value) => { held.set(name, value); },
      delete: async (name) => held.delete(name),
      list: async () => [...held.keys()],
    };
    await agents.put({
      id: 'mine', engine: 'claude', owner: 'user:ana', name: 'Mine',
      config: { models: [{ fetch: 'https://other.test/v1/models', key: KEY }, { fetch: 'https://env.test', key: { fromEnv: 'X' } }] },
    });
    await agents.put({
      id: 'split', engine: 'claude', owner: 'host', name: 'Split',
      config: { modelSources: [{ fetch: 'https://other.test/v1/models', key: KEY }] },
    });
    const say = (line: string): void => { said.push(line); };

    expect((await splitModels({ records: agents, vault, log: say })).sort()).toEqual(['mine', 'split']);
    expect(readFileSync(recordFile('mine'), 'utf8')).not.toContain(KEY);
    expect(readFileSync(recordFile('split'), 'utf8')).not.toContain(KEY);
    expect((JSON.parse(readFileSync(recordFile('mine'), 'utf8')) as StoredRecord).config).toEqual({
      models: [],
      modelSources: [
        { fetch: 'https://other.test/v1/models', key: { $secret: 'user:ana/agent/mine/modelSources.0.key' } },
        { fetch: 'https://env.test', key: { fromEnv: 'X' } },
      ],
    });
    expect(held.get('user:ana/agent/mine/modelSources.0.key')).toBe(KEY);
    expect(held.get('host:agent/split/modelSources.0.key')).toBe(KEY);
    expect(said.join('\n')).not.toContain(KEY);
    said.length = 0;
    // A second start finds no plain key and writes nothing.
    expect(await splitModels({ records: agents, vault, log: say })).toEqual([]);
  });

  it('leaves a record of another engine as it is', async () => {
    const agents = await stored();
    await agents.put({
      id: 'codex', engine: 'acp', owner: 'host', name: 'Codex',
      config: { models: ['deepseek-flash'] },
    });
    const before = readFileSync(recordFile('codex'), 'utf8');

    expect(await splitModels({ records: agents, log: () => {} })).toEqual([]);
    expect(readFileSync(recordFile('codex'), 'utf8')).toBe(before);
  });
});

it('plans from the file, so a value a flag set for this run is not made permanent', async () => {
  written([{ name: '@ahpd/agent-claude', options: { presets: { mine: { name: 'Mine' } } } }]);

  // What `--plugin-option agent-claude.presets.mine.model=run-only` builds: the
  // file's entry with a value set for this run, and a preset only this run has.
  const injected: PluginSpec[] = [{
    name: '@ahpd/agent-claude',
    options: { presets: { mine: { name: 'Mine', model: 'run-only' }, run: { name: 'Run only' } } },
  }];

  const moved = await migrate(injected);

  // The records are the file's own presets, with the file's values.
  expect(moved.written).toEqual(['claude', 'mine']);
  expect([...(await held())].map(([id]) => id).sort()).toEqual(['claude', 'mine']);
  expect((await held()).get('mine')).toMatchObject({ name: 'Mine', config: {} });
  // The loader is handed this run's spec without the presets a record holds,
  // and the file lost only the presets that became records.
  expect(moved.plugins).toEqual([{ name: '@ahpd/agent-claude' }]);
  expect(entryOf('@ahpd/agent-claude')).toEqual({ name: '@ahpd/agent-claude' });
  expect(backups()).toHaveLength(1);
});
