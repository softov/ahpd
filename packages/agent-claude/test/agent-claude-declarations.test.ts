import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { env, extraArgs, optionDefaults, outputStyle, sandbox, thinking } from '../src/options.js';
import { startedNow } from '../../sdk/test/support/started.js';
import { bag } from '@ahpd/sdk';
import type { Engine, AgentView, Bag, Start } from '@ahpd/sdk';

/*
 * Each Claude option, declared once.
 *
 * A declaration is what a value may be and where it goes, and both the engine schema a record is drawn from and the options a session's `query()` is built from are made of them. So the cases here are the two questions a declaration answers - does this value hold, and what does it become - and a record's values going through them into a session, which is the half that only holds if `session.ts` asks.
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
  for (let i = 0; i < times; i++) await new Promise((done) => { setImmediate(done); });
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
  expect(optionDefaults()).toEqual({
    thinking: 'adaptive', hostTasks: true, hostTools: true, enableTasks: true, cliStart: 'open', stopEnds: 'turn', dontAsk: true, portFailures: 'spawn', subagentsFrom: 'meta',
    taskOutputFirstWaitMs: 500, taskOutputLongestWaitMs: 10_000, taskOutputQuietReads: 2, subagentTitleMax: 60, subagentStartTimeoutMs: 30_000,
    maxShellInitScript: 64 * 1024, maxTerminalOutputBytes: 10 * 1024 * 1024, keepFramed: 64, watchWaitMs: 300, fileMostBytes: 64 * 1024,
    ruleDepth: 32, ruleMost: 1000,
  });
});

/*
 * The Approvals control offers the SDK's `dontAsk` beside VS Code's five, and
 * a record whose `dontAsk` is off offers VS Code's five alone.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2273-L2309
 */
it('offers VS Code\'s five approval modes when the record turns dontAsk off', async () => {
  const engine = await engineOf();
  const modesOf = (held: Bag): unknown => ((engine.open(viewOf('claude', () => held)).schema() as Bag).properties as Bag)
    .permissionMode as Bag;
  expect((modesOf({}) as Bag).enum).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk']);
  expect(modesOf({ dontAsk: false })).toMatchObject({
    enum: ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'],
    enumLabels: ['Ask Before Edits', 'Edit Automatically', 'Plan Mode', 'Auto Mode', 'Bypass Permissions'],
  });
});

/*
 * A permission mode the record does not offer is refused in VS Code's sentence
 * for a value not offered.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L144-L147
 */
it('refuses a permission mode the record does not offer in VS Code\'s sentence', async () => {
  const engine = await engineOf();
  const session = startedNow(engine.open(viewOf('claude', () => ({ dontAsk: false }))).create({
    uri: 'ahp-session:/declared',
    chatUri: 'ahp-chat:/declared',
    settings: {},
    clientToolTimeoutMs: 60_000,
    schema: () => ({ type: 'object', properties: {} }),
    emit: () => {},
    workingDirectory: mkdtempSync(join(tmpdir(), 'ahpd-declared-')),
  }));
  expect(await session.setConfig?.('permissionMode', 'dontAsk')).toBe('Session configuration \'permissionMode\' does not offer \'dontAsk\'.');
  expect(await session.setConfig?.('permissionMode', 'plan')).toBe(true);
  await session.close();
});

/*
 * The operator's bypass lock takes away the modes VS Code's window locks for
 * Claude under its auto-approval restriction, which VS Code sets from that
 * lock, and a session holding one runs Ask Before Edits, as VS Code's Copilot
 * runs a mode its policy withholds.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/providers/agentHost/browser/agentHostSessionPermissions.ts#L65-L94
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotApprovalPolicy.ts#L165-L166
 */
it('offers the modes VS Code leaves open under the operator\'s bypass lock, and runs a withheld one as Ask Before Edits', async () => {
  sdk.options = [];
  const engine = await engineOf();
  const agent = engine.open(viewOf('claude', () => ({})));
  const session = startedNow(agent.create({
    uri: 'ahp-session:/declared',
    chatUri: 'ahp-chat:/declared',
    settings: { permissionMode: 'bypassPermissions' },
    clientToolTimeoutMs: 60_000,
    schema: () => agent.schema(),
    emit: () => {},
    workingDirectory: mkdtempSync(join(tmpdir(), 'ahpd-declared-')),
    managedSettings: { permissions: { disableBypassPermissionsMode: 'disable' } },
  }));
  const config = bag(session.sessionState().config);
  expect(bag(bag(config.schema).properties).permissionMode).toMatchObject({
    enum: ['default', 'plan', 'dontAsk'],
    enumLabels: ['Ask Before Edits', 'Plan Mode', 'Don\'t Ask'],
  });
  expect(bag(config.values).permissionMode).toBe('default');
  expect(await session.setConfig?.('permissionMode', 'bypassPermissions'))
    .toBe('Session configuration \'permissionMode\' does not offer \'bypassPermissions\'.');
  session.sendMessage('t1', 'hello');
  await settle();
  expect(sdk.options.at(0)?.permissionMode).toBe('default');
  await session.close();
});

/*
 * A tool's name the operator's eligibility sets `false` takes the same lock,
 * VS Code's fallback for a tool no rule family names, and the same modes go.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L31-L40
 */
it('takes the same modes away for a tool\'s name the operator\'s eligibility sets false', async () => {
  sdk.options = [];
  const engine = await engineOf();
  const agent = engine.open(viewOf('claude', () => ({})));
  const session = startedNow(agent.create({
    uri: 'ahp-session:/declared',
    chatUri: 'ahp-chat:/declared',
    settings: { permissionMode: 'acceptEdits' },
    clientToolTimeoutMs: 60_000,
    schema: () => agent.schema(),
    emit: () => {},
    workingDirectory: mkdtempSync(join(tmpdir(), 'ahpd-declared-')),
    managedSettings: { eligibleForAutoApproval: { runInTerminal: false } },
  }));
  const config = bag(session.sessionState().config);
  expect(bag(bag(config.schema).properties).permissionMode).toMatchObject({ enum: ['default', 'plan', 'dontAsk'] });
  expect(bag(config.values).permissionMode).toBe('default');
  session.sendMessage('t1', 'hello');
  await settle();
  expect(sdk.options.at(0)?.permissionMode).toBe('default');
  expect(bag(bag(sdk.options.at(0)?.managedSettings).permissions).disableBypassPermissionsMode).toBe('disable');
  await session.close();
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
