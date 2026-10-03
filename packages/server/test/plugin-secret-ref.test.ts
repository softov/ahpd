/*
 * A plugin option written as the name of a secret.
 *
 * In process, because what is under test is the loader's own resolution and the
 * fixtures are real modules: a reference is read before the schema is asked
 * whether the values are of the declared types, an option marked `secretAtUse`
 * keeps what was written, and a plugin that cannot have what it asked for costs
 * a line rather than the daemon.
 *
 * The vault is in memory because what a case checks is which store a read was
 * answered from, and what the file itself does is `vault-file.test.ts`'s.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPlugins } from '../src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';
import type { Vault } from '../../sdk/src/types/vault.js';

const here = import.meta.dirname;
const REF = join(here, 'fixtures', 'plugin-secret-ref');
const VAULT = join(here, 'fixtures', 'plugin-vault');
const VAULT_TWO = join(here, 'fixtures', 'plugin-vault-two');

/** A vault holding `host:probe` and nothing else. */
const holding = (value: string): Vault => ({
  get: async (name) => (name === 'host:probe' ? value : undefined),
  set: async () => {},
  delete: async () => false,
  list: async () => ['host:probe'],
});

/** A vault holding nothing, which is a daemon nobody has set a secret on. */
const empty: Vault = {
  get: async () => undefined,
  set: async () => {},
  delete: async () => false,
  list: async () => [],
};

/** A host with a vault of its own, or with none at all when the argument is absent. */
const base = (vault?: Vault): HostOptions => ({
  path: '/tmp/plugin-secret-ref',
  agents: [echo({ path: '/tmp/plugin-secret-ref' })],
  ...(vault === undefined ? {} : { vault }),
});

/**
 * Load the specs over a base with this vault, and what the fixtures said.
 *
 * The line each fixture logs is how it says what arrived, so the log is kept
 * and the rest of it dropped: this is about the options, not about the plugin
 * having loaded.
 */
const load = async (specs: PluginSpec[], vault?: Vault) => {
  const logged: string[] = [];
  const result = await loadPlugins(specs, {
    base: base(vault),
    configDir: join(here, 'fixtures'),
    cwd: here,
    log: (message) => { if (message.startsWith('arrived ')) logged.push(message); },
  });
  return { logged, result };
};

const REFERRING = (options: Record<string, unknown>): PluginSpec => ({ name: REF, options });

