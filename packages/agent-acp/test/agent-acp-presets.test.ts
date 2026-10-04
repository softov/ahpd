import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readSecret, type Vault } from '@ahpd/sdk';
import type { PluginHost } from '@ahpd/sdk';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { name, optionsOf } from '../src/plugin.js';
import type { AcpOptions } from '../src/types.js';

/*
 * Presets, and the agent each of them registers.
 *
 * A preset is a variant of this package: its key is the id clients name, it
 * takes a shipped row by naming it as its key or as its `base`, and one load of
 * the plugin registers one agent per preset. The cases here are the shapes that
 * takes: a shipped key, a key that takes a row by `base`, a key that writes a
 * spec of its own, a preset's own fields over the row's, the sign-in a row
 * applies once a key is there and its absence when none is, the two ways a load
 * is refused - a top-level option that belongs inside a preset, and a preset map
 * that leaves nothing to register - and the four ways one preset is not
 * registered while the others are.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-acp/src/index.ts';

/** A vault holding the given names, and nothing else. */
const heldVault = (held: Record<string, string>): Vault => ({
  get: async (name) => held[name],
  set: async () => {},
  delete: async () => false,
  list: async () => Object.keys(held).sort(),
});

/**
 * The plugin's own load, which is where a preset is checked, what it registered
 * and every line it said.
 *
 * The `log` records rather than drops, because a skipped preset is said twice:
 * once to the daemon's own log and once to whoever started the daemon.
 */
const load = async (options: Record<string, unknown>, vault?: Record<string, string>) => {
  const lines: string[] = [];
  const { loaded, problems, options: served } = await loadPlugins([{ name: SOURCE, options }], {
    base: {
      path: '/tmp/ahpd-acp-preset',
      agents: [echo({ path: '/tmp/ahpd-acp-preset' })],
      ...(vault === undefined ? {} : { vault: heldVault(vault) }),
    },
    configDir: REPO,
    cwd: REPO,
    log: (line: string) => { lines.push(line); },
  });
  return { loaded, problems, served, lines };
};

/** The lines one load said about the presets it would not register. */
const skippedOf = (problems: string[]): string[] => problems.filter((line) => line.startsWith(`${name}: `));

/** Everything else one load found, which in every case here is nothing. */
const othersOf = (problems: string[]): string[] => problems.filter((line) => !line.startsWith(`${name}: `));

/** The agents one load registered, beside the echo the base always carries. */
const agentsOf = async (options: Record<string, unknown>, vault?: Record<string, string>) => {
  const { loaded, problems, served } = await load(options, vault);
  expect(othersOf(problems)).toEqual([]);
  expect(loaded.map((one) => one.name)).toEqual([name]);
  return (served.agents ?? []).slice(1);
};

/**
 * The plugin's own merge, over a host that answers a secret and says a line.
 *
 * The registered agent carries the provider and the name but nothing else of
 * what it would spawn, so the command, the arguments and the environment are
 * read here rather than inferred from a server that is not on this host.
 */
const mergedOf = async (options: Record<string, unknown>, vault?: Record<string, string>): Promise<AcpOptions[]> => {
  const lines: string[] = [];
  const host = {
    log: (line: string) => { lines.push(line); },
    problem: (line: string) => { lines.push(line); },
    secret: async (name: string) => {
      const vaulted = vault === undefined ? undefined : await readSecret(heldVault(vault), name);
      if (vaulted === undefined) throw new Error(`${name} cannot be read: this host has no vault`);
      return vaulted;
    },
  } as unknown as PluginHost;
  return optionsOf(host, options);
};

it('gives each key of presets an agent of its own, under the shipped row it names', async () => {
  const agents = await agentsOf({ presets: { codex: { env: { X: '1' } }, copilot: {} } });
  expect(agents.map((one) => [one.provider, one.displayName])).toEqual([
    ['codex', 'Codex'],
    ['copilot', 'Copilot'],
  ]);

  const merged = await mergedOf({ presets: { codex: { env: { X: '1' } } } });
  expect(merged[0]?.command).toBe('codex-acp');
  expect(merged[0]?.provider).toBe('codex');
  expect(merged[0]?.displayName).toBe('Codex');
  expect(merged[0]?.env).toEqual({ X: '1' });
});

it('names a preset after its own key when the row names none it may take', async () => {
  const agents = await agentsOf({ presets: { mine: { command: 'mine', name: 'Mine' }, theirs: { command: 'theirs' } } });
  expect(agents.map((one) => [one.provider, one.displayName])).toEqual([['mine', 'Mine'], ['theirs', 'theirs']]);
});

