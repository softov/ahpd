import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { claude } from '../src/claude.js';
import type { Agent } from '@ahpd/sdk';

/*
 * Presets, and the agent each of them registers.
 *
 * A preset is a variant of this package: its key is the id clients name, it
 * carries a name and a model list of its own, and one load of the plugin
 * registers one agent per preset. The built-in `claude` is there unless it is
 * written `false`, and an object under its key is laid over it. The cases here
 * are the shapes that takes: none written, the built-in alone; a variant beside
 * it, with its own name and models; the built-in dropped; the built-in
 * overridden; the two ways a load is refused - a top-level option that belongs
 * inside a preset, and a preset map that leaves nothing to register - and the
 * three ways one preset is not registered while the others are.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: ({ options }: { options: Record<string, unknown> }) => {
    sdk.options.push(options);
    return {
      async *[Symbol.asyncIterator]() { /* nothing streamed */ },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      setMcpServers: async () => {},
      initializationResult: async () => ({}),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => {},
    };
  },
}));

const sdk = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

const { createSession } = await import('../src/session.js');

const REPO = join(import.meta.dirname, '../../..');
const NAME = '@ahpd/agent-claude';
const SOURCE = './packages/agent-claude/src/index.ts';

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** One session's `query()` options, on a variant holding the given values. */
const queried = async (preset: Record<string, unknown> | undefined, env?: Record<string, string>): Promise<Record<string, unknown>> => {
  sdk.options = [];
  createSession({
    uri: 'ahp-session:/preset',
    chatUri: 'ahp-chat:/preset',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-preset-')),
    emit: () => {},
    settings: {},
    ...(preset === undefined ? {} : { preset }),
    ...(env === undefined ? {} : { env }),
  });
  await settle();
  const one = sdk.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

/** What a backend offers a client, by key. */
const offered = (preset?: Record<string, unknown>) => {
  const agent = claude({ paths: ['/tmp/ahpd-preset'], ...(preset === undefined ? {} : { preset }) });
  return agent.schema().properties as Record<string, Record<string, unknown>>;
};

/** The plugin's own load, which is where a preset is checked, and what it skipped. */
const load = async (options: Record<string, unknown>, vault?: Record<string, string>) => {
  const { loaded, problems, options: served } = await loadPlugins([{ name: SOURCE, options }], {
    base: {
      path: '/tmp/ahpd-preset',
      agents: [echo({ path: '/tmp/ahpd-preset' })],
      ...(vault === undefined ? {} : { vault: heldVault(vault) }),
    },
    configDir: REPO,
    cwd: REPO,
    log: () => {},
  });
  return { loaded, problems, served };
};

/** A vault holding the given names, and nothing else. */
const heldVault = (held: Record<string, string>) => ({
  get: async (name: string) => held[name],
  set: async () => {},
  delete: async () => false,
  list: async () => Object.keys(held).sort(),
});

/** The agents one load registered, beside the echo the base always carries. */
const agentsOf = async (options: Record<string, unknown>) => {
  const { problems, served } = await load(options);
  expect(problems).toEqual([]);
  return (served.agents ?? []).slice(1);
};

/** The lines one load said about the presets it would not register. */
const skippedOf = (problems: string[]): string[] => problems.filter((line) => line.startsWith(`${NAME}: `));

/** Everything else one load found, which in every case here is nothing. */
const othersOf = (problems: string[]): string[] => problems.filter((line) => !line.startsWith(`${NAME}: `));

/** What one registered agent offers the picker, models and all. */
const modelsOf = async (agent: Agent | undefined) => (await agent?.probe?.())?.models;

it('registers the built-in alone when no preset is written', async () => {
  const agents = await agentsOf({});
  expect(agents).toHaveLength(1);
  expect([agents[0]?.provider, agents[0]?.displayName]).toEqual(['claude', 'Claude Code']);
});

it('registers an agent per variant, each with its own name and models', async () => {
  const agents = await agentsOf({
    presets: { 'claude-openrouter': { name: 'Claude OpenRouter', models: ['stealth/space-bunny-alpha', { id: 'claude-sonnet-5', name: 'Sonnet' }] } },
  });
  expect(agents.map((one) => [one.provider, one.displayName])).toEqual([
    ['claude', 'Claude Code'],
    ['claude-openrouter', 'Claude OpenRouter'],
  ]);
  // The picker offers each variant's own models, which is what a session-level
  // preset could not do: models are read off the agent at root.
  expect(await modelsOf(agents[1])).toEqual([
    { id: 'stealth/space-bunny-alpha', name: 'stealth/space-bunny-alpha' },
    { id: 'claude-sonnet-5', name: 'Sonnet' },
  ]);
  // The built-in names none, so the CLI's own list is what it offers.
  expect(await modelsOf(agents[0])).toEqual([]);
});

it('marks every preset agent a variant, and the built-in none, laid over or not', async () => {
  const agents = await agentsOf({ presets: { claude: { name: 'Claude at work' }, 'claude-openrouter': {} } });
  expect(agents.map((one) => [one.provider, one.variant])).toEqual([['claude', undefined], ['claude-openrouter', true]]);
  // A preset left alone without the built-in beside it is still a variant.
  const alone = await agentsOf({ presets: { claude: false, 'claude-openrouter': {} } });
  expect(alone.map((one) => [one.provider, one.variant])).toEqual([['claude-openrouter', true]]);
});

it('gives each variant its own configuration directory in a machine, unless computerConfigDir names one', async () => {
  const targets = (agents: Agent[]): (string | undefined)[] =>
    agents.map((one) => (one.machine?.().claudeConfigDirectory as { target?: string } | undefined)?.target);
  const agents = await agentsOf({ presets: { 'claude-openrouter': {} } });
  expect(targets(agents)).toEqual(['/ahpd/claude', '/ahpd/claude-openrouter']);
  expect(targets(await agentsOf({ computerConfigDir: '/ahpd/shared', presets: { 'claude-openrouter': {} } })))
    .toEqual(['/ahpd/shared', '/ahpd/shared']);
});

it('names a variant after its own key when it names none', async () => {
  const agents = await agentsOf({ presets: { 'claude-openrouter': {} } });
  expect(agents.map((one) => [one.provider, one.displayName])).toEqual([
    ['claude', 'Claude Code'],
    ['claude-openrouter', 'claude-openrouter'],
  ]);
});

it('registers only the variants when the built-in is false', async () => {
  const agents = await agentsOf({ presets: { claude: false, 'claude-openrouter': { name: 'Claude OpenRouter' } } });
  expect(agents.map((one) => [one.provider, one.displayName])).toEqual([['claude-openrouter', 'Claude OpenRouter']]);
});

it('lays an object under the built-in over it', async () => {
  const agents = await agentsOf({ presets: { claude: { name: 'Claude at work' } } });
  expect([agents[0]?.provider, agents[0]?.displayName]).toEqual(['claude', 'Claude at work']);
});

it('refuses a top-level option that belongs inside a preset, naming where it goes', async () => {
  for (const key of ['provider', 'displayName', 'models', 'keepCliModels']) {
    const { loaded, problems } = await load({ [key]: key === 'models' ? ['a'] : 'x' });
    expect(loaded).toEqual([]);
    // The daemon's own schema check answers first - the option is not one this
    // package holds at the top level any more - and the load is refused after
    // it, saying where the option goes now.
    expect(problems.join('\n')).toMatch(
      new RegExp(`options\\.${key} is written per variant, as presets\\.<id>\\.${key}$`, 'u'),
    );
  }
});

it('refuses a load that leaves no variant to register', async () => {
  const { loaded, problems } = await load({ presets: { claude: false } });
  expect(loaded).toEqual([]);
  expect(problems[0]).toMatch(/presets names no variant left to register an agent for$/u);
});

it('offers no preset key on a session, which picks the agent instead', () => {
  expect(offered()).not.toHaveProperty('preset');
  expect(offered({ thinking: 'disabled' })).not.toHaveProperty('preset');
});

it('skips a preset over a field it does not hold, naming it, and registers the rest', async () => {
  const { loaded, problems, served } = await load({ presets: { work: { temperature: 1 } } });
  expect(othersOf(problems)).toEqual([]);
  expect(loaded.map((one) => one.name)).toEqual([NAME]);
  expect((served.agents ?? []).slice(1).map((one) => one.provider)).toEqual(['claude']);
  expect(skippedOf(problems)).toHaveLength(1);
  expect(skippedOf(problems)[0]).toMatch(/options\.presets\.work\.temperature is not an option a preset holds$/u);
});

it('takes a preset whose fields are all declared, and holds its models like a harness\'s', async () => {
  const { loaded, problems } = await load({
    presets: {
      work: {
        name: 'Claude at work', sandbox: 'on', thinking: 'adaptive', outputStyle: 'concise',
        env: { ANTHROPIC_MODEL: 'claude-opus-5' }, extraArgs: { 'debug': null },
        models: ['stealth/space-bunny-alpha', { fetch: 'https://x', match: 'a/*', key: { fromEnv: 'K' } }],
        keepCliModels: true,
      },
    },
  });
  expect(problems).toEqual([]);
  expect(skippedOf(problems)).toEqual([]);
  expect(loaded.map((one) => one.name)).toEqual([NAME]);
  expect(skippedOf((await load({ presets: { work: { models: [{ name: 'x' }] } } })).problems)[0])
    .toMatch(/options\.presets\.work\.models\[0\] has neither an id nor a fetch$/u);
  expect(skippedOf((await load({ presets: { work: { models: 'claude-opus-5' } } })).problems)[0])
    .toMatch(/options\.presets\.work\.models is not a list$/u);
  expect(skippedOf((await load({ presets: { work: { keepCliModels: 'yes' } } })).problems)[0])
    .toMatch(/options\.presets\.work\.keepCliModels is not true or false$/u);
});

it('builds a session query from the declared values of its own variant', async () => {
  const options = await queried({ sandbox: 'on', thinking: 'disabled' });
  expect(options.settings).toEqual({ sandbox: { enabled: true } });
  expect(options.thinking).toEqual({ type: 'disabled' });
});

it('leaves a variant that names nothing on what a session always ran on', async () => {
  const options = await queried({});
  expect(options.settings).toBeUndefined();
  expect(options.thinking).toEqual({ type: 'adaptive' });
});

it('lays a signed-in credential over a variant env, and lets it unset a variable', async () => {
  process.env.AHPD_PRESET_PROBE = 'daemon';
  const preset = { env: { ANTHROPIC_API_KEY: 'from-preset', ANTHROPIC_BASE_URL: 'https://gateway', AHPD_PRESET_PROBE: null } };
  const env = (await queried(preset, { ANTHROPIC_API_KEY: 'signed-in' })).env as Record<string, string | undefined>;
  delete process.env.AHPD_PRESET_PROBE;
  expect(env.ANTHROPIC_API_KEY).toBe('signed-in');
  expect(env.ANTHROPIC_BASE_URL).toBe('https://gateway');
  expect('AHPD_PRESET_PROBE' in env).toBe(false);
  expect(env.PATH).toBe(process.env.PATH);
});

it('hands an extraArgs value the CLI did not take as a string its JSON text', async () => {
  const written = (await queried({ extraArgs: { settings: { permissions: { allow: ['Read'] } } } })).extraArgs;
  expect(written).toEqual({ settings: '{"permissions":{"allow":["Read"]}}' });
  // A string is its own text and `null` is a flag that takes none.
  expect((await queried({ extraArgs: { settings: '{"a":1}', verbose: null } })).extraArgs)
    .toEqual({ settings: '{"a":1}', verbose: null });
  // The same declaration builds the session keys, so a session setting is held
  // to the same values as a preset.
  expect((await queried({ extraArgs: { 'max-turns': 4, 'add-dir': ['/a', '/b'], 'debug': true } })).extraArgs)
    .toEqual({ 'max-turns': '4', 'add-dir': '["/a","/b"]', debug: 'true' });
  // And a preset holding one as an object is held, so a written preset and a
  // session setting are the same declaration read the same way.
  expect((await load({ presets: { router: { extraArgs: { settings: { permissions: { allow: ['Read'] } } } } } })).problems)
    .toEqual([]);
});

it('probes the endpoint the variant names, not the daemon\'s own', () => {
  const at = (preset: Record<string, unknown> | undefined) =>
    (claude({ paths: ['/tmp/ahpd-preset'], ...(preset === undefined ? {} : { preset }) }).endpoints?.() ?? [])
      .flatMap((one) => [one.url]);
  expect(at({ env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/' } })).toEqual(['https://openrouter.ai/api/v1/models']);
  // The daemon's own is what a variant that names none runs on.
  expect(at(undefined)).toEqual([`${(process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/models`]);
});

it('reads a variant env value from the daemon environment', async () => {
  process.env.AHPD_PRESET_KEY = 'sk-from-daemon';
  const presets = { router: { env: { ANTHROPIC_AUTH_TOKEN: { fromEnv: 'AHPD_PRESET_KEY' } } } };
  expect((await load({ presets })).problems).toEqual([]);
  const env = (await queried(presets.router)).env as Record<string, string | undefined>;
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-from-daemon');
  delete process.env.AHPD_PRESET_KEY;
});

it('skips only the preset whose daemon variable is not there, and says which', async () => {
  const { loaded, problems, served } = await load({
    presets: { claude: {}, router: { env: { ANTHROPIC_AUTH_TOKEN: { fromEnv: 'AHPD_PRESET_UNSET' } } } },
  });
  expect(loaded.map((one) => one.name)).toEqual([NAME]);
  expect((served.agents ?? []).slice(1).map((one) => one.provider)).toEqual(['claude']);
  expect(othersOf(problems)).toEqual([]);
  expect(skippedOf(problems)).toHaveLength(1);
  expect(skippedOf(problems)[0]).toMatch(
    /options\.presets\.router\.env\.ANTHROPIC_AUTH_TOKEN reads AHPD_PRESET_UNSET, which the daemon's environment does not have$/u,
  );
});

it('skips only the preset whose extraArgs value reads the daemon environment', async () => {
  const { problems, served } = await load({ presets: { router: { extraArgs: { debug: { fromEnv: 'PATH' } } } } });
  expect((served.agents ?? []).slice(1).map((one) => one.provider)).toEqual(['claude']);
  expect(othersOf(problems)).toEqual([]);
  // Only `env` reads the daemon's own variables.
  expect(skippedOf(problems)[0]).toMatch(/options\.presets\.router\.extraArgs\.debug reads the daemon's environment only under env$/u);
});

it('reads a preset `$secret` through the host and hands the value to the agent', async () => {
  const presets = { router: { env: {
    ANTHROPIC_AUTH_TOKEN: { $secret: 'host:or' },
    ANTHROPIC_BASE_URL: { $secret: 'host:base' },
  } } };
  const { problems, served } = await load({ presets }, { 'host:or': 'sk-or', 'host:base': 'https://held.example' });
  expect(problems).toEqual([]);
  expect(skippedOf(problems)).toEqual([]);
  const agents = (served.agents ?? []).slice(1);
  expect(agents.map((one) => one.provider)).toEqual(['claude', 'router']);
  // The value that was read is the endpoint the CLI is pointed at.
  expect(agents[1]?.endpoints?.()[0]?.url).toBe('https://held.example/v1/models');
});

it('skips only the preset whose `$secret` is not held, or whose host has no vault', async () => {
  const presets = { router: { env: { ANTHROPIC_AUTH_TOKEN: { $secret: 'host:or' } } } };
  for (const [held, because] of [
    [{}, 'the vault holds no host:or'],
    [undefined, 'host:or cannot be read: this host has no vault'],
  ] as const) {
    const { problems, served } = await load({ presets }, held);
    expect((served.agents ?? []).slice(1).map((one) => one.provider)).toEqual(['claude']);
    expect(othersOf(problems)).toEqual([]);
    expect(skippedOf(problems)).toHaveLength(1);
    expect(skippedOf(problems)[0]).toMatch(new RegExp(`options\\.presets\\.router\\.env\\.ANTHROPIC_AUTH_TOKEN names host:or: ${because}$`, 'u'));
  }
});

it('fails the load when the presets leave nothing to register, naming what it skipped', async () => {
  const { loaded, problems } = await load({ presets: { claude: false, router: { env: { ANTHROPIC_AUTH_TOKEN: { fromEnv: 'AHPD_PRESET_UNSET' } } } } });
  expect(loaded).toEqual([]);
  // The line it skipped on, then the load it refused over: the line says why,
  // the refusal names the preset, and neither says the message again.
  expect(skippedOf(problems)).toHaveLength(1);
  expect(skippedOf(problems)[0]).toMatch(
    /options\.presets\.router\.env\.ANTHROPIC_AUTH_TOKEN reads AHPD_PRESET_UNSET, which the daemon's environment does not have$/u,
  );
  expect(othersOf(problems)).toHaveLength(1);
  expect(othersOf(problems)[0]).toMatch(
    new RegExp(`^plugin ${NAME.replace('/', '\\/')} failed in \\d+ ms: presets names no variant left to register an agent for: router$`, 'u'),
  );
});

it('offers the models the harness names once a session has started', async () => {
  const session = createSession({
    uri: 'ahp-session:/models',
    chatUri: 'ahp-chat:/models',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-models-')),
    emit: () => {},
    settings: {},
    offerModels: async (cli) => [...cli, { id: 'stealth/space-bunny-alpha', name: 'Space Bunny' }],
  });
  await settle();
  expect(session.models?.()).toEqual([{ id: 'stealth/space-bunny-alpha', name: 'Space Bunny' }]);
});

/** One session's `query()` options in a machine, on a variant holding the given values. */
const queriedInside = async (preset: Record<string, unknown> | undefined, env?: Record<string, string>): Promise<Record<string, unknown>> => {
  sdk.options = [];
  createSession({
    uri: 'ahp-session:/inside',
    chatUri: 'ahp-chat:/inside',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-inside-')),
    emit: () => {},
    settings: {},
    spawn: () => { throw new Error('not spawned in this test'); },
    spawnExecutable: 'claude',
    spawnConfigDir: '/ahpd/claude',
    ...(preset === undefined ? {} : { preset }),
    ...(env === undefined ? {} : { env }),
  });
  await settle();
  const one = sdk.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

/** The daemon variables a case sets, put back after it. */
const withDaemon = async <T>(held: Record<string, string>, run: () => Promise<T>): Promise<T> => {
  const before = Object.fromEntries(Object.keys(held).map((key) => [key, process.env[key]]));
  Object.assign(process.env, held);
  try { return await run(); }
  finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

it("hands a variant's own env to the CLI in a machine, and nothing of the daemon's", async () => {
  const env = await withDaemon({ T: 'sk-or', ANTHROPIC_API_KEY: 'sk-daemon', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-daemon' }, async () =>
    (await queriedInside({ env: { ANTHROPIC_BASE_URL: 'https://x', ANTHROPIC_AUTH_TOKEN: { fromEnv: 'T' } } })).env as Record<string, string>);
  expect(env).toEqual({ ANTHROPIC_BASE_URL: 'https://x', ANTHROPIC_AUTH_TOKEN: 'sk-or', CLAUDE_CONFIG_DIR: '/ahpd/claude' });
});

it('hands the built-in no daemon key in a machine unless its env names one', async () => {
  await withDaemon({ ANTHROPIC_API_KEY: 'sk-daemon', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-daemon' }, async () => {
    expect((await queriedInside(undefined)).env).toEqual({ CLAUDE_CONFIG_DIR: '/ahpd/claude' });
    expect((await queriedInside({ env: { ANTHROPIC_API_KEY: { fromEnv: 'ANTHROPIC_API_KEY' } } })).env)
      .toEqual({ ANTHROPIC_API_KEY: 'sk-daemon', CLAUDE_CONFIG_DIR: '/ahpd/claude' });
  });
});

it('lays a pushed credential over the variant env in a machine, and leaves out an unset key', async () => {
  const env = await withDaemon({ ANTHROPIC_BASE_URL: 'https://daemon' }, async () =>
    (await queriedInside({ env: { ANTHROPIC_API_KEY: 'from-preset', ANTHROPIC_BASE_URL: null } }, { ANTHROPIC_API_KEY: 'signed-in' })).env);
  expect(env).toEqual({ ANTHROPIC_API_KEY: 'signed-in', CLAUDE_CONFIG_DIR: '/ahpd/claude' });
});

it('keeps the daemon environment under a variant env off a machine', async () => {
  const env = await withDaemon({ ANTHROPIC_API_KEY: 'sk-daemon' }, async () =>
    (await queried({ env: { ANTHROPIC_BASE_URL: 'https://x' } })).env as Record<string, string>);
  expect(env.ANTHROPIC_API_KEY).toBe('sk-daemon');
  expect(env.PATH).toBe(process.env.PATH);
});

it('gives two variants on one machine only their own keys on their docker exec', async () => {
  const asked: Record<string, string>[] = [];
  const computers = {
    how: async (_id: string, options: { env?: Record<string, string> }) => {
      asked.push(options.env ?? {});
      return { command: 'true' };
    },
  };
  await withDaemon({ ANTHROPIC_API_KEY: 'sk-daemon' }, async () => {
    const agents = await agentsOf({
      presets: {
        claude: { env: { ANTHROPIC_API_KEY: { fromEnv: 'ANTHROPIC_API_KEY' } } },
        openrouter: { env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api', ANTHROPIC_AUTH_TOKEN: 'sk-or' } },
      },
    });
    for (const agent of agents) {
      sdk.options = [];
      agent.create({
        uri: `ahp-session:/${agent.provider}`,
        chatUri: `ahp-chat:/${agent.provider}`,
        settings: { computer: 'computer://box' },
        computers: computers as never,
        emit: () => {},
      } as never);
      await settle();
      const options = sdk.options.at(0) as { spawnClaudeCodeProcess: (asked: unknown) => unknown; env: Record<string, string> };
      options.spawnClaudeCodeProcess({ command: 'claude', args: [], env: options.env });
      await settle();
    }
  });
  expect(asked).toEqual([
    { ANTHROPIC_API_KEY: 'sk-daemon', CLAUDE_CONFIG_DIR: '/ahpd/claude' },
    { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api', ANTHROPIC_AUTH_TOKEN: 'sk-or', CLAUDE_CONFIG_DIR: '/ahpd/openrouter' },
  ]);
});