describe('a plugin option naming a secret', () => {
  it('reaches apply as the value, and passes a schema that asks for a string', async () => {
    const { logged, result } = await load([REFERRING({ apiKey: { $secret: 'host:probe' } })], holding('from the file'));

    expect(result.problems).toEqual([]);
    expect(result.loaded.map((one) => one.name)).toEqual(['secret-ref']);
    expect(logged).toEqual(['arrived apiKey "from the file" token undefined later undefined every undefined']);
    // What the plugin was given, and what nothing that answers a client reads:
    // root config answers what the file holds.
    expect(result.loaded[0]?.options['apiKey']).toBe('from the file');
  });

  it('is skipped as out of scope when it names a team or a person', async () => {
    for (const name of ['team:backend/key', 'user:softov/token']) {
      const { logged, result } = await load([REFERRING({ apiKey: { $secret: name } })], holding('from the file'));

      expect(result.loaded).toEqual([]);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]).toContain(`plugin secret-ref skipped: plugins.secret-ref.options.apiKey names ${name}`);
      expect(result.problems[0]).toContain('is not a secret this work may read');
      expect(logged).toEqual([]);
    }
  });

  it('is skipped saying the vault holds no such name', async () => {
    const { logged, result } = await load([REFERRING({ apiKey: { $secret: 'host:absent' } })], empty);

    expect(result.loaded).toEqual([]);
    expect(result.problems[0]).toContain('plugins.secret-ref.options.apiKey names host:absent: the vault holds no host:absent');
    expect(logged).toEqual([]);
  });

  it('is left as written where the option\'s schema says secretAtUse', async () => {
    const { logged, result } = await load([REFERRING({ later: { $secret: 'host:probe' } })], holding('from the file'));

    expect(result.problems).toEqual([]);
    // The reference is what the plugin gets, so it can ask for the value when
    // it needs one; the check ran against the name, which is a string.
    expect(logged).toEqual(['arrived apiKey undefined token undefined later {"$secret":"host:probe"} every undefined']);
    expect(result.loaded[0]?.options['later']).toEqual({ $secret: 'host:probe' });
  });

  it('is read from the vault a plugin listed before took the port over', async () => {
    const { logged, result } = await load(
      [{ name: VAULT, options: { replace: true } }, REFERRING({ apiKey: { $secret: 'host:probe' } })],
      holding('from the file'),
    );

    expect(result.problems).toEqual([]);
    expect(logged).toEqual(['arrived apiKey "from the plugin" token undefined later undefined every undefined']);
  });

  it('is the daemon\'s own where a plugin asked for the port without taking it', async () => {
    const { logged, result } = await load([VAULT, REFERRING({ apiKey: { $secret: 'host:probe' } })], holding('from the file'));

    expect(result.problems.some((one) => one.includes('already set'))).toBe(true);
    expect(logged).toEqual(['arrived apiKey "from the file" token undefined later undefined every undefined']);
  });

  it('is refused in the options of the plugin that takes the vault over', async () => {
    const { result } = await load(
      [{ name: VAULT, options: { replace: true, key: { $secret: 'host:probe' } } }],
      holding('from the file'),
    );

    expect(result.loaded).toEqual([]);
    expect(result.problems[0]).toContain("plugin vault-store skipped: a vault plugin's own options cannot name a secret");
    expect(result.options.vault).toBeDefined();
  });

  it('is checked against the value, so a schema that reads the value is answered', async () => {
    // `token` is declared `pattern: '^ghp_'`. Checked against the name, the
    // schema would be asked about `host:probe`, which no GitHub token is, and
    // every well-formed token would be refused.
    const { logged, result } = await load([REFERRING({ token: { $secret: 'host:probe' } })], holding('ghp_a-real-token'));

    expect(result.problems).toEqual([]);
    expect(logged).toEqual(['arrived apiKey undefined token "ghp_a-real-token" later undefined every undefined']);
  });

  it('says a schema that refuses the value without saying what the value is', async () => {
    const { logged, result } = await load([REFERRING({ token: { $secret: 'host:probe' } })], holding('sk-the-value-we-must-not-print'));

    expect(result.loaded).toEqual([]);
    expect(result.problems[0]).toContain('plugins.secret-ref.options.token');
    expect(result.problems.join('\n')).not.toContain('sk-the-value-we-must-not-print');
    // A refusal reaches a problem line and a log, so neither may carry it.
    expect(logged).toEqual([]);
  });

  it('leaves an object or array node as written, references beneath it and all', async () => {
    // A node the schema marked is the plugin's to read when it wants to, so a
    // name in it is never read at load and never resolved: not this work's to
    // read, so it would have been skipped otherwise.
    const written = [{ $secret: 'user:softov/token' }, { $secret: 'host:probe' }];
    const { logged, result } = await load([REFERRING({ every: written })], holding('from the file'));

    expect(result.problems).toEqual([]);
    expect(logged).toEqual([`arrived apiKey undefined token undefined later undefined every ${JSON.stringify(written)}`]);
    expect(result.loaded[0]?.options['every']).toEqual(written);
  });

  it('is read from the first vault plugin a host with none of its own let through', async () => {
    const { logged, result } = await load(
      [{ name: VAULT }, { name: VAULT_TWO }, REFERRING({ apiKey: { $secret: 'host:probe' } })],
    );

    // The fold's owner rule: the first vault plugin holds the port and the
    // second is refused it, so what the reader is given is the first plugin's
    // value. The loader's own tracking has to say the same thing, or a reader
    // would be answered from the plugin the fold threw out.
    expect(result.problems.some((one) => one.includes('vault-store-two') && one.includes('already set'))).toBe(true);
    expect(logged).toEqual(['arrived apiKey "from the plugin" token undefined later undefined every undefined']);
  });
});