it('takes the row a key names as its base, and its own fields over it', async () => {
  const agents = await agentsOf({ presets: { work: { base: 'copilot', name: 'Copilot work' } } });
  expect(agents.map((one) => [one.provider, one.displayName])).toEqual([['work', 'Copilot work']]);

  const merged = await mergedOf({ presets: { work: { base: 'copilot', name: 'Copilot work' } } });
  expect(merged[0]?.command).toBe('copilot');
  expect(merged[0]?.args).toEqual(['--acp']);
  expect(merged[0]?.env).toEqual({ COPILOT_AUTO_UPDATE: 'false' });
});

it('merges a preset env over the row the other side', async () => {
  const merged = await mergedOf({ presets: { copilot: { env: { COPILOT_HOME: '/tmp/copilot' } } } });
  expect(merged[0]?.env).toEqual({ COPILOT_AUTO_UPDATE: 'false', COPILOT_HOME: '/tmp/copilot' });

  // A row's own arguments are replaced rather than added to, because a preset
  // that named its own wrote the whole command.
  const rewritten = await mergedOf({ presets: { copilot: { args: [] } } });
  expect(rewritten[0]?.args).toEqual([]);
});

it('skips an unknown key with no command, naming it and the shipped presets', async () => {
  const { loaded, problems, lines } = await load({ presets: { codex: {}, nope: {} } });

  expect(loaded.map((one) => one.name)).toEqual([name]);
  expect(skippedOf(problems)).toHaveLength(1);
  expect(skippedOf(problems)[0]).toMatch(
    /options\.presets\.nope names no shipped preset and writes no command; the shipped presets are: codex, gemini/u,
  );
  // Said to the daemon's log as well, which is where an operator looks for it.
  expect(lines.filter((line) => line.includes('options.presets.nope'))).toEqual(skippedOf(problems));
});

it('skips a preset whose base names no row, and registers the rest', async () => {
  const agents = await agentsOf({ presets: { codex: {}, work: { base: 'nope' } } });
  expect(agents.map((one) => one.provider)).toEqual(['codex']);
  const { problems } = await load({ presets: { codex: {}, work: { base: 'nope' } } });
  expect(skippedOf(problems)[0]).toMatch(
    /options\.presets\.work\.base names nope, which is not one of: codex, gemini/u,
  );
});

it('skips a preset whose own authenticate carries no method id', async () => {
  const agents = await agentsOf({ presets: { codex: {}, work: { command: 'node', authenticate: { methodId: 3 } } } });
  expect(agents.map((one) => one.provider)).toEqual(['codex']);
  const { problems } = await load({ presets: { work: { command: 'node', authenticate: {} } } });
  expect(skippedOf(problems)[0]).toMatch(/options\.presets\.work\.authenticate\.methodId is required$/u);
});

it('refuses a top-level option that belongs inside a preset, naming where it goes', async () => {
  for (const key of ['command', 'args', 'env', 'cwd', 'provider', 'displayName', 'description', 'model', 'authenticate']) {
    const value = key === 'args' || key === 'env' ? {} : key === 'authenticate' ? { methodId: 'api-key' } : 'x';
    const { loaded, problems } = await load({ presets: { codex: {} }, [key]: value });
    expect(loaded).toEqual([]);
    expect(problems.join('\n')).toMatch(
      new RegExp(`options\\.${key} is written per preset, as presets\\.<id>\\.${key}$`, 'u'),
    );
  }
});

it('fails a load whose presets leave nothing to register, naming what it skipped', async () => {
  const { loaded, problems } = await load({ presets: { nope: {}, nothing: {} } });

  expect(loaded).toEqual([]);
  // The line each was skipped on, then the load refused over: the lines say why
  // and the refusal names the presets, so neither says the message twice.
  expect(skippedOf(problems)).toHaveLength(2);
  expect(othersOf(problems)).toHaveLength(1);
  expect(othersOf(problems)[0]).toMatch(
    /^plugin @ahpd\/agent-acp failed in \d+ ms: presets names no preset left to register an agent for: nope, nothing$/u,
  );
});

it('refuses an absent or empty presets rather than serving nothing', async () => {
  const absent = await load({});
  expect(absent.loaded).toEqual([]);
  // The daemon's own check answers first, which is what a listing promised.
  expect(othersOf(absent.problems)).toEqual([
    `plugin ${name} skipped: plugins.${name}.options.presets is required`,
  ]);

  const empty = await load({ presets: {} });
  expect(empty.loaded).toEqual([]);
  expect(othersOf(empty.problems)[0]).toMatch(
    /^plugin @ahpd\/agent-acp failed in \d+ ms: presets names no preset left to register an agent for$/u,
  );
  // Called directly, which is how an embedder reaches it, the empty map is the
  // load's own refusal rather than the schema's.
  await expect(optionsOf({ log: () => {}, problem: () => {}, secret: async () => '' } as unknown as PluginHost, { presets: {} }))
    .rejects.toThrow(/presets names no preset left to register an agent for$/u);
});

