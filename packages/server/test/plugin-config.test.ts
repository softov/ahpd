/*
 * `ahpd plugin config`, `enable` and `disable`, run in this process.
 *
 * The configuration is a temporary directory, so every case writes the file it
 * reads and no case sees the configuration or the daemon record of whoever runs
 * the suite. The terminal's commands are run through the registry the program
 * is built from; the served ones through the handler a daemon answers with.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Output } from '@cofold/commands';
import { Program } from '@cofold/terminal';
import type { Options } from '../src/commands/options.js';
import { programGlobals } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';
import { apiOrigins } from '../src/commands/run.js';
import { servedRegistry, type ServedFacts } from '../src/commands/served.js';
import { apiHandler } from '../src/http.js';

/** A plugin whose `apiKey` is write-only, `region` is not, and `retries` is bounded. */
const SECRET = join(import.meta.dirname, 'fixtures', 'plugin-secret', 'index.ts');
const AUTHORITY = '127.0.0.1:9350';
/** A plugin that writes the file `AHPD_MARKER` names when it is imported. */
const MARKER = join(import.meta.dirname, 'fixtures', 'plugin-marker', 'index.ts');
/** The backend whose own search providers keep a key, nested under `tools`. */
const COFOLD = join(import.meta.dirname, '../../agent-cofold/src/index.ts');

let home: string;
let config: string;
let had: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-plugin-config-'));
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  mkdirSync(join(home, 'ahpd'), { recursive: true });
  config = join(home, 'ahpd', 'config.json');
});
afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
  rmSync(home, { recursive: true, force: true });
});

const put = (held: unknown): void => { writeFileSync(config, `${JSON.stringify(held, null, 2)}\n`); };
const read = (): { plugins: unknown[] } => JSON.parse(readFileSync(config, 'utf8')) as { plugins: unknown[] };

/** One terminal command, as what it answered and what it wrote. */
const run = async (id: string, input: Record<string, unknown>): Promise<{ output: Output | null; said: string }> => {
  const registry = cliRegistry();
  const command = registry.find(id);
  if (command === undefined) throw new Error(`no ${id}`);
  let said = '';
  const output = await registry.execute(command, {
    surface: 'cli',
    input: { configFile: config, ...input },
    io: { out: (text) => { said += text; }, err: (text) => { said += text; } },
  });
  return { output, said };
};

/**
 * One line as `ahpd` reads it, in this process.
 *
 * `run` names a command; this names the words a person types, so a case can ask
 * which command those words reach. The registry and the globals are the ones
 * `main.ts` builds its program from, and the io is captured rather than written.
 */
const line = async (words: string[]): Promise<{ code: number; said: string }> => {
  let said = '';
  const program = new Program({
    name: 'ahpd',
    version: '0.0.0',
    registry: cliRegistry(),
    globals: programGlobals,
    io: { out: (text) => { said += text; }, err: (text) => { said += text; } },
  });
  return { code: await program.run(words), said };
};

