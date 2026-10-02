import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { claude } from '../src/claude.js';

/*
 * Presets, and the `preset` key a session is created on.
 *
 * A preset is a named set of Claude options an operator writes once, and a
 * session runs on one of them. The cases here are the three shapes that takes:
 * no preset, where nothing is offered and a session runs as it always did;
 * one preset, where there is nothing to choose and the session runs on it
 * anyway; and two or more, where `preset` is a key, defaults to the first and
 * is what tells one session from another. A stored name nobody can resolve is
 * the last case, because that is what removing a preset leaves behind.
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

/** One session's `query()` options, created with a preset name in its config. */
const queried = async (presets: Record<string, Record<string, unknown>> | undefined, preset: unknown, env?: Record<string, string>): Promise<Record<string, unknown>> => {
  sdk.options = [];
  createSession({
    uri: 'ahp-session:/preset',
    chatUri: 'ahp-chat:/preset',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-preset-')),
    emit: () => {},
    settings: preset === undefined ? {} : { preset },
    ...(presets === undefined ? {} : { presets }),
    ...(env === undefined ? {} : { env }),
  });
  await settle();
  const one = sdk.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

/** What a backend offers a client, by key. */
const offered = (presets?: Record<string, Record<string, unknown>>) => {
  const agent = claude({ paths: ['/tmp/ahpd-preset'], ...(presets === undefined ? {} : { presets }) });
  return agent.schema().properties as Record<string, Record<string, unknown>>;
};

/** The plugin's own load, which is where a preset is checked. */
const load = (options: Record<string, unknown>) => loadPlugins([{ name: SOURCE, options }], {
  base: { path: '/tmp/ahpd-preset', agents: [echo({ path: '/tmp/ahpd-preset' })] },
  configDir: REPO,
  cwd: REPO,
  log: () => {},
});

it('offers no preset key with none configured, and runs on what it ran on', async () => {
  expect(offered()).not.toHaveProperty('preset');
  // Today's options: the sandbox layer absent, thinking on, nothing else.
  const options = await queried(undefined, undefined);
  expect(options.settings).toBeUndefined();
  expect(options.thinking).toEqual({ type: 'adaptive' });
});

it('offers no preset key with one configured, and runs on it', async () => {
  expect(offered({ work: { thinking: 'disabled' } })).not.toHaveProperty('preset');
  expect((await queried({ work: { thinking: 'disabled' } }, undefined)).thinking).toEqual({ type: 'disabled' });
});

it('offers the preset names from two, and defaults to the first', () => {
  const keys = offered({ work: {}, test: { thinking: 'disabled' } });
  expect(keys.preset?.enum).toEqual(['work', 'test']);
  expect(keys.preset?.default).toBe('work');
  // Fixed when the session is created, so a client cannot draw a live control
  // for a value the query was already built with.
  expect(keys.preset?.sessionMutable).toBe(false);
});

it('runs each session on its own preset', async () => {
  const presets = { work: {}, test: { thinking: 'disabled', sandbox: 'on' } };
  expect((await queried(presets, 'test')).thinking).toEqual({ type: 'disabled' });
  expect((await queried(presets, 'test')).settings).toEqual({ sandbox: { enabled: true } });
  const work = await queried(presets, 'work');
  expect(work.thinking).toEqual({ type: 'adaptive' });
  expect(work.settings).toBeUndefined();
});

it('resolves a stored name that no longer exists to the first preset', async () => {
  // What removing `test` and restarting leaves in the store: the name, and
  // nothing of the values it used to mean.
  const options = await queried({ work: { thinking: 'disabled' } }, 'test');
  expect(options.thinking).toEqual({ type: 'disabled' });
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

it('takes a preset whose fields are all declared', async () => {
  const { loaded, problems } = await load({
    presets: { work: { sandbox: 'on', thinking: 'adaptive', outputStyle: 'concise', env: { ANTHROPIC_MODEL: 'claude-opus-5' }, extraArgs: { 'debug': null } } },
  });
  expect(problems).toEqual([]);
  expect(loaded.map((one) => one.name)).toEqual([NAME]);
});
it('lays a signed-in credential over a preset env, and lets a preset unset a variable', async () => {
  process.env.AHPD_PRESET_PROBE = 'daemon';
  const presets = { work: { env: { ANTHROPIC_API_KEY: 'from-preset', ANTHROPIC_BASE_URL: 'https://gateway', AHPD_PRESET_PROBE: null } } };
  const env = (await queried(presets, 'work', { ANTHROPIC_API_KEY: 'signed-in' })).env as Record<string, string | undefined>;
  delete process.env.AHPD_PRESET_PROBE;
  expect(env.ANTHROPIC_API_KEY).toBe('signed-in');
  expect(env.ANTHROPIC_BASE_URL).toBe('https://gateway');
  expect('AHPD_PRESET_PROBE' in env).toBe(false);
  expect(env.PATH).toBe(process.env.PATH);
});
