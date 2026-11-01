/*
 * The plugins channel: what a client lists, and what a client changes.
 *
 * The plugins are the real fixtures loaded by the real loader, so a row's
 * manifest and its masked options are the ones a daemon would serve. The host
 * is in this process, over a real users file, and every change is read back
 * from the file on disk: the point of the channel is that it writes what
 * `ahpd plugin` writes.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost, fileResources, fileUsers, servedRecords, type PluginHost, type PluginSpec, type PluginView, type Users } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.js';
import { applyPlugins } from '../src/applyplugins.js';
import { SET } from '../src/commands/config.js';
import type { Options } from '../src/commands/options.js';
import { apiOrigins } from '../src/commands/run.js';
import { servedRegistry, type ServedFacts } from '../src/commands/served.js';
import { apiHandler } from '../src/http.js';
import type { Runner } from '../src/install.js';
import { registry, type Fetch } from '../src/update.js';
import { loadPlugins, pluginSet, type PluginSet } from '../src/plugins.js';
import { pluginsChannel } from '../src/pluginschannel.js';

const URI = 'x-ahpd-plugins://';
const ROOT = 'ahp-root://';
const here = import.meta.dirname;
const fixtures = join(here, 'fixtures');

/** The package whose manifest is its package.json. */
const DECLARED = './fixtures/plugin-declared';
/** The file plugin whose `apiKey` is write-only. */
const SECRET = './fixtures/plugin-secret/index.ts';
/** The plugin whose `apply` throws, quoting its write-only option. */
const THROWS = './fixtures/plugin-throws-secret/index.ts';
/** The plugin whose module leaves a file behind when it is imported. */
const MARKER_OFF = './fixtures/plugin-marker-off';

type Bag = Record<string, any>;

let home: string;
let config: string;
let usersFile: string;
let had: string | undefined;
let hadRoot: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-plugins-channel-'));
  // The daemon's own config directory, so `running()` and `configDir()` read
  // this test's home and nothing of whoever runs the suite.
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  // The plugin root too, so an install in a case writes into this test's home
  // and not into the repository's fixtures.
  hadRoot = process.env.AHPD_PLUGIN_ROOT;
  process.env.AHPD_PLUGIN_ROOT = join(home, 'ahpd');
  mkdirSync(join(home, 'ahpd'), { recursive: true });
  config = join(home, 'ahpd', 'config.json');
  writeFileSync(config, JSON.stringify({
    plugins: [DECLARED, { name: SECRET, options: { apiKey: 'sk-live-1', region: 'eu' } }],
  }));
  usersFile = join(home, 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    roles: {
      reader: ['plugin:read'],
      writer: ['plugin:read', 'plugin:write'],
      enabler: ['plugin:enable'],
      installer: ['plugin:read', 'plugin:install'],
      'config-reader': ['config:read'],
      'config-writer': ['config:write'],
    },
    users: [
      { id: 'ana', roles: ['reader'] },
      { id: 'bo', roles: [] },
      { id: 'cy', roles: ['writer'] },
      { id: 'fa', roles: ['config-reader'] },
      { id: 'gi', roles: ['config-writer'] },
      { id: 'ha', roles: ['enabler'] },
      { id: 'jo', roles: ['installer'] },
      { id: 'ka', roles: ['member'] },
      { id: 'lu', roles: ['installer'] },
    ],
  }));
});
afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
  if (hadRoot === undefined) delete process.env.AHPD_PLUGIN_ROOT; else process.env.AHPD_PLUGIN_ROOT = hadRoot;
  rmSync(home, { recursive: true, force: true });
});

const wait = async (ms: number): Promise<void> => { await new Promise((done) => { setTimeout(done, ms); }); };

/** The configuration file as it stands. */
const held = (): { plugins: unknown[] } => JSON.parse(readFileSync(config, 'utf8')) as { plugins: unknown[] };

/**
 * A runner that installs without npm, as `plugin-install.test.ts` does.
 *
 * An install writes each package named in `lands` into `node_modules` under the
 * call's own `--prefix`, with the `ahpd` field a plugin's manifest has, and
 * names each in that root's `package.json` with the spec given, as npm does. An
 * uninstall takes the package out again. Every call is kept, so a case can say
 * what npm was asked.
 *
 * `names` is the name each module exports, when it is not the package's own;
 * `esm` lands an `index.mjs` instead of an `index.ts`, which is a plugin Node
 * can import from `node_modules` (it refuses to strip types there); `fail`
 * names why a call fails, or answers nothing for one that succeeds.
 */