describe('plugin config at the terminal', () => {
  it('shows every option the entry sets', async () => {
    put({ plugins: [{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }] });
    const all = await run('plugin.config', { name: SECRET });
    expect(all.output?.data).toEqual({ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } });
    expect(all.output?.plain).toBe(`${SECRET}\n  apiKey: "k-1"\n  region: "eu"\n`);
  });

  it('says so when an entry sets nothing', async () => {
    put({ plugins: [SECRET] });
    const all = await run('plugin.config', { name: SECRET });
    expect(all.output?.data).toEqual({ name: SECRET, options: {} });
    expect(all.output?.plain).toBe(`${SECRET}\n  (no options set)\n`);
  });

  it('sets a value, as JSON when it parses and as a string when it does not', async () => {
    put({ plugins: [SECRET] });
    await run('plugin.config.set', { name: SECRET, key: 'retries', value: '1' });
    await run('plugin.config.set', { name: SECRET, key: 'region', value: 'eu' });
    expect(read().plugins).toEqual([{ name: SECRET, options: { retries: 1, region: 'eu' } }]);
  });

  it('refuses a value the plugin\'s schema refuses, naming the option, and writes nothing', async () => {
    put({ plugins: [SECRET] });
    await expect(run('plugin.config.set', { name: SECRET, key: 'retries', value: '-1' }))
      .rejects.toThrow(`plugins.${SECRET}.options.retries must be an integer >= 0`);
    expect(read().plugins).toEqual([SECRET]);
  });

  it('writes a reference for a string option, and refuses a name that is not one', async () => {
    put({ plugins: [SECRET] });
    // `{"$secret": "host:orders"}` parses as JSON, so the value is a reference
    // rather than a string: it is held to the name rule, not to `type: string`.
    await run('plugin.config.set', { name: SECRET, key: 'apiKey', value: '{"$secret": "host:orders"}' });
    expect(read().plugins).toEqual([{ name: SECRET, options: { apiKey: { $secret: 'host:orders' } } }]);
    // And it is answered as written, so the name stays visible.
    expect((await run('plugin.config', { name: SECRET })).output?.data)
      .toEqual({ name: SECRET, options: { apiKey: { $secret: 'host:orders' } } });

    await expect(run('plugin.config.set', { name: SECRET, key: 'apiKey', value: '{"$secret": "x"}' }))
      .rejects.toThrow('x is not a secret name');
    expect(read().plugins).toEqual([{ name: SECRET, options: { apiKey: { $secret: 'host:orders' } } }]);
  });

  it('writes a value for a plugin it cannot import, and says it is checked at the next start', async () => {
    put({ plugins: ['not-installed-anywhere'] });
    const set = await run('plugin.config.set', { name: 'not-installed-anywhere', key: 'mode', value: 'fast' });
    expect(read().plugins).toEqual([{ name: 'not-installed-anywhere', options: { mode: 'fast' } }]);
    expect(set.said).toContain('checked at the next start');
  });

  it('unsets a value', async () => {
    put({ plugins: [{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }] });
    await run('plugin.config.unset', { name: SECRET, key: 'apiKey' });
    expect(read().plugins).toEqual([{ name: SECRET, options: { region: 'eu' } }]);
  });

  it('leaves the file alone and says so when the option was not set, a string entry included', async () => {
    put({ plugins: [SECRET, { name: 'other', options: { region: 'eu' } }] });
    const before = readFileSync(config, 'utf8');
    const bare = await run('plugin.config.unset', { name: SECRET, key: 'apiKey' });
    expect(bare.said).toBe(`${SECRET} sets no apiKey in ${config}.\n`);
    const other = await run('plugin.config.unset', { name: 'other', key: 'apiKey' });
    expect(other.said).toBe(`other sets no apiKey in ${config}.\n`);
    expect(readFileSync(config, 'utf8')).toBe(before);
  });

  it('refuses `plugin config <name> <key>`, which is not a read any more', async () => {
    put({ plugins: [{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }] });
    // The words used to show one option, and then to remove one with --unset.
    // Neither is what they reach now: `plugin config <name>` shows every
    // option, and taking one away is `plugin config unset <name> <key>`.
    const refused = await line(['plugin', 'config', SECRET, 'region']);
    expect(refused.code).toBe(2);
    expect(refused.said).toBe(`ahpd: unknown command "plugin config ${SECRET} region". Try ahpd --help\n`);
  });

  it('reads the word `unset` as the verb rather than as a plugin named unset', async () => {
    put({ plugins: [{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }] });
    // Five words, which `plugin config <name> <key> <value>` would also take.
    // A literal outscores a slot, so this is the removal and not a set of the
    // option `region` on a plugin called `unset`.
    const ran = await line(['plugin', 'config', 'unset', SECRET, 'region']);
    expect(ran.code).toBe(0);
    expect(read().plugins).toEqual([{ name: SECRET, options: { apiKey: 'k-1' } }]);
  });

  it('refuses a plugin the file does not name', async () => {
    put({ plugins: [SECRET] });
    await expect(run('plugin.config', { name: 'nobody' })).rejects.toThrow(`nobody is not in plugins in ${config}`);
    await expect(run('plugin.enable', { name: 'nobody' })).rejects.toThrow(`nobody is not in plugins in ${config}`);
  });
});

describe('the restart line', () => {
  it('names ahpd restart when a daemon is running', async () => {
    writeFileSync(join(home, 'ahpd', 'daemon.json'), JSON.stringify({
      pid: process.pid, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/', paths: [], startedAt: '',
    }));
    put({ plugins: [SECRET] });
    const set = await run('plugin.config.set', { name: SECRET, key: 'region', value: 'eu' });
    expect(set.said).toContain('Restart the daemon to load the change: ahpd restart\n');
    expect(set.output?.data).toMatchObject({ restart: true });
    const off = await run('plugin.disable', { name: SECRET });
    expect(off.said).toContain('ahpd restart\n');
  });
});

