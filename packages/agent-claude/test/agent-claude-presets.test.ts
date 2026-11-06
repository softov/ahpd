import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { startedNow } from '../../sdk/test/support/started.js';
import type { Agent, Engine, AgentView, Bag, Start } from '@ahpd/sdk';

/*
 * The built-in agent and the variants people used to write as presets, now as records.
 *
 * A record of the `claude` engine is one of these: its id is what clients name, its name is what they read, and its config carries the declared options and the model list alike. The cases here are the shapes that takes: the template with nothing set, a variant beside it with its own name and models, a record holding every declared field, and what each one's config becomes - a session's query, the endpoint it probes, and the environment it hands a CLI in a machine.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
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
const SOURCE = './packages/agent-claude/src/index.ts';

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** The `claude` engine one load registered, with the plugin options it was given. */
const engineOf = async (options: Record<string, unknown> = {}): Promise<Engine> => {
  const { problems, options: served } = await loadPlugins([{ name: SOURCE, options }], {
    base: { path: '/tmp/ahpd-preset', agents: [echo({ path: '/tmp/ahpd-preset' })] },
    configDir: REPO,
    cwd: REPO,
    log: () => {},
  });
  expect(problems).toEqual([]);
  const engine = served.engines?.['claude'];
  if (engine === undefined) throw new Error('no claude engine was registered');
  return engine;
};

/** One record, as an engine is handed it: every field read at each call. */
const viewOf = (id: string, held: () => Bag, name = id): AgentView => ({
  id,
  engine: 'claude',
  owner: 'host',
  name,
  description: undefined,
  icon: undefined,
  model: undefined,
  get config() { return held(); },
});

/** How a client asks a backend for a session of one record. */
const startOf = (id: string, extra: Partial<Start> = {}): Start => ({
  uri: `ahp-session:/${id}`,
  chatUri: `ahp-chat:/${id}`,
  settings: {},
  clientToolTimeoutMs: 60_000,
  schema: () => ({ type: 'object', properties: {} }),
  emit: () => {},
  workingDirectory: mkdtempSync(join(tmpdir(), 'ahpd-preset-')),
  ...extra,
});

/** What one record's agent offers the picker, models and all. */
const modelsOf = async (agent: Agent | undefined) => (await agent?.probe?.())?.models;

/** The resource a pushed credential is for. */
const ANTHROPIC = 'https://api.anthropic.com';