const fakeNpm = (
  lands: Record<string, string>,
  options: {
    manifests?: Record<string, Record<string, unknown>>;
    names?: Record<string, string>;
    esm?: boolean;
    fail?: (argv: readonly string[]) => string | undefined;
  } = {},
) => {
  const calls: { program: string; argv: string[] }[] = [];
  const runner: Runner = async (program, argv) => {
    calls.push({ program, argv: [...argv] });
    const at = argv.indexOf('--prefix');
    if (at === -1) return { code: 0, stdout: '', stderr: '' };
    const failed = options.fail?.(argv);
    if (failed !== undefined) return { code: 1, stdout: '', stderr: failed };
    const into = argv[at + 1] as string;
    const names = Object.keys(lands);
    const file = join(into, 'package.json');
    const before = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> : {};
    const dependencies = typeof before.dependencies === 'object' && before.dependencies !== null
      ? before.dependencies as Record<string, string>
      : {};
    if (argv[0] === 'install') {
      for (const name of names) {
        const folder = join(into, 'node_modules', name);
        mkdirSync(folder, { recursive: true });
        const entry = options.esm === true ? './index.mjs' : './index.ts';
        writeFileSync(join(folder, 'package.json'), JSON.stringify({
          name,
          version: '1.0.0',
          type: 'module',
          exports: { '.': entry },
          ahpd: { entry, title: name, description: `The ${name} plugin.`, contracts: {} },
          ...options.manifests?.[name],
        }));
        const text = `export const name = '${options.names?.[name] ?? name}';\nexport function apply() {}\n`;
        writeFileSync(join(folder, options.esm === true ? 'index.mjs' : 'index.ts'), text);
      }
      writeFileSync(file, `${JSON.stringify({ ...before, dependencies: { ...dependencies, ...lands } }, null, 2)}\n`);
    }
    if (argv[0] === 'uninstall') {
      for (const name of names) rmSync(join(into, 'node_modules', name), { recursive: true, force: true });
      writeFileSync(file, `${JSON.stringify({
        ...before,
        dependencies: Object.fromEntries(Object.entries(dependencies).filter(([name]) => !names.includes(name))),
      }, null, 2)}\n`);
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { runner, calls };
};

/**
 * A plugin written in a client: one TypeScript file that appends `word` to
 * `marker` when the daemon applies it.
 *
 * The text is written twice by a case that replaces it, and the marker is what
 * says which text ran.
 */
const writing = (word: string, marker: string): string => [
  "import { appendFileSync } from 'node:fs';",
  "import type { Plugin } from '@ahpd/sdk';",
  `const mark = ${JSON.stringify(marker)};`,
  "export const name = 'demo';",
  `export const apply: Plugin['apply'] = (): void => { appendFileSync(mark, '${word}\\n'); };`,
  '',
].join('\n');

/** A host serving the plugins channel, over plugins loaded from the file. */
const served = async ({ load = true, run }: { load?: boolean; run?: Runner } = {}) => {
  let loaded: Awaited<ReturnType<typeof loadPlugins>>['loaded'] = [];
  let alerts: Awaited<ReturnType<typeof loadPlugins>>['alerts'] = {};
  if (load) {
    const specs = held().plugins as Parameters<typeof loadPlugins>[0];
    ({ loaded, alerts } = await loadPlugins(specs, {
      base: { path: home, agents: [echo({ path: home })] },
      configDir: fixtures,
      cwd: here,
      log: () => {},
    }));
  }
  let markRestart: () => void = () => {};
  const lists = pluginsChannel({
    configFile: config,
    where: { configDir: fixtures, cwd: here },
    loaded: () => loaded,
    alerts: () => alerts,
    // Nothing loaded here holds a view: a case that shows one uses `live`.
    views: () => ({}),
    restartNeeded: () => markRestart(),
    ...(run === undefined ? {} : { run }),
  });
  const wire = servedRecords('ahpd', [lists.channel], lists.methods);
  const users = fileUsers({ path: usersFile });
  const host = createHost({
    path: home,
    agents: [{ ...echo({ path: home, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    channels: wire.channels,
    methods: wire.methods,
    users,
  });
  markRestart = () => { host.markRestartNeeded(); };
  return { host, users, close: async () => { await host.close(); } };
};

type Host = Awaited<ReturnType<typeof served>>['host'];

/**
 * A host that applies a change as the daemon does.
 *
 * The plugins in the file are loaded into a set, and each command's apply
 * loads, unloads or imports a plugin again through `applyPlugins`, against the
 * same host the channel serves. A command that writes is therefore answered
 * with what actually happened, and a second write of one plugin runs its new
 * text, as `ahpd plugin reload` does at the terminal.
 */
const live = async ({ run, fetch, version }: { run?: Runner; fetch?: Fetch; version?: string } = {}) => {
  let set: PluginSet;
  let host: Host;
  let markRestart: () => void = () => {};
  let refresh: () => Promise<void> = async () => {};
  const lists = pluginsChannel({
    configFile: config,
    where: { configDir: fixtures, cwd: here },
    loaded: () => set.loaded(),
    alerts: () => set.alerts(),
    views: () => set.views(),
    apply: async (reload?: string[]) => {
      const answer = await applyPlugins({
        set,
        configFile: config,
        host: () => host,
        log: () => {},
        ...(reload === undefined ? {} : { reload }),
      });
      await refresh();
      return answer;
    },
    restartNeeded: () => markRestart(),
    ...(run === undefined ? {} : { run }),
    ...(fetch === undefined ? {} : { fetch }),
    ...(version === undefined ? {} : { version: () => version }),
  });
  refresh = lists.refresh;
  const wire = servedRecords('ahpd', [lists.channel], lists.methods);
  const users = fileUsers({ path: usersFile });
  /*
   * The channels, the methods and the people are the base the set is folded
   * over, not fields added beside it: an apply rewrites this object with the
   * fold's fields, and a key the fold does not hold is removed from it.
   */
  const base = {
    path: home,
    agents: [{ ...echo({ path: home, pace: 0 }), provider: 'base', displayName: 'Base' }],
    resources: fileResources(),
    channels: wire.channels,
    methods: wire.methods,
    users,
  };
  const where = { configDir: fixtures, cwd: here, log: () => {}, alertsChanged: () => { void refresh(); }, viewsChanged: () => { void refresh(); } };
  set = pluginSet({ base, ...where });
  const first = await loadPlugins(held().plugins as PluginSpec[], { base, ...where, set });
  host = createHost(first.options);
  markRestart = () => { host.markRestartNeeded(); };
  return { host, users, close: async () => { await host.close(); } };
};

/** A client signed in as `id`, in `locale` when one is given, whose channel actions are kept. */
const as = async (host: Host, users: Users, id: string, locale?: string) => {
  const token = await users.mint(id);
  const seen: { method: string; params: Bag }[] = [];
  const client = host.accept({
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method, params) => { seen.push({ method, params: params as Bag }); },
  });
  const hello = await client.handle({
    method: 'initialize',
    params: { clientId: id, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT], ...(locale === undefined ? {} : { locale }) },
  }) as { _meta?: Bag };
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: users.resource.resource, token } });
  const call = async (method: string, params: Bag) => client.handle({ method, params }).then(
    (result) => ({ result: result as Bag }),
    (error: { code: number; message: string }) => error as Bag,
  );
  /** Each action on `channel`, whole. */
  const actions = (channel: string) => seen
    .filter((one) => one.method === 'action' && one.params.channel === channel)
    .map((one) => one.params.action as Bag);
  /** Each action on `channel`, as `type id`. */
  const heard = (channel: string) => seen
    .filter((one) => one.method === 'action' && one.params.channel === channel)
    .map((one) => `${String(one.params.action.type).split('/').pop()} ${String(one.params.action.id)}`);
  /** Every row a subscribe answered, by id. */
  const rows = async (): Promise<Record<string, Bag>> => {
    const answer = await call('subscribe', { channel: URI });
    const records = answer.result.snapshot.state.records as { id: string; record: Bag }[];
    return Object.fromEntries(records.map((one) => [one.id, one.record]));
  };
  /** The root state this client reads now. */
  const root = async (): Promise<Bag> => {
    const answer = await call('subscribe', { channel: ROOT });
    return (answer.result as Bag)['snapshot'].state as Bag;
  };
  /** The parameters of each notification of `method` this client was sent. */
  const told = (method: string): Bag[] => seen.filter((one) => one.method === method).map((one) => one.params);
  return { call, actions, heard, rows, root, told, met: hello._meta ?? {}, close: () => { client.close(); } };
};

/** The authority the served handler is asked at; nothing listens on it. */
const AUTHORITY = '127.0.0.1:9350';

/** The HTTP API over this test's configuration file, signing people in from `users`. */
const servedHttp = (users: Users) => {
  const facts: ServedFacts = {
    options: {} as Options,
    configFile: config,
    users,
    running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9350, paths: [], startedAt: '' }),
    turning: () => [],
    restart: () => {},
  };
  const handler = apiHandler({
    registry: servedRegistry(facts),
    token: 'root-secret',
    users,
    program: { name: 'ahpd', version: '0.0.0' },
    origins: () => apiOrigins('127.0.0.1', undefined, 9350),
  });
  /** One POST, answered as the response it drew. */
  return (path: string, token: string | undefined, body: unknown): Promise<Response> => handler(new Request(
    `http://${AUTHORITY}/api${path}`,
    {
      method: 'POST',
      headers: {
        host: AUTHORITY,
        'content-type': 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    },
  ));
};

