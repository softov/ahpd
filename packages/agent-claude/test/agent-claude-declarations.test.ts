import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { env, extraArgs, optionDefaults, outputStyle, sandbox, thinking } from '../src/options.js';
import { startedNow } from '../../sdk/test/support/started.js';
import type { Engine, AgentView, Bag, Start } from '@ahpd/sdk';

/*
 * Each Claude option, declared once.
 *
 * A declaration is what a value may be and where it goes, and both the engine schema a record is drawn from and the options a session's `query()` is built from are made of them. So the cases here are the two questions a declaration answers - does this value hold, and what does it become - and a record's values going through them into a session, which is the half that only holds if `session.ts` asks.
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
      applyFlagSettings: async (flags: Record<string, unknown>) => { sdk.flags.push(flags); },
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

const sdk = vi.hoisted(() => ({ options: [] as Record<string, unknown>[], flags: [] as Record<string, unknown>[] }));

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-claude/src/index.ts';

/** The `claude` engine one load registered. */
const engineOf = async (): Promise<Engine> => {
  const { problems, options: served } = await loadPlugins([{ name: SOURCE, options: {} }], {
    base: { path: '/tmp/ahpd-declared', agents: [echo({ path: '/tmp/ahpd-declared' })] },
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

/** The `query()` options one session's first send started its CLI with, on a record holding the given values. */
const queried = async (
  config: Bag,
  settings?: Record<string, unknown>,
  extra: Partial<Start> = {},
): Promise<Record<string, unknown>> => {
  sdk.options = [];
  sdk.flags = [];
  const engine = await engineOf();
  startedNow(engine.open(viewOf('claude', () => config)).create({
    uri: 'ahp-session:/declared',
    chatUri: 'ahp-chat:/declared',
    settings: settings ?? {},
    clientToolTimeoutMs: 60_000,
    schema: () => ({ type: 'object', properties: {} }),
    emit: () => {},
    workingDirectory: mkdtempSync(join(tmpdir(), 'ahpd-declared-')),
    ...extra,
  })).sendMessage('t1', 'hello');
  await settle();
  const one = sdk.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

it('turns a sandbox value into the flag settings layer, and default into nothing', () => {
  expect(sandbox.toQuery?.('on')).toEqual({ settings: { sandbox: { enabled: true } } });
  expect(sandbox.toQuery?.('off')).toEqual({ settings: { sandbox: { enabled: false } } });
  expect(sandbox.toQuery?.('default')).toEqual({});
});

it('turns a thinking value into the query option the SDK takes', () => {
  expect(thinking.toQuery?.('adaptive')).toEqual({ thinking: { type: 'adaptive' } });
  expect(thinking.toQuery?.('disabled')).toEqual({ thinking: { type: 'disabled' } });
  expect(thinking.toQuery?.('sideways')).toEqual({});
});

it('lays env over the daemon own, and adds the extra CLI arguments as they were written', () => {
  expect(env.toQuery?.({ ANTHROPIC_MODEL: 'claude-opus-5' })).toEqual({ env: { ...process.env, ANTHROPIC_MODEL: 'claude-opus-5' } });
  expect(env.toQuery?.({})).toEqual({});
  expect(extraArgs.toQuery?.({ 'permission-prompt-tool': null, 'settings': '{"a":1}' }))
    .toEqual({ extraArgs: { 'permission-prompt-tool': null, settings: '{"a":1}' } });
});

it('leaves the output style to the flag settings, which the CLI takes live', () => {
  expect(outputStyle.toFlags?.('concise')).toEqual({ outputStyle: 'concise' });
  expect(outputStyle.toFlags?.('')).toEqual({});
  // Nowhere in the options the query is built from: the CLI reads it live.
  expect(outputStyle.toQuery).toBeUndefined();
});

it('says what an option is when nothing named one', () => {
  expect(optionDefaults()).toEqual({ thinking: 'adaptive', hostTasks: true, enableTasks: true });
});

it('builds a session query from the declared values of its record', async () => {
  const options = await queried({ sandbox: 'on', thinking: 'disabled', outputStyle: 'concise' });
  expect(options.settings).toEqual({ sandbox: { enabled: true } });
  expect(options.thinking).toEqual({ type: 'disabled' });
  // The style is not an option of the query; it waits for the handshake.
  await settle();
  expect(sdk.flags).toContainEqual({ outputStyle: 'concise' });
});

it('leaves the sandbox layer out when nobody asked for one', async () => {
  expect((await queried({ sandbox: 'default' })).settings).toBeUndefined();
});

it('names a switched-off plugin server in the CLI\'s own settings', async () => {
  const options = await queried({ sandbox: 'on' }, undefined, { deniedMcpServers: ['one', 'two words'] });
  // A plugin is a directory the CLI opens itself, so a server the host left
  // out of `mcpServers` can still be found there. The list is one the CLI
  // reads from its settings, and what a record put in them is added to rather
  // than replaced.
  expect(options.settings).toEqual({
    sandbox: { enabled: true },
    deniedMcpServers: [{ serverName: 'one' }, { serverName: 'two words' }],
  });
});

it('adds no settings of its own when nothing was switched off', async () => {
  expect((await queried({ sandbox: 'default' }, undefined, { deniedMcpServers: [] })).settings).toBeUndefined();
});

it('a record with sandbox off wins over a stored on', async () => {
  /*
   * `sandboxEnabled` is the control a session had before the schema stopped
   * declaring it, and a store still holds an `on` from it. That value was
   * spread over the record's, so `off` was the one word a record could not
   * say: a record built to run unsandboxed ran sandboxed on any session
   * somebody had once turned the sandbox on for.
   */
  expect((await queried({ sandbox: 'off' }, { sandboxEnabled: 'on' })).settings)
    .toEqual({ sandbox: { enabled: false } });
});

it('a record with no sandbox keeps a stored on', async () => {
  // The other half of that: an upgrade never runs a session less sandboxed
  // than it was, so a stored on still turns it on where the record is silent.
  expect((await queried({ thinking: 'disabled' }, { sandboxEnabled: 'on' })).settings)
    .toEqual({ sandbox: { enabled: true } });
});