describe('a recorded --plugin-option that overrides a set', () => {
  /** The record of a daemon this process stands in for, started with that line. */
  const recordedWith = (argv: string[]): void => {
    writeFileSync(join(home, 'ahpd', 'daemon.json'), JSON.stringify({
      pid: process.pid, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/', paths: [], startedAt: '', argv,
    }));
  };
  const RESTART = 'Restart the daemon to load the change: ahpd restart\n';
  /** What the line says about one key: the flag, never the value it holds. */
  const overrides = (key: string): string =>
    `--plugin-option ${SECRET}.${key}, recorded for this daemon, overrides it on ahpd restart.`;

  it('names the flag a set will not take effect past, and writes the file', async () => {
    recordedWith(['--path', '/tmp/x', '--plugin-option', `${SECRET}.region=eu`, '--plugin-option', `${SECRET}.retries=3`]);
    put({ plugins: [SECRET] });
    const set = await run('plugin.config.set', { name: SECRET, key: 'region', value: 'turn' });
    expect(set.said).toBe(`Set ${SECRET} region.\n${overrides('region')}\n${RESTART}`);
    expect(set.output?.data).toEqual({
      name: SECRET,
      key: 'region',
      value: 'turn',
      restart: true,
      overriddenBy: `--plugin-option ${SECRET}.region`,
      words: overrides('region'),
    });
    // The file holds the new value; the recorded flag is what a restart starts
    // from, so the line says the file's value never takes effect.
    expect(read().plugins).toEqual([{ name: SECRET, options: { region: 'turn' } }]);
  });

  it('reads both spellings the line may use', async () => {
    recordedWith([`--plugin-option=${SECRET}.region=eu`]);
    put({ plugins: [SECRET] });
    const set = await run('plugin.config.set', { name: SECRET, key: 'region', value: 'turn' });
    expect(set.said).toContain(`${overrides('region')}\n`);
  });

  it('says it after an unset too, which the flag puts back at the next restart', async () => {
    recordedWith(['--plugin-option', `${SECRET}.region=eu`]);
    put({ plugins: [{ name: SECRET, options: { region: 'eu' } }] });
    const off = await run('plugin.config.unset', { name: SECRET, key: 'region' });
    expect(off.said).toBe(`Unset ${SECRET} region.\n${overrides('region')}\n${RESTART}`);
    expect(off.output?.data).toEqual({
      name: SECRET, key: 'region', restart: true,
      overriddenBy: `--plugin-option ${SECRET}.region`, words: overrides('region'),
    });
    expect(read().plugins).toEqual([{ name: SECRET }]);
  });

  it('names the flag when the line gives one key twice, as a start reads it', async () => {
    recordedWith(['--plugin-option', `${SECRET}.region=eu`, '--plugin-option', `${SECRET}.region=us`]);
    put({ plugins: [SECRET] });
    const set = await run('plugin.config.set', { name: SECRET, key: 'region', value: 'turn' });
    expect(set.said).toContain(`${overrides('region')}\n`);
  });

  it('says nothing more for another key, another plugin, a record without a line, or none', async () => {
    const OVERRIDES = 'overrides it on ahpd restart';
    put({ plugins: [{ name: SECRET, options: { region: 'eu' } }] });

    // Another key of the same plugin.
    recordedWith(['--plugin-option', `${SECRET}.apiKey=k-1`]);
    const otherKey = await run('plugin.config.set', { name: SECRET, key: 'region', value: 'turn' });
    expect(otherKey.said).not.toContain(OVERRIDES);
    expect(otherKey.output?.data).toEqual({ name: SECRET, key: 'region', value: 'turn', restart: true });

    // A flag deeper than the key sets a path under it and not the key itself.
    recordedWith(['--plugin-option', `${SECRET}.region.eu=1`]);
    expect((await run('plugin.config.unset', { name: SECRET, key: 'region' })).said).not.toContain(OVERRIDES);

    // A flag for a plugin beside this one is that plugin's business.
    recordedWith(['--plugin-option', 'other.region=eu']);
    const beside = await run('plugin.config.set', { name: SECRET, key: 'region', value: 'turn' });
    expect(beside.said).not.toContain(OVERRIDES);
    expect(beside.said).toContain(RESTART);

    // A record an older daemon wrote, which holds no line of its own.
    writeFileSync(join(home, 'ahpd', 'daemon.json'), JSON.stringify({
      pid: process.pid, url: 'ws://127.0.0.1:9187', connectUrl: 'ws://127.0.0.1:9187/', paths: [], startedAt: '',
    }));
    const older = await run('plugin.config.set', { name: SECRET, key: 'region', value: 'turn' });
    expect(older.said).not.toContain(OVERRIDES);
    expect(older.said).toContain(RESTART);

    // And no record at all, where not even a restart is said.
    rmSync(join(home, 'ahpd', 'daemon.json'));
    const none = await run('plugin.config.set', { name: SECRET, key: 'region', value: 'turn' });
    expect(none.said).toBe(`Set ${SECRET} region.\n`);
  });

  it('carries the same line and the flag in a served answer', async () => {
    recordedWith(['--plugin-option', `${SECRET}.region=eu`]);
    put({ plugins: [SECRET] });
    const facts: ServedFacts = {
      options: {} as Options,
      configFile: config,
      running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9350, paths: [], startedAt: '' }),
      turning: () => [],
      restart: () => {},
    };
    const handler = apiHandler({
      registry: servedRegistry(facts),
      token: 'root-secret',
      program: { name: 'ahpd', version: '0.0.0' },
      origins: () => apiOrigins('127.0.0.1', undefined, 9350),
    });
    const answered = await handler(new Request(`http://${AUTHORITY}/api/plugin/config/set`, {
      method: 'POST',
      headers: { host: AUTHORITY, 'content-type': 'application/json', authorization: 'Bearer root-secret' },
      body: JSON.stringify({ name: SECRET, key: 'region', value: 'turn' }),
    }));
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({
      name: SECRET,
      key: 'region',
      value: 'turn',
      restart: true,
      overriddenBy: `--plugin-option ${SECRET}.region`,
      words: overrides('region'),
    });
  });
});