it('lists two configured plugins, one with the manifest its package.json declares', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');

  const rows = await ana.rows();
  expect(Object.keys(rows)).toEqual(['declared', 'secret']);

  const declared = rows['declared'] as Bag;
  expect(declared['state']).toBe('ready');
  expect(declared['version']).toBe('1.0.0');
  expect(declared['loaded']).toBe(true);
  expect(declared['alerts']).toEqual([]);
  expect(declared['manifest']).toEqual({
    description: 'Declares its manifest in its package.json.',
    categories: ['tool'],
    links: [{ title: 'Docs', url: 'https://ahpd.dev/plugins' }],
    contracts: { agents: ['declared'] },
  });
  expect(declared['undeclared']).toBeUndefined();

  // The file plugin's manifest is its options schema and nothing a client
  // draws beside the name, so it is listed and said to be undeclared rather
  // than left out.
  const secret = rows['secret'] as Bag;
  expect(secret['state']).toBe('ready');
  expect(secret['loaded']).toBe(true);
  expect(secret['optionsSchema']).toEqual({
    type: 'object',
    properties: {
      apiKey: { type: 'string', writeOnly: true },
      region: { type: 'string' },
      retries: { type: 'integer', minimum: 0 },
    },
  });
  expect(secret['manifest']).toEqual({ optionsSchema: secret['optionsSchema'] });
  expect(secret['undeclared']).toBe(true);
  await close();
});

it('turns a plugin off in the configuration file, and the row says so', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');
  const cy = await as(host, users, 'cy');
  await ana.rows();

  expect(await cy.call('x-ahpd/plugins/disable', { id: 'declared' })).toEqual({
    result: { id: 'declared', enabled: false, restart: true },
  });
  // The entry the command line writes: an object naming the spec, turned off.
  expect(held().plugins).toEqual([{ source: DECLARED, enabled: false }, { name: SECRET, options: { apiKey: 'sk-live-1', region: 'eu' } }]);

  await wait(50);
  expect(ana.heard(URI)).toEqual(['changed declared']);
  const rows = await ana.rows();
  // Switched off, the row still says what the plugin is: a client can draw it
  // while it is off, from the package.json the daemon read and did not run.
  const declared = rows['declared'] as Bag;
  expect(declared['state']).toBe('disabled');
  expect(declared['title']).toBe('Declared');
  expect(declared['version']).toBe('1.0.0');
  expect(declared['manifest']).toEqual({
    description: 'Declares its manifest in its package.json.',
    categories: ['tool'],
    links: [{ title: 'Docs', url: 'https://ahpd.dev/plugins' }],
    contracts: { agents: ['declared'] },
  });
  expect(declared['problem']).toBeUndefined();
  await close();
});

it('lists a plugin with a pt catalog in each reader\'s locale, and sends each reader one diff', async () => {
  writeFileSync(config, JSON.stringify({ plugins: ['./fixtures/plugin-spoken'] }));
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana', 'pt-BR');
  const cy = await as(host, users, 'cy');

  const pt = (await ana.rows())['spoken'] as Bag;
  expect(pt['title']).toBe('Falado');
  expect(pt['manifest']['description']).toBe('Traz um catálogo em português.');
  // The catalog's own string where it has one, and English where it has none.
  const tone = { type: 'string', title: 'Tom', description: 'How the plugin speaks.', enum: ['plain', 'warm'], enumLabels: ['Plain', 'Caloroso'] };
  expect(pt['optionsSchema']['properties']['tone']).toEqual(tone);
  expect(pt['manifest']['optionsSchema']['properties']['tone']).toEqual(tone);
  // What is data and not text stays as it is.
  expect(pt['name']).toBe('spoken');
  expect(pt['state']).toBe('ready');

  const en = (await cy.rows())['spoken'] as Bag;
  expect(en['title']).toBe('Spoken');
  expect(en['manifest']['description']).toBe('Ships a catalog in Portuguese.');
  expect(en['optionsSchema']['properties']['tone']['title']).toBe('Tone');
  expect(en['optionsSchema']['properties']['tone']['enumLabels']).toEqual(['Plain', 'Warm']);

  expect(await cy.call('x-ahpd/plugins/disable', { id: 'spoken' })).toEqual({
    result: { id: 'spoken', enabled: false, restart: true },
  });
  await wait(50);
  // One diff each, though the two readers' copies of the row differ.
  expect(ana.heard(URI)).toEqual(['changed spoken']);
  expect(cy.heard(URI)).toEqual(['changed spoken']);
  expect(ana.actions(URI)[0]?.['record']?.['title']).toBe('Falado');
  expect(ana.actions(URI)[0]?.['record']?.['state']).toBe('disabled');
  expect(cy.actions(URI)[0]?.['record']?.['title']).toBe('Spoken');
  await close();
});

it('describes a switched-off standalone plugin from the plugin.json it names', async () => {
  writeFileSync(config, JSON.stringify({
    plugins: [{ source: './fixtures/plugin-standalone/plugin.json', enabled: false }],
  }));
  const { host, users, close } = await served({ load: false });
  const ana = await as(host, users, 'ana');

  const row = (await ana.rows())['standalone'] as Bag;
  expect(row['state']).toBe('disabled');
  expect(row['loaded']).toBe(false);
  expect(row['module']).toBe('standalone');
  expect(row['title']).toBe('Standalone');
  expect(row['version']).toBe('1.2.3');
  expect(row['manifest']).toEqual({
    id: 'standalone',
    name: 'Standalone',
    version: '1.2.3',
    description: 'Describes itself from a plugin.json.',
    categories: ['tool'],
    links: [{ title: 'Docs', url: 'https://ahpd.dev/plugins' }],
    contracts: { tools: ['standalone_tool'] },
  });
  await close();
});

it('reports a configured file with no manifest as the error a load gives, with no import', async () => {
  delete (globalThis as Record<string, unknown>).__bareChannelImported;
  const folder = join(home, 'bare-plugin');
  mkdirSync(folder);
  const file = join(folder, 'bare.mjs');
  writeFileSync(file, "globalThis.__bareChannelImported = true;\nexport function apply() {}\n");
  writeFileSync(config, JSON.stringify({ plugins: [file] }));

  const { host, users, close } = await served({ load: false });
  const ana = await as(host, users, 'ana');

  const rows = await ana.rows();
  const [row] = Object.values(rows) as Bag[];
  expect(row?.['state']).toBe('error');
  expect(row?.['loaded']).toBe(false);
  expect(String(row?.['problem'])).toContain('plugin.json');
  expect(String(row?.['problem'])).toContain('entry');
  // The same answer a load gives, read with no import: the module was not run.
  expect((globalThis as Record<string, unknown>).__bareChannelImported).toBeUndefined();
  await close();
});

it('describes a switched-off plugin whose module throws on import, and says nothing is wrong', async () => {
  const folder = join(home, 'broken-plugin');
  mkdirSync(folder);
  writeFileSync(join(folder, 'package.json'), JSON.stringify({
    name: 'broken-plugin',
    version: '2.0.0',
    type: 'module',
    ahpd: {
      entry: './index.mjs',
      title: 'Broken',
      description: 'Throws when it is imported.',
      contracts: { tools: ['broken_tool'] },
    },
  }));
  writeFileSync(join(folder, 'index.mjs'), "throw new Error('the broken fixture throws when imported');\n");
  writeFileSync(config, JSON.stringify({ plugins: [{ source: folder, enabled: false }] }));

  const { host, users, close } = await served({ load: false });
  const ana = await as(host, users, 'ana');

  const row = (await ana.rows())['broken-plugin'] as Bag;
  expect(row['state']).toBe('disabled');
  expect(row['loaded']).toBe(false);
  expect(row['problem']).toBeUndefined();
  // The module was never imported, so there is no load problem to report.
  expect(row['alerts']).toEqual([]);
  expect(row['manifest']).toEqual({
    description: 'Throws when it is imported.',
    contracts: { tools: ['broken_tool'] },
  });
  await close();
});