it('reads a preset `$secret` through the host and gives the agent the value', async () => {
  const presets = { codex: { env: { OPENAI_API_KEY: { $secret: 'host:oa' } } } };
  const { problems } = await load({ presets }, { 'host:oa': 'sk-from-vault' });
  expect(problems).toEqual([]);
  const [one] = await mergedOf({ presets }, { 'host:oa': 'sk-from-vault' });
  expect(one?.env).toEqual({ OPENAI_API_KEY: 'sk-from-vault' });
});

it('skips only the preset whose `$secret` is not held, or whose host has no vault', async () => {
  const presets = { codex: {}, mine: { command: 'mine', env: { OPENAI_API_KEY: { $secret: 'host:oa' } } } };
  for (const [held, because] of [
    [{ 'host:other': 'x' }, 'the vault holds no host:oa'],
    [undefined, 'host:oa cannot be read: this host has no vault'],
  ] as const) {
    const { problems, served } = await load({ presets }, held);
    expect((served.agents ?? []).slice(1).map((one) => one.provider)).toEqual(['codex']);
    expect(skippedOf(problems)).toHaveLength(1);
    expect(skippedOf(problems)[0]).toMatch(
      new RegExp(`options\\.presets\\.mine\\.env\\.OPENAI_API_KEY names host:oa: ${because.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'),
    );
  }
});

it('refuses a `user:` or `team:` name, whose secret is not this load\'s to read', async () => {
  // A preset's credential is the daemon's, so a name in another scope is a
  // preset that cannot be loaded here rather than one read as somebody's.
  for (const named of ['team:ops/key', 'user:softov/key']) {
    const { problems } = await load({ presets: { work: { command: 'node', env: { KEY: { $secret: named } } } } }, { [named]: 'k' });
    expect(skippedOf(problems)[0]).toMatch(
      new RegExp(`options\\.presets\\.work\\.env\\.KEY names ${named.replace('/', '\\/')}: ${named.replace('/', '\\/')} is not a secret this work may read$`, 'u'),
    );
  }
});

it("applies a row's sign-in once the daemon's own environment has its variable", async () => {
  delete process.env.CODEX_API_KEY;
  delete process.env.OPENAI_API_KEY;
  expect((await mergedOf({ presets: { codex: {} } }))[0]?.authenticate).toBeUndefined();

  process.env.OPENAI_API_KEY = 'sk-daemon';
  const withIt = (await mergedOf({ presets: { codex: {} } }))[0]?.authenticate;
  delete process.env.OPENAI_API_KEY;
  expect(withIt).toEqual({ methodId: 'api-key' });

  // And with none of the daemon's, a preset that carries the variable itself.
  expect((await mergedOf({ presets: { codex: { env: { CODEX_API_KEY: 'sk-preset' } } } }))[0]?.authenticate)
    .toEqual({ methodId: 'api-key' });
  // A preset that names its own sign-in wins over the row's, set or not.
  expect((await mergedOf({ presets: { codex: { authenticate: { methodId: 'oauth' } } } }))[0]?.authenticate)
    .toEqual({ methodId: 'oauth' });
});

it('sends no sign-in for a row that needs none', async () => {
  expect((await mergedOf({ presets: { gemini: {}, cursor: {} } })).map((one) => one.authenticate)).toEqual([undefined, undefined]);
  process.env.CURSOR_API_KEY = 'key-cursor';
  const cursor = await mergedOf({ presets: { cursor: {} } });
  delete process.env.CURSOR_API_KEY;
  expect(cursor[0]?.authenticate).toEqual({ methodId: 'cursor_login' });
});

it('keeps hostTools plugin-wide and lets a preset set its own', async () => {
  const everywhere = await mergedOf({ presets: { codex: {}, gemini: {} }, hostTools: false });
  expect(everywhere.map((one) => one.hostTools)).toEqual([false, false]);
  const one = await mergedOf({ presets: { codex: { hostTools: true }, gemini: {} }, hostTools: false });
  expect(one.map((said) => said.hostTools)).toEqual([true, false]);
  // Off unless a preset or the load says otherwise, which is the agent's own
  // default rather than a value written here.
  expect((await mergedOf({ presets: { codex: {} } }))[0]?.hostTools).toBeUndefined();
});