describe('plugin enable and disable at the terminal', () => {
  it('turns a string entry off and on', async () => {
    put({ plugins: [SECRET] });
    await run('plugin.disable', { name: SECRET });
    expect(read().plugins).toEqual([{ name: SECRET, enabled: false }]);
    await run('plugin.enable', { name: SECRET });
    expect(read().plugins).toEqual([{ name: SECRET, enabled: true }]);
  });

  it('turns an object entry off and on, keeping its options', async () => {
    put({ plugins: [{ name: SECRET, options: { region: 'eu' } }] });
    await run('plugin.disable', { name: SECRET });
    expect(read().plugins).toEqual([{ name: SECRET, options: { region: 'eu' }, enabled: false }]);
    await run('plugin.enable', { name: SECRET });
    expect(read().plugins).toEqual([{ name: SECRET, options: { region: 'eu' }, enabled: true }]);
  });

  it('leaves a string entry that is already on as it is', async () => {
    put({ plugins: [SECRET] });
    await run('plugin.enable', { name: SECRET });
    expect(read().plugins).toEqual([SECRET]);
  });
});

describe('plugin config, served', () => {
  const post = async (path: string, body: unknown): Promise<Response> => {
    const facts: ServedFacts = {
      options: {} as Options,
      configFile: config,
      running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9350, paths: [], startedAt: '' }),
      turning: () => [],
      restart: () => {},
    };
    const handler = apiHandler({
      registry: servedRegistry(facts),
      token: 'root-secret',
      program: { name: 'ahpd', version: '0.0.0' },
      origins: () => apiOrigins('127.0.0.1', undefined, 9350),
    });
    return handler(new Request(`http://${AUTHORITY}/api${path}`, {
      method: 'POST',
      headers: { host: AUTHORITY, 'content-type': 'application/json', authorization: 'Bearer root-secret' },
      body: JSON.stringify(body),
    }));
  };

  it('answers a write-only value as set, and any other as the file holds it', async () => {
    put({ plugins: [{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }] });
    const all = await post('/plugin/config', { name: SECRET });
    expect(all.status).toBe(200);
    expect(await all.json()).toEqual({ name: SECRET, options: { apiKey: '<set>', region: 'eu' } });
  });

  it('removes one option at /plugin/config/unset, as the line does', async () => {
    put({ plugins: [{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }] });
    const removed = await post('/plugin/config/unset', { name: SECRET, key: 'region' });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ name: SECRET, key: 'region', restart: true });
    expect(read().plugins).toEqual([{ name: SECRET, options: { apiKey: 'k-1' } }]);
  });

  it('sets a write-only value without answering it, and says to restart', async () => {
    put({ plugins: [SECRET] });
    const set = await post('/plugin/config/set', { name: SECRET, key: 'apiKey', value: 'k-2' });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ name: SECRET, key: 'apiKey', value: '<set>', restart: true });
    expect(read().plugins).toEqual([{ name: SECRET, options: { apiKey: 'k-2' } }]);
  });

  it('answers a reference as it is written, and writes one without answering its name', async () => {
    put({ plugins: [SECRET] });
    const set = await post('/plugin/config/set', { name: SECRET, key: 'apiKey', value: { $secret: 'host:orders' } });
    expect(set.status).toBe(200);
    // The option is `writeOnly`, and a reference is a name and not a value, so
    // what is answered is the reference rather than a mask.
    expect(await set.json()).toEqual({ name: SECRET, key: 'apiKey', value: { $secret: 'host:orders' }, restart: true });
    expect(read().plugins).toEqual([{ name: SECRET, options: { apiKey: { $secret: 'host:orders' } } }]);
    expect(await (await post('/plugin/config', { name: SECRET })).json())
      .toEqual({ name: SECRET, options: { apiKey: { $secret: 'host:orders' } } });

    const refused = await post('/plugin/config/set', { name: SECRET, key: 'apiKey', value: { $secret: 'x' } });
    expect(refused.status).toBe(400);
    expect((await refused.json() as { message: string }).message).toContain('x is not a secret name');
  });

  it('refuses a refused value with 400', async () => {
    put({ plugins: [SECRET] });
    const refused = await post('/plugin/config/set', { name: SECRET, key: 'retries', value: 'many' });
    expect(refused.status).toBe(400);
    expect((await refused.json() as { message: string }).message).toContain(`plugins.${SECRET}.options.retries`);
  });

  it('turns a plugin off and on', async () => {
    put({ plugins: [SECRET] });
    const off = await post('/plugin/disable', { name: SECRET });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ name: SECRET, enabled: false, restart: true });
    expect((await post('/plugin/enable', { name: SECRET })).status).toBe(200);
    expect(read().plugins).toEqual([{ name: SECRET, enabled: true }]);
  });
});