it('lists an enabled plugin that failed to load with its manifest and its problem', async () => {
  const folder = join(home, 'broken-plugin');
  mkdirSync(folder);
  writeFileSync(join(folder, 'package.json'), JSON.stringify({
    name: 'broken-plugin',
    version: '2.0.0',
    type: 'module',
    ahpd: {
      entry: './index.mjs',
      title: 'Broken',
      description: 'Throws when it is imported.',
      contracts: { tools: ['broken_tool'] },
    },
  }));
  writeFileSync(join(folder, 'index.mjs'), "throw new Error('the broken fixture throws when imported');\n");
  writeFileSync(config, JSON.stringify({ plugins: [folder] }));

  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');

  const row = (await ana.rows())['broken-plugin'] as Bag;
  expect(row['state']).toBe('ready');
  expect(row['loaded']).toBe(false);
  // One alert, and it is the line that says the plugin did not load.
  const alerts = row['alerts'] as Bag[];
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.['level']).toBe('error');
  expect(String(alerts[0]?.['text'])).toContain('the broken fixture throws when imported');
  expect(row['title']).toBe('Broken');
  expect(row['manifest']).toEqual({
    description: 'Throws when it is imported.',
    contracts: { tools: ['broken_tool'] },
  });
  await close();
});

it('lists a write-only option as set, and any other option as the file holds it', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');

  const rows = await ana.rows();
  const secret = rows['secret'] as Bag;
  expect(secret['spec']).toEqual({ source: SECRET, options: { apiKey: SET, region: 'eu' } });
  await close();
});

it('refuses a caller with no grant, to read and to change', async () => {
  const { host, users, close } = await served();
  const bo = await as(host, users, 'bo');

  expect(await bo.call('subscribe', { channel: URI })).toMatchObject({ code: -32009 });
  expect(await bo.call('x-ahpd/plugins/disable', { id: 'declared' })).toMatchObject({ code: -32009 });
  expect(held().plugins).toEqual([DECLARED, { name: SECRET, options: { apiKey: 'sk-live-1', region: 'eu' } }]);
  await close();
});

it('reads with plugin:read, and refuses a role holding only config:read', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');
  expect(Object.keys(await ana.rows())).toEqual(['declared', 'secret']);

  // `config:read` used to read this channel, and no longer does.
  const fa = await as(host, users, 'fa');
  expect(await fa.call('subscribe', { channel: URI })).toMatchObject({ code: -32009 });
  await close();
});

it('enables with plugin:enable over the protocol and over HTTP, and refuses config:write alone', async () => {
  const { host, users, close } = await served();
  const ha = await as(host, users, 'ha');

  // `plugin:enable` lets one in, and is not `plugin:disable`.
  expect(await ha.call('x-ahpd/plugins/disable', { id: 'declared' })).toMatchObject({ code: -32009 });
  expect(await ha.call('x-ahpd/plugins/enable', { id: 'declared' })).toEqual({
    result: { id: 'declared', enabled: true, restart: true },
  });

  const gi = await as(host, users, 'gi');
  expect(await gi.call('x-ahpd/plugins/enable', { id: 'declared' })).toMatchObject({ code: -32009 });

  // The same command, the same grant, over HTTP.
  const ask = servedHttp(users);
  const refused = await ask('/plugin/enable', await users.mint('gi'), { name: DECLARED });
  expect(refused.status).toBe(403);
  expect((await refused.json() as { message: string }).message).toBe('gi may not plugin:enable here');

  const answered = await ask('/plugin/enable', await users.mint('ha'), { name: DECLARED });
  expect(answered.status).toBe(200);
  await close();
});

it('installs a source as a role holding plugin:install, and lists the new row', async () => {
  const { runner, calls } = fakeNpm({ demo: 'github:someone/demo' });
  const { host, users, close } = await served({ run: runner });
  const ana = await as(host, users, 'ana');
  const jo = await as(host, users, 'jo');
  await ana.rows();

  expect(await jo.call('x-ahpd/plugins/install', { source: 'github:someone/demo' })).toEqual({
    result: { id: 'demo', restart: true },
  });
  // npm ran in the plugin root, and `plugins` names the package npm wrote, not
  // the source the client gave.
  expect(calls[0]?.argv.slice(0, 3)).toEqual(['install', '--prefix', join(home, 'ahpd')]);
  expect(calls[0]?.argv.at(-1)).toBe('github:someone/demo');
  expect(held().plugins).toEqual([DECLARED, { name: SECRET, options: { apiKey: 'sk-live-1', region: 'eu' } }, 'demo']);

  await wait(50);
  expect(ana.heard(URI)).toEqual(['added demo']);
  const rows = await ana.rows();
  expect(Object.keys(rows)).toEqual(['declared', 'secret', 'demo']);
  // Listed from the package npm landed, which this daemon has not loaded.
  expect((rows['demo'] as Bag)['version']).toBe('1.0.0');
  expect((rows['demo'] as Bag)['loaded']).toBe(false);
  await close();
});

it('answers the id the new row is listed under, not the package npm installed', async () => {
  // A scoped package whose module names itself something else: the row is
  // listed under the module's name, so that is what the install answers, and a
  // later command names the row by it. `github:` is the source so nothing here
  // asks a registry; what npm lands is the scoped package.
  const { runner } = fakeNpm({ '@acme/foo': '1.0.0' }, { names: { '@acme/foo': 'foo' }, esm: true });
  const { host, users, close } = await live({ run: runner });
  const ana = await as(host, users, 'ana');
  const jo = await as(host, users, 'jo');
  await ana.rows();

  expect(await jo.call('x-ahpd/plugins/install', { source: 'github:acme/foo' })).toEqual({
    result: { id: 'foo', restart: false },
  });
  const rows = await ana.rows();
  expect(Object.keys(rows)).toContain('foo');
  expect(Object.keys(rows)).not.toContain('@acme/foo');
  expect(held().plugins).toContain('@acme/foo');
  await close();
});

it('refuses install and remove to a member, which holds neither grant', async () => {
  const { host, users, close } = await served();
  const ka = await as(host, users, 'ka');

  expect(await ka.call('x-ahpd/plugins/install', { source: 'github:someone/demo' })).toMatchObject({ code: -32009 });
  expect(await ka.call('x-ahpd/plugins/remove', { id: 'declared' })).toMatchObject({ code: -32009 });
  expect(held().plugins).toEqual([DECLARED, { name: SECRET, options: { apiKey: 'sk-live-1', region: 'eu' } }]);
  await close();
});

it('removes a plugin through the channel, and the row leaves the list', async () => {
  const { runner, calls } = fakeNpm({});
  const { host, users, close } = await served({ run: runner });
  const ana = await as(host, users, 'ana');
  const jo = await as(host, users, 'jo');
  await ana.rows();

  expect(await jo.call('x-ahpd/plugins/remove', { id: 'secret' })).toEqual({
    result: { id: 'secret', restart: true },
  });
  expect(held().plugins).toEqual([DECLARED]);
  expect(calls.at(-1)?.argv).toEqual(['uninstall', '--prefix', join(home, 'ahpd'), '--', 'secret']);

  await wait(50);
  expect(ana.heard(URI)).toEqual(['removed secret']);
  expect(Object.keys(await ana.rows())).toEqual(['declared']);
  await close();
});

