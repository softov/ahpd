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
 * overridden; and the two ways a load is refused - a top-level option that
 * belongs inside a preset, and a preset map that leaves nothing to register.
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

/** The plugin's own load, which is where a preset is checked. */
const load = (options: Record<string, unknown>) => loadPlugins([{ name: SOURCE, options }], {
  base: { path: '/tmp/ahpd-preset', agents: [echo({ path: '/tmp/ahpd-preset' })] },
  configDir: REPO,
  cwd: REPO,
  log: () => {},
});

/** The agents one load registered, beside the echo the base always carries. */
const agentsOf = async (options: Record<string, unknown>) => {
  const { problems, options: served } = await load(options);
  expect(problems).toEqual([]);
  return (served.agents ?? []).slice(1);
};

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

it('fails the plugin load over a preset field it does not hold, naming it', async () => {
  const { loaded, problems } = await load({ presets: { work: { temperature: 1 } } });
  expect(loaded).toEqual([]);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(
    // The loader says how long the load took, so only the failure is pinned.
    new RegExp(`^plugin ${NAME.replace('/', '\\/')} failed[^:]*: options\\.presets\\.work\\.temperature is not an option a preset holds$`, 'u'),
  );
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
  expect(loaded.map((one) => one.name)).toEqual([NAME]);
  expect((await load({ presets: { work: { models: [{ name: 'x' }] } } })).problems[0])
    .toMatch(/options\.presets\.work\.models\[0\] has neither an id nor a fetch$/u);
  expect((await load({ presets: { work: { models: 'claude-opus-5' } } })).problems[0])
    .toMatch(/options\.presets\.work\.models is not a list$/u);
  expect((await load({ presets: { work: { keepCliModels: 'yes' } } })).problems[0])
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

it('probes the endpoint the variant names, not the daemon\'s own', () => {
  const at = (preset: Record<string, unknown> | undefined) =>
    (claude({ paths: ['/tmp/ahpd-preset'], ...(preset === undefined ? {} : { preset }) }).endpoints?.() ?? [])
      .flatMap((one) => [one.url]);
  expect(at({ env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/' } })).toEqual(['https://openrouter.ai/api/v1/models']);
  // The daemon's own is what a variant that names none runs on.
  expect(at(undefined)).toEqual([`${(process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/models`]);
});

it('reads a variant env value from the daemon environment, and fails the load when it is not there', async () => {
  process.env.AHPD_PRESET_KEY = 'sk-from-daemon';
  const presets = { router: { env: { ANTHROPIC_AUTH_TOKEN: { fromEnv: 'AHPD_PRESET_KEY' } } } };
  expect((await load({ presets })).problems).toEqual([]);
  const env = (await queried(presets.router)).env as Record<string, string | undefined>;
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-from-daemon');
  delete process.env.AHPD_PRESET_KEY;

  const { loaded, problems } = await load({ presets });
  expect(loaded).toEqual([]);
  expect(problems[0]).toMatch(/options\.presets\.router\.env\.ANTHROPIC_AUTH_TOKEN reads AHPD_PRESET_KEY, which the daemon's environment does not have$/u);
  // Only `env` reads the daemon's variables.
  expect((await load({ presets: { router: { extraArgs: { debug: { fromEnv: 'PATH' } } } } })).problems[0])
    .toMatch(/options\.presets\.router\.extraArgs\.debug is not a string$/u);
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