describe('the same mask in the other served answers', () => {
  /** One served GET, from a daemon whose own options are `options`. */
  const served = (options: Options = {} as Options) => {
    const facts: ServedFacts = {
      options,
      configFile: config,
      running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9350, paths: [], startedAt: '' }),
      turning: () => [],
      restart: () => {},
    };
    const handler = apiHandler({
      registry: servedRegistry(facts),
      token: 'root-secret',
      program: { name: 'ahpd', version: '0.0.0' },
      origins: () => apiOrigins('127.0.0.1', undefined, 9350),
    });
    return (path: string): Promise<Response> => handler(new Request(`http://${AUTHORITY}/api${path}`, {
      headers: { host: AUTHORITY, authorization: 'Bearer root-secret' },
    }));
  };

  it('answers a write-only value as set and any other as the file holds it, in the config', async () => {
    put({ connectionToken: 'the-secret', plugins: [{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }] });
    const answered = await served()('/config');
    expect(answered.status).toBe(200);
    const body = await answered.text();
    expect(body).not.toContain('k-1');
    expect(body).not.toContain('the-secret');
    expect((JSON.parse(body) as { config: unknown }).config).toEqual({
      connectionToken: '<set>',
      plugins: [{ name: SECRET, options: { apiKey: '<set>', region: 'eu' } }],
    });
  });

  it('answers the same in a served plugin list row', async () => {
    const spec = { name: SECRET, options: { apiKey: 'k-1', region: 'eu' } };
    put({ plugins: [spec] });
    const answered = await served({ plugins: [spec] } as unknown as Options)('/plugin/list');
    expect(answered.status).toBe(200);
    expect(await answered.json()).toMatchObject([{ spec: { options: { apiKey: '<set>', region: 'eu' } } }]);
  });

  it('answers a credential nested under an option as set, wherever it sits', async () => {
    const spec = { name: COFOLD, options: { tools: { web: { search: { brave: { apiKey: 'bs-1' }, duckduckgo: true } } } } };
    put({ plugins: [spec] });
    const asked = served({ plugins: [spec] } as unknown as Options);
    const config = await (await asked('/config')).text();
    expect(config).not.toContain('bs-1');
    expect(await (await asked('/plugin/list')).json()).toMatchObject([{
      spec: { options: { tools: { web: { search: { brave: { apiKey: '<set>' }, duckduckgo: true } } } } },
    }]);
  });

  it('never imports a plugin switched off to answer, and hides all of its values', async () => {
    const marker = join(home, 'imported');
    const had = process.env['AHPD_MARKER'];
    process.env['AHPD_MARKER'] = marker;
    try {
      const spec = { name: MARKER, options: { level: 1 }, enabled: false };
      put({ plugins: [spec] });
      const asked = served({ plugins: [spec] } as unknown as Options);
      expect((await (await asked('/config')).json() as { config: { plugins: { options: unknown }[] } }).config.plugins[0]?.options)
        .toEqual({ level: '<set>' });
      expect((await (await asked('/plugin/list')).json() as { spec: { options: unknown } }[])[0]?.spec.options)
        .toEqual({ level: '<set>' });
      expect(existsSync(marker)).toBe(false);
    }
    finally {
      if (had === undefined) delete process.env['AHPD_MARKER']; else process.env['AHPD_MARKER'] = had;
    }
  });

  it('prints the file as it is at the terminal', async () => {
    put({ plugins: [{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }] });
    const shown = await run('daemon.config', {});
    expect(shown.output?.data).toMatchObject({
      config: { plugins: [{ name: SECRET, options: { apiKey: 'k-1', region: 'eu' } }] },
    });
  });
});