it('writes a plugin in a client, and lists it as loaded', async () => {
  const marker = join(home, 'applied.log');
  const { runner, calls } = fakeNpm({});
  const { host, users, close } = await live({ run: runner });
  const ana = await as(host, users, 'ana');
  const jo = await as(host, users, 'jo');
  await ana.rows();

  const folder = join(home, 'ahpd', 'plugins', 'demo');
  const source = writing('first', marker);
  expect(await jo.call('x-ahpd/plugins/write', {
    id: 'demo',
    source,
    packageJson: { name: 'demo-plugin', version: '1.0.0' },
  })).toEqual({ result: { id: 'demo', restart: false } });

  // The folder is the plugin root's own, outside `node_modules`, where Node
  // would refuse to strip the types of the file the admin wrote.
  expect(folder.includes('node_modules')).toBe(false);
  expect(readFileSync(join(folder, 'index.ts'), 'utf8')).toBe(source);
  expect(held().plugins).toContain(folder);
  // npm runs in a staging folder beside it, and only a success moves that into
  // place; a write that replaced nothing leaves no staging folder behind.
  const staged = join(home, 'ahpd', 'plugins', '.demo.new');
  expect(calls[0]?.argv).toEqual(['install', '--prefix', staged]);
  expect(existsSync(staged)).toBe(false);
  // The daemon loaded it before the command answered, so its apply ran.
  expect(readFileSync(marker, 'utf8')).toBe('first\n');

  const rows = await ana.rows();
  expect(Object.keys(rows)).toEqual(['declared', 'secret', 'demo']);
  expect((rows['demo'] as Bag)['loaded']).toBe(true);
  await close();
});

it('writes the same id again, and the plugin runs the new text', async () => {
  const marker = join(home, 'applied.log');
  const { runner } = fakeNpm({});
  const { host, users, close } = await live({ run: runner });
  const jo = await as(host, users, 'jo');

  await jo.call('x-ahpd/plugins/write', { id: 'demo', source: writing('first', marker), packageJson: { name: 'demo-plugin' } });
  expect(readFileSync(marker, 'utf8')).toBe('first\n');

  expect(await jo.call('x-ahpd/plugins/write', { id: 'demo', source: writing('second', marker), packageJson: { name: 'demo-plugin' } }))
    .toEqual({ result: { id: 'demo', restart: false } });
  // The files are replaced and the folder imported again, as a reload does:
  // the new text ran once, and the old one did not run a second time.
  expect(readFileSync(marker, 'utf8')).toBe('first\nsecond\n');
  expect(readFileSync(join(home, 'ahpd', 'plugins', 'demo', 'index.ts'), 'utf8')).toBe(writing('second', marker));
  await close();
});

it('leaves the files the daemon runs when a rewrite fails in npm', async () => {
  // The second write's npm fails. It was staged beside the folder, so the
  // `index.ts` and `package.json` the first write left, and the code they run,
  // are as they were: a failed rewrite is not a half-written plugin.
  const marker = join(home, 'applied.log');
  let installs = 0;
  const { runner } = fakeNpm({}, {
    fail: (argv) => (argv[0] === 'install' && ++installs === 2 ? 'npm error code E404' : undefined),
  });
  const { host, users, close } = await live({ run: runner });
  const jo = await as(host, users, 'jo');
  const folder = join(home, 'ahpd', 'plugins', 'demo');
  const staged = join(home, 'ahpd', 'plugins', '.demo.new');

  const first = writing('first', marker);
  await jo.call('x-ahpd/plugins/write', { id: 'demo', source: first, packageJson: { name: 'demo-plugin', version: '1.0.0' } });
  const packageJson = readFileSync(join(folder, 'package.json'), 'utf8');

  expect(await jo.call('x-ahpd/plugins/write', {
    id: 'demo',
    source: writing('second', marker),
    packageJson: { name: 'demo-plugin', version: '2.0.0' },
  })).toMatchObject({ code: -32602, message: expect.stringContaining('npm error code E404') });

  expect(readFileSync(join(folder, 'index.ts'), 'utf8')).toBe(first);
  expect(readFileSync(join(folder, 'package.json'), 'utf8')).toBe(packageJson);
  // Only staging is taken out; the folder `plugins` names still runs the first
  // text, and no half-swapped copy is left beside it.
  expect(existsSync(staged)).toBe(false);
  expect(existsSync(join(home, 'ahpd', 'plugins', '.demo.old'))).toBe(false);
  expect(held().plugins).toContain(folder);
  expect(readFileSync(marker, 'utf8')).toBe('first\n');
  await close();
});

it('reads the text back as another admin, and refuses one that was not written in a client', async () => {
  const marker = join(home, 'applied.log');
  const { runner } = fakeNpm({});
  const { host, users, close } = await live({ run: runner });
  const jo = await as(host, users, 'jo');
  const lu = await as(host, users, 'lu');

  const source = writing('first', marker);
  await jo.call('x-ahpd/plugins/write', { id: 'demo', source, packageJson: { version: '2.0.0' } });

  const read = await lu.call('x-ahpd/plugins/source', { id: 'demo' });
  expect(read.result?.['source']).toBe(source);
  const packageJson = JSON.parse(read.result?.['packageJson'] as string) as Bag;
  expect(packageJson['name']).toBe('demo');
  expect(packageJson['version']).toBe('2.0.0');
  // The entry the write filled in, because the admin's package named none.
  expect(packageJson['ahpd']).toEqual({ entry: './index.ts' });

  // A configured package is not the daemon's text to hand out.
  expect(await lu.call('x-ahpd/plugins/source', { id: 'declared' })).toMatchObject({ code: -32602 });
  await close();
});

it('refuses write and source to a member, and a write that is not a slug or a package', async () => {
  const { host, users, close } = await served();
  const jo = await as(host, users, 'jo');
  const ka = await as(host, users, 'ka');
  const source = writing('first', join(home, 'applied.log'));

  expect(await ka.call('x-ahpd/plugins/write', { id: 'demo', source, packageJson: {} })).toMatchObject({ code: -32009 });
  expect(await ka.call('x-ahpd/plugins/source', { id: 'demo' })).toMatchObject({ code: -32009 });
  expect(await jo.call('x-ahpd/plugins/write', { id: 'Demo!', source, packageJson: {} })).toMatchObject({ code: -32602 });
  expect(await jo.call('x-ahpd/plugins/write', { id: 'demo', source, packageJson: '[]' })).toMatchObject({ code: -32602 });
  expect(await jo.call('x-ahpd/plugins/write', { id: 'demo', source: '   ', packageJson: {} })).toMatchObject({ code: -32602 });
  await close();
});

it('removes a written plugin, and its folder is gone', async () => {
  const marker = join(home, 'applied.log');
  const { runner } = fakeNpm({});
  const { host, users, close } = await live({ run: runner });
  const ana = await as(host, users, 'ana');
  const jo = await as(host, users, 'jo');
  await ana.rows();
  await jo.call('x-ahpd/plugins/write', { id: 'demo', source: writing('first', marker), packageJson: {} });
  const folder = join(home, 'ahpd', 'plugins', 'demo');
  expect(existsSync(folder)).toBe(true);
  await ana.rows();

  expect(await jo.call('x-ahpd/plugins/remove', { id: 'demo' })).toEqual({ result: { id: 'demo', restart: false } });
  expect(existsSync(folder)).toBe(false);
  expect(held().plugins).not.toContain(folder);
  expect(Object.keys(await ana.rows())).toEqual(['declared', 'secret']);
  await close();
});