/** The `query()` options one session's first send started its CLI with, on a record holding the given values. */
const queried = async (config: Bag | undefined, credential?: string): Promise<Record<string, unknown>> => {
  sdk.options = [];
  const engine = await engineOf();
  startedNow(engine.open(viewOf('claude', () => config ?? {})).create(startOf('preset', {
    ...(credential === undefined ? {} : { credentials: { [ANTHROPIC]: credential } }),
  }))).sendMessage('t1', 'hello');
  await settle();
  const one = sdk.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

/** The `query()` options one session's first send started its CLI with in a machine, on a record holding the given values. */
const queriedInside = async (config: Bag | undefined, credential?: string): Promise<Record<string, unknown>> => {
  sdk.options = [];
  const engine = await engineOf();
  startedNow(engine.open(viewOf('claude', () => config ?? {})).create(startOf('inside', {
    settings: { computer: 'computer://box' },
    computers: { how: async () => ({ command: 'true' }) } as never,
    ...(credential === undefined ? {} : { credentials: { [ANTHROPIC]: credential } }),
  }))).sendMessage('t1', 'hello');
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

it('opens the template with nothing set on the CLI\'s own models', async () => {
  const engine = await engineOf();
  const template = engine.templates?.[0];
  const agent = engine.open(viewOf('claude', () => template?.config ?? {}, template?.name));
  expect([agent.provider, agent.displayName]).toEqual(['claude', 'Claude']);
  expect(await modelsOf(agent)).toEqual([]);
});

it('opens one backend per record, each with its own name and models', async () => {
  const engine = await engineOf();
  const builtIn = engine.open(viewOf('claude', () => ({}), 'Claude Code'));
  const router = engine.open(viewOf('claude-openrouter', () => ({
    models: [{ id: 'stealth/space-bunny-alpha' }, { id: 'claude-sonnet-5', name: 'Sonnet' }],
  }), 'Claude OpenRouter'));
  expect([builtIn.provider, builtIn.displayName]).toEqual(['claude', 'Claude Code']);
  expect([router.provider, router.displayName]).toEqual(['claude-openrouter', 'Claude OpenRouter']);
  // The picker offers each record's own models, which is what a session-level
  // preset could not do: models are read off the agent at root.
  expect(await modelsOf(router)).toEqual([
    { id: 'stealth/space-bunny-alpha', name: 'stealth/space-bunny-alpha' },
    { id: 'claude-sonnet-5', name: 'Sonnet' },
  ]);
  // The built-in names none, so the CLI's own list is what it offers.
  expect(await modelsOf(builtIn)).toEqual([]);
});

it('gives each record its own configuration directory in a machine, unless computerConfigDir names one', async () => {
  const targets = (agents: Agent[]): (string | undefined)[] =>
    agents.map((one) => (one.machine?.().claudeConfigDirectory as { target?: string } | undefined)?.target);
  const pair = async (options: Record<string, unknown>) => {
    const engine = await engineOf(options);
    return [engine.open(viewOf('claude', () => ({}))), engine.open(viewOf('claude-openrouter', () => ({})))];
  };
  expect(targets(await pair({}))).toEqual(['/ahpd/claude', '/ahpd/claude-openrouter']);
  expect(targets(await pair({ computerConfigDir: '/ahpd/shared' })))
    .toEqual(['/ahpd/shared', '/ahpd/shared']);
});

it('offers no preset key on a session, which the record names instead', async () => {
  const engine = await engineOf();
  const offered = (config: Bag) => engine.open(viewOf('work', () => config)).schema().properties as Bag;
  expect(offered({})).not.toHaveProperty('preset');
  expect(offered({ thinking: 'disabled' })).not.toHaveProperty('preset');
});

it('opens a record holding every declared field and the models it names', async () => {
  const engine = await engineOf();
  const agent = engine.open(viewOf('work', () => ({
    sandbox: 'on', thinking: 'adaptive', outputStyle: 'concise',
    env: { ANTHROPIC_MODEL: 'claude-opus-5' }, extraArgs: { 'debug': null },
    models: [{ id: 'stealth/space-bunny-alpha' }, { id: 'claude-sonnet-5', name: 'Sonnet' }],
    keepCliModels: true,
  }), 'Claude at work'));
  expect([agent.provider, agent.displayName]).toEqual(['work', 'Claude at work']);
  expect(await modelsOf(agent)).toEqual([
    { id: 'stealth/space-bunny-alpha', name: 'stealth/space-bunny-alpha' },
    { id: 'claude-sonnet-5', name: 'Sonnet' },
  ]);
});

it('builds a session query from the declared values of its own record', async () => {
  const options = await queried({ sandbox: 'on', thinking: 'disabled' });
  expect(options.settings).toEqual({ sandbox: { enabled: true } });
  expect(options.thinking).toEqual({ type: 'disabled' });
});

it('leaves a record that names nothing on what a session always ran on', async () => {
  const options = await queried({});
  expect(options.settings).toBeUndefined();
  expect(options.thinking).toEqual({ type: 'adaptive' });
});

it('lays a signed-in credential over a record env, and lets it unset a variable', async () => {
  process.env.AHPD_PRESET_PROBE = 'daemon';
  const config = { env: { ANTHROPIC_API_KEY: 'from-record', ANTHROPIC_BASE_URL: 'https://gateway', AHPD_PRESET_PROBE: null } };
  const env = (await queried(config, 'signed-in')).env as Record<string, string | undefined>;
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
  // to the same values as a record.
  expect((await queried({ extraArgs: { 'max-turns': 4, 'add-dir': ['/a', '/b'], 'debug': true } })).extraArgs)
    .toEqual({ 'max-turns': '4', 'add-dir': '["/a","/b"]', debug: 'true' });
});

it('probes the endpoint the record names, not the daemon\'s own', async () => {
  const at = async (config?: Bag) => {
    const engine = await engineOf();
    return (engine.open(viewOf('work', () => config ?? {})).endpoints?.() ?? []).flatMap((one) => [one.url]);
  };
  expect(await at({ env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/' } })).toEqual(['https://openrouter.ai/api/v1/models']);
  // The daemon's own is what a record that names none runs on.
  expect(await at()).toEqual([`${(process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/models`]);
});

it('reads a record env value from the daemon environment', async () => {
  process.env.AHPD_PRESET_KEY = 'sk-from-daemon';
  const config = { env: { ANTHROPIC_AUTH_TOKEN: { fromEnv: 'AHPD_PRESET_KEY' } } };
  const env = (await queried(config)).env as Record<string, string | undefined>;
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-from-daemon');
  delete process.env.AHPD_PRESET_KEY;
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
  session.sendMessage('t1', 'hello');
  await settle();
  expect(session.models?.()).toEqual([{ id: 'stealth/space-bunny-alpha', name: 'Space Bunny' }]);
});

it("hands a record's own env to the CLI in a machine, and nothing of the daemon's", async () => {
  const env = await withDaemon({ T: 'sk-or', ANTHROPIC_API_KEY: 'sk-daemon', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-daemon' }, async () =>
    (await queriedInside({ env: { ANTHROPIC_BASE_URL: 'https://x', ANTHROPIC_AUTH_TOKEN: { fromEnv: 'T' } } })).env as Record<string, string>);
  // `CLAUDE_CODE_ENABLE_TASKS` is there because the host offers no `task_add`
  // here, so the session keeps Claude's own task tools and turns them on.
  expect(env).toEqual({ ANTHROPIC_BASE_URL: 'https://x', ANTHROPIC_AUTH_TOKEN: 'sk-or', CLAUDE_CONFIG_DIR: '/ahpd/claude', CLAUDE_CODE_ENABLE_TASKS: '1' });
});

it('hands a record no daemon key in a machine unless its env names one', async () => {
  await withDaemon({ ANTHROPIC_API_KEY: 'sk-daemon', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-daemon' }, async () => {
    expect((await queriedInside({})).env).toEqual({ CLAUDE_CONFIG_DIR: '/ahpd/claude', CLAUDE_CODE_ENABLE_TASKS: '1' });
    expect((await queriedInside({ env: { ANTHROPIC_API_KEY: { fromEnv: 'ANTHROPIC_API_KEY' } } })).env)
      .toEqual({ ANTHROPIC_API_KEY: 'sk-daemon', CLAUDE_CONFIG_DIR: '/ahpd/claude', CLAUDE_CODE_ENABLE_TASKS: '1' });
  });
});

it('lays a pushed credential over the record env in a machine, and leaves out an unset key', async () => {
  const env = await withDaemon({ ANTHROPIC_BASE_URL: 'https://daemon' }, async () =>
    (await queriedInside({ env: { ANTHROPIC_API_KEY: 'from-record', ANTHROPIC_BASE_URL: null } }, 'signed-in')).env);
  expect(env).toEqual({ ANTHROPIC_API_KEY: 'signed-in', CLAUDE_CONFIG_DIR: '/ahpd/claude', CLAUDE_CODE_ENABLE_TASKS: '1' });
});

it('keeps the daemon environment under a record env off a machine', async () => {
  const env = await withDaemon({ ANTHROPIC_API_KEY: 'sk-daemon' }, async () =>
    (await queried({ env: { ANTHROPIC_BASE_URL: 'https://x' } })).env as Record<string, string>);
  expect(env.ANTHROPIC_API_KEY).toBe('sk-daemon');
  expect(env.PATH).toBe(process.env.PATH);
});

it('gives two records on one machine only their own keys on their docker exec', async () => {
  const asked: Record<string, string>[] = [];
  const computers = {
    how: async (_id: string, options: { env?: Record<string, string> }) => {
      asked.push(options.env ?? {});
      return { command: 'true' };
    },
  };
  await withDaemon({ ANTHROPIC_API_KEY: 'sk-daemon' }, async () => {
    const engine = await engineOf();
    const agents = [
      engine.open(viewOf('claude', () => ({ env: { ANTHROPIC_API_KEY: { fromEnv: 'ANTHROPIC_API_KEY' } } }))),
      engine.open(viewOf('openrouter', () => ({ env: { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api', ANTHROPIC_AUTH_TOKEN: 'sk-or' } }))),
    ];
    for (const agent of agents) {
      sdk.options = [];
      startedNow(agent.create(startOf(agent.provider, {
        settings: { computer: 'computer://box' },
        computers: computers as never,
      }))).sendMessage('t1', 'hello');
      await settle();
      const options = sdk.options.at(0) as { spawnClaudeCodeProcess: (asked: unknown) => unknown; env: Record<string, string> };
      options.spawnClaudeCodeProcess({ command: 'claude', args: [], env: options.env });
      await settle();
    }
  });
  expect(asked).toEqual([
    { ANTHROPIC_API_KEY: 'sk-daemon', CLAUDE_CONFIG_DIR: '/ahpd/claude', CLAUDE_CODE_ENABLE_TASKS: '1' },
    { ANTHROPIC_BASE_URL: 'https://openrouter.ai/api', ANTHROPIC_AUTH_TOKEN: 'sk-or', CLAUDE_CONFIG_DIR: '/ahpd/openrouter', CLAUDE_CODE_ENABLE_TASKS: '1' },
  ]);
});