describe('a plugin switched off', () => {
  it('is never imported to show, set or unset its options, at the terminal or served, and is once it is on', async () => {
    const marker = join(home, 'imported');
    const had = process.env['AHPD_MARKER'];
    process.env['AHPD_MARKER'] = marker;
    try {
      put({ plugins: [{ name: MARKER, options: { level: 1 }, enabled: false }] });
      const set = await run('plugin.config.set', { name: MARKER, key: 'level', value: 'not a number' });
      expect(set.said).toContain(`${MARKER} is switched off, so level is written unchecked; it is checked when the plugin is enabled and loads.`);
      expect(read().plugins).toEqual([{ name: MARKER, options: { level: 'not a number' }, enabled: false }]);
      await run('plugin.config', { name: MARKER });
      await run('plugin.config.unset', { name: MARKER, key: 'level' });

      const facts: ServedFacts = {
        options: {} as Options,
        configFile: config,
        running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9350, paths: [], startedAt: '' }),
        turning: () => [],
        restart: () => {},
      };
      const handler = apiHandler({
        registry: servedRegistry(facts),
        token: 'root-secret',
        program: { name: 'ahpd', version: '0.0.0' },
        origins: () => apiOrigins('127.0.0.1', undefined, 9350),
      });
      const post = (path: string, body: unknown): Promise<Response> => handler(new Request(`http://${AUTHORITY}/api${path}`, {
        method: 'POST',
        headers: { host: AUTHORITY, 'content-type': 'application/json', authorization: 'Bearer root-secret' },
        body: JSON.stringify(body),
      }));
      expect((await post('/plugin/config/set', { name: MARKER, key: 'level', value: '2' })).status).toBe(200);
      // Nothing says which of its options is a credential, so a served answer shows none.
      expect(await (await post('/plugin/config', { name: MARKER })).json()).toEqual({ name: MARKER, options: { level: '<set>' } });
      expect(existsSync(marker)).toBe(false);

      // The control: switched on, the same set imports it to check the value.
      put({ plugins: [MARKER] });
      await run('plugin.config.set', { name: MARKER, key: 'level', value: '3' });
      expect(existsSync(marker)).toBe(true);
    }
    finally {
      if (had === undefined) delete process.env['AHPD_MARKER']; else process.env['AHPD_MARKER'] = had;
    }
  });
});