it('refuses an install over HTTP to a role holding plugin:write, and takes plugin:install', async () => {
  const { users, close } = await served();
  const ask = servedHttp(users);

  // `plugin:write` is the three commands on configured plugins, not this one.
  const refused = await ask('/plugin/install', await users.mint('cy'), { name: [DECLARED] });
  expect(refused.status).toBe(403);
  expect((await refused.json() as { message: string }).message).toBe('cy may not plugin:install here');

  // A role that names the grant gets in: the sdk is the command's own
  // refusal, so the request was not stopped at the grant, and npm never ran.
  const asJo = await ask('/plugin/install', await users.mint('jo'), { name: ['@ahpd/sdk'] });
  expect(asJo.status).toBe(400);
  expect((await asJo.json() as { message: string }).message).toContain('@ahpd/sdk is not a plugin');
  await close();
});

it('writes one option through the channel, and refuses a value the schema refuses', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');
  const cy = await as(host, users, 'cy');
  await ana.rows();

  expect(await cy.call('x-ahpd/plugins/options', { id: 'secret', key: 'region', value: 'us' })).toEqual({
    result: { id: 'secret', key: 'region', value: 'us', restart: true },
  });
  expect(held().plugins).toEqual([DECLARED, { source: SECRET, options: { apiKey: 'sk-live-1', region: 'us' } }]);

  // `retries` is an integer of at least zero, and nothing is written.
  expect(await cy.call('x-ahpd/plugins/options', { id: 'secret', key: 'retries', value: -1 })).toMatchObject({ code: -32602 });
  expect(held().plugins).toEqual([DECLARED, { source: SECRET, options: { apiKey: 'sk-live-1', region: 'us' } }]);

  await wait(50);
  expect(ana.heard(URI)).toEqual(['changed secret']);
  expect(((await ana.rows())['secret'] as Bag)['spec']).toEqual({ source: SECRET, options: { apiKey: SET, region: 'us' } });
  await close();
});

it('lists a spec that does not resolve with the userinfo of its URL masked, in its id as well', async () => {
  const { host, users, close } = await served();
  writeFileSync(config, JSON.stringify({ plugins: ['https://bob:sk-live-2@example.invalid/p.tgz'] }));
  const ana = await as(host, users, 'ana');

  const rows = await ana.rows();
  expect(Object.keys(rows)).toEqual([`https://${SET}@example.invalid/p.tgz`]);
  expect(JSON.stringify(rows)).not.toContain('sk-live-2');
  await close();
});

it('serves the problem a plugin that failed to load left, with its URL userinfo masked', async () => {
  writeFileSync(config, JSON.stringify({ plugins: ['https://bob:sk-live-2@example.invalid/p.tgz'] }));
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');

  const row = (await ana.rows())[`https://${SET}@example.invalid/p.tgz`] as Bag;
  expect(row['loaded']).toBe(false);
  const alerts = row['alerts'] as Bag[];
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.['level']).toBe('error');
  expect(String(alerts[0]?.['text'])).toContain(`https://${SET}@example.invalid/p.tgz`);
  expect(JSON.stringify(row)).not.toContain('sk-live-2');
  await close();
});

it('serves a plugin whose apply throws as not loaded, and its problem without the write-only value', async () => {
  writeFileSync(config, JSON.stringify({
    plugins: [{ name: THROWS, options: { apiKey: 'sk-live-3', region: 'eu' } }],
  }));
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');

  const row = (await ana.rows())['throws-secret'] as Bag;
  expect(row['loaded']).toBe(false);
  // The error names what the plugin was handed, so the non-secret option is
  // still there and the credential is not.
  const alerts = row['alerts'] as Bag[];
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.['level']).toBe('error');
  expect(String(alerts[0]?.['text'])).toContain('the secret fixture threw');
  expect(String(alerts[0]?.['text'])).toContain('in eu');
  expect(String(alerts[0]?.['text'])).not.toContain('sk-live-3');
  expect(JSON.stringify(row)).not.toContain('sk-live-3');
  await close();
});

it('serves a load problem without a value its schema marks secret', async () => {
  writeFileSync(config, JSON.stringify({
    plugins: [{ name: THROWS, options: { apiKey: 'sk-live-3', token: 'tk-live-4', region: 'eu' } }],
  }));
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');

  const row = (await ana.rows())['throws-secret'] as Bag;
  expect(row['loaded']).toBe(false);
  const alerts = row['alerts'] as Bag[];
  expect(alerts).toHaveLength(1);
  // A `secret` option is a credential as a `writeOnly` one is, and neither is
  // served where the plugin's own error quoted it.
  expect(String(alerts[0]?.['text'])).toContain('the secret fixture threw');
  expect(String(alerts[0]?.['text'])).not.toContain('tk-live-4');
  expect(String(alerts[0]?.['text'])).not.toContain('sk-live-3');
  expect(JSON.stringify(row)).not.toContain('tk-live-4');
  await close();
});

it('lists what a plugin said in apply as a warning alert, and loads it all the same', async () => {
  writeFileSync(config, JSON.stringify({ plugins: ['./fixtures/plugin-skips/index.ts'] }));
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');

  const row = (await ana.rows())['skips'] as Bag;
  // The plugin said one thing and was loaded: an item skipped costs the item.
  expect(row['loaded']).toBe(true);
  expect(row['alerts']).toEqual([{
    level: 'warning',
    text: 'presets.router reads OPENROUTER_API_KEY, which the daemon\'s environment does not have',
  }]);
  await close();
});

it('replaces an alert with the same ref, clears it by ref, and sends the row again', async () => {
  writeFileSync(config, JSON.stringify({ plugins: ['./fixtures/plugin-after/index.ts'] }));
  const { host, users, close } = await live();
  const ana = await as(host, users, 'ana');
  await ana.rows();

  // Said after `apply` returned, which is the moment a plugin holding a watch
  // alerts: there is no load answer left for the line to join.
  const after = (globalThis as Record<string, unknown>).__pluginAfterHost as PluginHost;
  after.alert({ level: 'warning', text: 'the store could not be read', ref: 'store' });
  after.alert({ level: 'notice', text: 'the store was read again', ref: 'store' });
  await wait(50);

  expect(ana.heard(URI)).toContain('changed after');
  const row = (await ana.rows())['after'] as Bag;
  // The second alert replaced the first: one ref is one alert.
  expect(row['alerts']).toEqual([{ level: 'notice', text: 'the store was read again', ref: 'store' }]);

  after.clearAlert('store');
  await wait(50);
  expect(((await ana.rows())['after'] as Bag)['alerts']).toEqual([]);
  await close();
});

it('keeps the newest fifty alerts on a plugin, and a reload clears its row and drops the old host', async () => {
  writeFileSync(config, JSON.stringify({ plugins: ['./fixtures/plugin-after/index.ts'] }));
  const base = { path: home, agents: [echo({ path: home })] };
  const set = pluginSet({ base, configDir: fixtures, cwd: here, log: () => {} });
  const first = await loadPlugins(['./fixtures/plugin-after/index.ts'], { base, configDir: fixtures, cwd: here, log: () => {}, set });
  expect(first.problems).toEqual([]);

  const after = (globalThis as Record<string, unknown>).__pluginAfterHost as PluginHost;
  for (let at = 0; at < 60; at += 1) after.alert({ level: 'info', text: `alert ${String(at)}` });
  const alerts = set.alerts()['after'] ?? [];
  // A plugin that alerts in a loop drops its oldest: the newest fifty stay.
  expect(alerts).toHaveLength(50);
  expect(alerts[0]?.text).toBe('alert 10');
  expect(alerts.at(-1)?.text).toBe('alert 59');

  await applyPlugins({ set, configFile: config, reload: ['after'], log: () => {} });
  // A reload starts a clean row: what the last load raised is not this one's.
  expect(set.alerts()['after']).toBeUndefined();
  // The host the last load had is not this plugin any more: what it says now is dropped.
  after.alert({ level: 'error', text: 'from the old load' });
  expect(set.alerts()['after']).toBeUndefined();
});

/** A view every client can draw: one sentence, and a Link under it. */
const NOTE: PluginView = {
  root: 'body',
  components: {
    body: { id: 'body', component: 'Column', children: ['note', 'site'] },
    note: { id: 'note', component: 'Text', text: 'the store is ready' },
    site: { id: 'site', component: 'Link', label: 'Open', href: 'https://example.test/' },
  },
};

it('carries a view a plugin shows after its load, sends the row again, and drops it when cleared', async () => {
  writeFileSync(config, JSON.stringify({ plugins: ['./fixtures/plugin-after/index.ts'] }));
  const { host, users, close } = await live();
  const ana = await as(host, users, 'ana');
  await ana.rows();

  // Shown after `apply` returned, which is the moment a plugin holding a watch
  // draws what it found: there is no load answer left for the view to join.
  const after = (globalThis as Record<string, unknown>).__pluginAfterHost as PluginHost;
  after.showView(NOTE);
  await wait(50);

  expect(ana.heard(URI)).toContain('changed after');
  const row = (await ana.rows())['after'] as Bag;
  expect(row['views']).toEqual({ main: NOTE });

  after.clearView();
  await wait(50);
  expect(((await ana.rows())['after'] as Bag)['views']).toBeUndefined();
  await close();
});

it('removes the views when a load starts again, and drops the views of a host that is not current', async () => {
  writeFileSync(config, JSON.stringify({ plugins: ['./fixtures/plugin-after/index.ts'] }));
  const base = { path: home, agents: [echo({ path: home })] };
  const set = pluginSet({ base, configDir: fixtures, cwd: here, log: () => {} });
  const first = await loadPlugins(['./fixtures/plugin-after/index.ts'], { base, configDir: fixtures, cwd: here, log: () => {}, set });
  expect(first.problems).toEqual([]);

  const after = (globalThis as Record<string, unknown>).__pluginAfterHost as PluginHost;
  after.showView(NOTE);
  expect(set.views()['after']?.['main']).toEqual(NOTE);

  await applyPlugins({ set, configFile: config, reload: ['after'], log: () => {} });
  // A load starts a clean row: what the load before it drew is not this one's.
  expect(set.views()['after']).toBeUndefined();
  // The host the last load had is not this plugin any more: what it draws now
  // is not about the plugin on the row.
  after.showView(NOTE);
  expect(set.views()['after']).toBeUndefined();
});

it('translates a view\'s Text and Link label in the reader\'s locale, and leaves the data as it is', async () => {
  /*
   * A plugin of this case's own, because a view is translated by the catalogs
   * of the plugin that drew it: the folder is written into the test's home, and
   * the plugin shows its view while it applies.
   */
  const folder = join(home, 'speaker');
  mkdirSync(join(folder, 'i18n'), { recursive: true });
  writeFileSync(join(folder, 'package.json'), JSON.stringify({
    name: 'plugin-speaker',
    version: '1.0.0',
    private: true,
    type: 'module',
    exports: { '.': './index.ts' },
    peerDependencies: { '@ahpd/sdk': '>=0.10 <1' },
    ahpd: { entry: './index.ts', title: 'Speaker', description: 'Draws one view.', i18n: 'i18n' },
  }));
  writeFileSync(join(folder, 'index.ts'), [
    "import type { Plugin, PluginView } from '@ahpd/sdk';",
    `const NOTE: PluginView = ${JSON.stringify(NOTE)};`,
    "export const name = 'speaker';",
    "export const apply: Plugin['apply'] = (host): void => { host.showView(NOTE); };",
    '',
  ].join('\n'));
  writeFileSync(join(folder, 'i18n', 'pt.json'), JSON.stringify({
    views: { main: { note: { text: 'a loja está pronta' }, site: { label: 'Abrir' } } },
  }));
  writeFileSync(config, JSON.stringify({ plugins: [folder] }));
  const { host, users, close } = await live();
  const ana = await as(host, users, 'ana', 'pt-BR');
  const cy = await as(host, users, 'cy');

  const pt = (await ana.rows())['speaker'] as Bag;
  expect(pt['views']['main']['components']['note']['text']).toBe('a loja está pronta');
  expect(pt['views']['main']['components']['site']['label']).toBe('Abrir');
  // A URL is data and not text, so it is served as the plugin drew it.
  expect(pt['views']['main']['components']['site']['href']).toBe('https://example.test/');

  const en = (await cy.rows())['speaker'] as Bag;
  expect(en['views']['main']['components']['note']['text']).toBe('the store is ready');
  expect(en['views']['main']['components']['site']['label']).toBe('Open');
  await close();
});

it('lists a switched-off plugin with the schema its package.json declares, and imports nothing', async () => {
  const marker = join(home, 'imported');
  const had = process.env['AHPD_MARKER'];
  process.env['AHPD_MARKER'] = marker;
  try {
    writeFileSync(config, JSON.stringify({
      plugins: [{ name: MARKER_OFF, options: { level: 1 }, enabled: false }],
    }));
    // Nothing loaded, because loading is what imports a switched-off plugin to
    // read its id; the listing alone must not.
    const { host, users, close } = await served({ load: false });
    const ana = await as(host, users, 'ana');

    const row = (await ana.rows())['marker-off'] as Bag;
    expect(row['state']).toBe('disabled');
    expect(row['loaded']).toBe(false);
    expect(row['alerts']).toEqual([]);
    expect(row['optionsSchema']).toEqual({ type: 'object', properties: { level: { type: 'integer' } } });
    expect(existsSync(marker)).toBe(false);
    await close();
  }
  finally {
    if (had === undefined) delete process.env['AHPD_MARKER']; else process.env['AHPD_MARKER'] = had;
  }
});

it('refuses a value a switched-off plugin\'s schema refuses, and writes one it accepts', async () => {
  writeFileSync(config, JSON.stringify({
    plugins: [{ source: MARKER_OFF, options: { level: 1 }, enabled: false }],
  }));
  // Loaded, because a write names the plugin by the id its module exports,
  // which is what the daemon's own set knows from the plan; the entry is still
  // switched off, so nothing applies it.
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.rows();

  // `level` is an integer, so a word is refused and the file is untouched.
  expect(await cy.call('x-ahpd/plugins/options', { id: 'marker-off', key: 'level', value: 'high' }))
    .toMatchObject({ code: -32602 });
  expect(held().plugins).toEqual([{ source: MARKER_OFF, options: { level: 1 }, enabled: false }]);

  expect(await cy.call('x-ahpd/plugins/options', { id: 'marker-off', key: 'level', value: 2 }))
    .toMatchObject({ result: { id: 'marker-off', key: 'level', value: 2 } });
  expect(held().plugins).toEqual([{ source: MARKER_OFF, options: { level: 2 }, enabled: false }]);
  await close();
});

it('masks a secret option on a switched-off plugin, and lists its schema', async () => {
  writeFileSync(config, JSON.stringify({
    plugins: [DECLARED, { source: SECRET, options: { apiKey: 'sk-live-4', region: 'eu' }, enabled: false }],
  }));
  const { host, users, close } = await served({ load: false });
  const ana = await as(host, users, 'ana');

  const row = (await ana.rows())['secret'] as Bag;
  expect(row['state']).toBe('disabled');
  expect(row['spec']).toMatchObject({ options: { apiKey: SET, region: 'eu' }, enabled: false });
  expect(row['optionsSchema']).toMatchObject({ properties: { apiKey: { writeOnly: true } } });
  expect(JSON.stringify(row)).not.toContain('sk-live-4');
  await close();
});

it('says a restart to every client of the root and to every client after it, and a new host over the same file starts without it', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');
  const cy = await as(host, users, 'cy');
  await ana.rows();
  expect(cy.met['ahpd.restartNeeded']).toBeUndefined();
  expect(ana.told('x-ahpd/restartNeeded')).toEqual([]);

  expect(await cy.call('x-ahpd/plugins/enable', { id: 'declared' })).toEqual({
    result: { id: 'declared', enabled: true, restart: true },
  });
  // Ana sent nothing: the mark is the host's, not the calling client's, and it
  // is said to her on the root she watches.
  expect(ana.told('x-ahpd/restartNeeded')).toEqual([{ channel: ROOT }]);
  // A client that connects afterwards reads it on its handshake.
  const bo = await as(host, users, 'bo');
  expect(bo.met['ahpd.restartNeeded']).toBe(true);

  // The mark lives only in memory, so the daemon that reads the file next
  // starts without it.
  const again = await served();
  const later = await as(again.host, again.users, 'bo');
  expect(later.met['ahpd.restartNeeded']).toBeUndefined();
  expect(later.told('x-ahpd/restartNeeded')).toEqual([]);
  await again.close();
  await close();
});

it('does not mark a restart for a refused command', async () => {
  const { host, users, close } = await served();
  const ana = await as(host, users, 'ana');
  const cy = await as(host, users, 'cy');
  await ana.rows();

  // `retries` is an integer of at least zero, so this is refused before the
  // file is written, and a refusal is not a change a restart would apply.
  expect(await cy.call('x-ahpd/plugins/options', { id: 'secret', key: 'retries', value: -1 }))
    .toMatchObject({ code: -32602 });
  expect(ana.told('x-ahpd/restartNeeded')).toEqual([]);
  expect((await as(host, users, 'bo')).met['ahpd.restartNeeded']).toBeUndefined();
  await close();
});

/**
 * A registry that holds each package's versions, written as `<version>` or
 * `<version> <@ahpd/sdk peer range>`, the last one `latest`.
 */
const registryHolding = (packages: Record<string, string[]>): Fetch => async (url) => {
  const versions = packages[String(url).slice(registry().length + 1)];
  if (versions === undefined) return new Response('{"error":"Not found"}', { status: 404 });
  return Response.json({
    'dist-tags': { latest: versions.at(-1) },
    versions: Object.fromEntries(versions.map((held) => {
      const [at, range] = held.split(' ');
      return [at as string, range === undefined ? {} : { peerDependencies: { '@ahpd/sdk': range } }];
    })),
  });
};

/**
 * `demo` installed from the registry at 1.0.0 and named in `plugins`, with a
 * runner whose next install lands `next`.
 */
const installedDemo = async (next: string) => {
  const manifests: Record<string, Record<string, unknown>> = { demo: { version: '1.0.0' } };
  const { runner, calls } = fakeNpm({ demo: '^1.0.0' }, { esm: true, manifests });
  await runner('npm', ['install', '--prefix', join(home, 'ahpd'), 'demo']);
  manifests['demo'] = { version: next };
  calls.length = 0;
  writeFileSync(config, JSON.stringify({ plugins: [...held().plugins, 'demo'] }));
  return { runner, calls };
};

it('updates a plugin to the version that fits this daemon, and loads it again', async () => {
  const { runner, calls } = await installedDemo('1.1.0');
  const { host, users, close } = await live({
    run: runner,
    version: '0.14.1',
    fetch: registryHolding({ demo: ['1.0.0 >=0.10', '1.1.0 >=0.14', '2.0.0 >=0.15'] }),
  });
  const ana = await as(host, users, 'ana');
  const jo = await as(host, users, 'jo');
  expect((await ana.rows())['demo']).toMatchObject({ version: '1.0.0', loaded: true });

  expect(await jo.call('x-ahpd/plugins/update', { id: 'demo' })).toEqual({
    result: { id: 'demo', from: '1.0.0', to: '1.1.0', restart: false },
  });
  // The newest version whose range admits 0.14.1, in the plugin root.
  expect(calls[0]?.argv.slice(0, 3)).toEqual(['install', '--prefix', join(home, 'ahpd')]);
  expect(calls[0]?.argv.at(-1)).toBe('demo@1.1.0');
  expect((await ana.rows())['demo']).toMatchObject({ version: '1.1.0', loaded: true });
  await close();
});

it('answers the id alone when the plugin is already at the version that fits', async () => {
  const { runner } = await installedDemo('1.0.0');
  const { host, users, close } = await live({
    run: runner,
    version: '0.14.1',
    fetch: registryHolding({ demo: ['1.0.0 >=0.10'] }),
  });
  const jo = await as(host, users, 'jo');

  expect(await jo.call('x-ahpd/plugins/update', { id: 'demo' })).toEqual({ result: { id: 'demo', restart: false } });
  await close();
});

it('refuses an update of a plugin nobody configured, or one named by its path', async () => {
  const { runner, calls } = fakeNpm({});
  const { host, users, close } = await live({ run: runner, fetch: registryHolding({}) });
  const jo = await as(host, users, 'jo');

  expect(await jo.call('x-ahpd/plugins/update', { id: 'nobody' })).toMatchObject({ code: -32602, message: expect.stringMatching(/no plugin nobody/) });
  // `declared` is a folder the configuration names, which npm did not install.
  expect(await jo.call('x-ahpd/plugins/update', { id: 'declared' })).toMatchObject({ code: -32602, message: expect.stringMatching(/is not installed in/) });
  expect(calls).toEqual([]);
  await close();
});

it('refuses an update to a role without plugin:install', async () => {
  const { runner, calls } = await installedDemo('1.1.0');
  const { host, users, close } = await live({ run: runner, fetch: registryHolding({ demo: ['1.1.0'] }) });
  const ha = await as(host, users, 'ha');

  expect(await ha.call('x-ahpd/plugins/update', { id: 'demo' })).toMatchObject({ code: -32009 });
  expect(calls).toEqual([]);
  await close();
});
