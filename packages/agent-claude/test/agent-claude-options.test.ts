import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import manifest from '../package.json' with { type: 'json' };
import { claudeExecutablePath } from '../src/claude.js';
import { resolveNeeds } from '../../sdk/src/machines/machine.js';
import type { Engine, AgentView, Bag } from '@ahpd/sdk';

/*
 * The plugin's options, held to the schema its manifest declares.
 *
 * The loader checks them before `apply`, so a value of the wrong type is
 * reported with the plugin's name and the key, and the plugin is skipped
 * without running. The README's options table is what a person configures
 * from, so the schema declares what it lists.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-claude/src/index.ts';
const NAME = 'agent-claude';
const optionsSchema = manifest.ahpd.optionsSchema;

/** Options that pass, which each case spoils one key of. */
const VALID: Record<string, unknown> = {};

/** The option names the schema declares. */
const declared = (): string[] => Object.keys((optionsSchema as { properties: Record<string, unknown> }).properties);

/** The option names the first options table in the README lists. */
const documented = (): string[] => {
  const lines = readFileSync(join(import.meta.dirname, '../README.md'), 'utf8').split('\n');
  const start = lines.findIndex((line) => /^\| option \|/iu.test(line));
  const names: string[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const found = /^\| `([^`]+)` \|/u.exec(line);
    if (found?.[1] !== undefined) names.push(found[1]);
  }
  return names;
};

const load = (options: Record<string, unknown>) => loadPlugins([{ name: SOURCE, options }], {
  base: { path: '/tmp/agent-claude-options', agents: [echo({ path: '/tmp/agent-claude-options' })] },
  configDir: REPO,
  cwd: REPO,
  log: () => {},
});

it('declares every option its README lists, and no other', () => {
  expect(declared().sort()).toEqual(documented().sort());
});

it.each<[string, unknown]>([
  ['paths', 'x'],
  ['computerExecutable', 5],
  ['computerConfigDir', true],
  ['computerCli', 'image'],
  ['computerCliFallback', 'skip'],
])('reports %s of the wrong type and skips the plugin', async (key, value) => {
  const { loaded, problems } = await load({ ...VALID, [key]: value });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(new RegExp(`^plugin ${NAME} skipped: plugins\\.${NAME}\\.options\\.${key} must be `, 'u'));
  expect(loaded).toEqual([]);
});

/** The `claude` engine one load registered. */
const engineOf = async (options: Record<string, unknown> = {}): Promise<Engine> => {
  const { problems, options: served } = await load(options);
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

/** What the first record opened by one load says a machine needs. */
const needsOf = async (options: Record<string, unknown> = {}) =>
  (await engineOf(options)).open(viewOf('claude', () => ({}))).machine?.() ?? {};

/** The host binary mount, as a machine that runs the host's own CLI gets it. */
const HOST_BINARY = {
  file: claudeExecutablePath(),
  target: '/usr/local/bin/claude',
  readOnly: true,
  required: true,
  description: 'The Claude Code CLI, as this host has it installed.',
};

it('runs the CLI from its part by default, with no host binary and no fallback', async () => {
  const needs = await needsOf({});
  expect(needs.claudePart).toEqual({ part: 'claude', required: true, description: 'The Claude Code CLI, built by this host at its pinned version.' });
  expect(needs.claudeExecutable).toBeUndefined();
});

it('mounts the host binary in place of the part with computerCli host', async () => {
  const needs = await needsOf({ computerCli: 'host' });
  expect(needs.claudeExecutable).toEqual(HOST_BINARY);
  expect(needs.claudePart).toBeUndefined();
});

it('carries the host binary as the part need\'s fallback with computerCliFallback host', async () => {
  expect((await needsOf({ computerCliFallback: 'host' })).claudePart).toMatchObject({ part: 'claude', fallback: HOST_BINARY });
  expect((await needsOf({ computerCliFallback: 'refuse' })).claudePart).not.toHaveProperty('fallback');
  // Read only for the part route.
  expect((await needsOf({ computerCli: 'host', computerCliFallback: 'host' })).claudePart).toBeUndefined();
});

it('mounts only the CLI with computerConfigDir false', async () => {
  expect(Object.keys(await needsOf({ computerConfigDir: false }))).toEqual(['claudePart']);
  expect(Object.keys(await needsOf({ computerConfigDir: false, computerCli: 'host' }))).toEqual(['claudeExecutable']);
});

it('answers one part need for every record of one load', async () => {
  const engine = await engineOf({ computerCliFallback: 'host' });
  const [built, router] = [engine.open(viewOf('claude', () => ({}))), engine.open(viewOf('router', () => ({})))]
    .map((one) => one.machine?.().claudePart);
  expect(router).toEqual(built);
});

/** The Claude state volume as every record declares it, at its own directory. */
const stateAt = (dir: string) => ({
  state: dir,
  seed: [
    { source: '~/.claude/settings.json' },
    { source: '~/.claude/CLAUDE.md' },
    { source: '~/.claude/skills' },
    { source: '~/.claude/agents' },
    { source: '~/.claude/commands' },
    { source: '~/.claude.json', target: '.claude.json', keep: ['mcpServers'] },
  ],
  description: 'The Claude Code configuration, kept in a volume and seeded from this host without its sign-in.',
});

it('keeps its configuration in a state volume, and mounts the host home only for state host', async () => {
  const needs = await needsOf({});
  expect(needs.claudeState).toEqual(stateAt('/ahpd/claude'));
  expect(needs.claudeConfigDirectory).toMatchObject({ directory: '~/.claude', target: '/ahpd/claude', when: 'host' });
  expect(needs.claudeConfigJson).toMatchObject({ file: '~/.claude.json', target: '/ahpd/claude/.claude.json', when: 'host' });
  // No secret is a machine need, and no seed is a login file.
  expect(Object.values(needs).filter((one) => 'name' in one)).toEqual([]);
  expect(JSON.stringify(needs.claudeState)).not.toContain('.credentials.json');
});

it('resolves to the state volume alone in mode volume, and to the host mounts in mode host', async () => {
  const needs = await needsOf({});
  const home = mkdtempSync(join(tmpdir(), 'ahpd-claude-home-'));
  mkdirSync(join(home, '.claude'));
  writeFileSync(join(home, '.claude.json'), '{}');
  const kinds = (mode: 'volume' | 'host') => resolveNeeds(needs, {}, home, mode).map((one) => [one.name, one.kind]);
  expect(kinds('volume')).toEqual([['claudeState', 'state'], ['claudePart', 'part']]);
  expect(kinds('host')).toEqual([['claudeConfigDirectory', 'directory'], ['claudeConfigJson', 'file'], ['claudePart', 'part']]);
});

it('gives each record the same state need at its own directory', async () => {
  const engine = await engineOf();
  const [built, router] = [engine.open(viewOf('claude', () => ({}))), engine.open(viewOf('router', () => ({})))]
    .map((one) => one.machine?.().claudeState);
  expect(built).toEqual(stateAt('/ahpd/claude'));
  expect(router).toEqual(stateAt('/ahpd/router'));
  // One directory named for both answers equal needs, field by field.
  const shared = await engineOf({ computerConfigDir: '/ahpd/shared' });
  const pair = [shared.open(viewOf('claude', () => ({}))), shared.open(viewOf('router', () => ({})))];
  expect(pair[0]?.machine?.().claudeState).toEqual(pair[1]?.machine?.().claudeState);
});

/*
 * What a session's plugins become in the CLI's own options.
 *
 * `Start.plugins` names directories this host copied a client's plugins into,
 * and the CLI loads them when it starts - so the shape it is handed is the
 * whole of what this backend does with them, and a session without any has to
 * be told nothing rather than given an empty list.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  // The SDK's read of one session: a conversation a case resumes by name is one it holds.
  getSessionInfo: async (id: string) => ({ sessionId: id }),
  query: ({ options }: { options: Record<string, unknown> }) => {
    cli.options.push(options);
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

const cli = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

const { createSession } = await import('../src/session.js');

/** The turns a CLI's start takes, waited out. */
const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** The `query()` options one session's first send started its CLI with, given these plugins. */
const queriedWith = async (plugins?: { path: string }[]): Promise<Record<string, unknown>> => {
  cli.options = [];
  createSession({
    uri: 'ahp-session:/plugins',
    chatUri: 'ahp-chat:/plugins',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-plugins-')),
    emit: () => {},
    ...(plugins === undefined ? {} : { plugins }),
  }).sendMessage('t1', 'hello');
  await settle();
  const one = cli.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

it('hands the CLI the session\'s plugins as local directories it need not search', async () => {
  expect(await queriedWith([{ path: '/copies/one' }, { path: '/copies/two' }])).toMatchObject({
    plugins: [
      { type: 'local', path: '/copies/one', skipMcpDiscovery: true },
      { type: 'local', path: '/copies/two', skipMcpDiscovery: true },
    ],
  });
});

it('passes no plugins to a session that has none', async () => {
  expect(await queriedWith()).not.toHaveProperty('plugins');
  expect(await queriedWith([])).not.toHaveProperty('plugins');
});

/*
 * Which conversation the CLI is told its first query carries.
 *
 * A chat is a conversation of its own, so a peer chat names one of its own and
 * the session's id names the first chat alone. A resume names the conversation
 * to pick up already, so nothing of this is sent beside it.
 */

/** The `query()` options one session's first send started its CLI with, given these start fields. */
const startedWith = async (start: Record<string, unknown>): Promise<Record<string, unknown>> => {
  cli.options = [];
  createSession({
    uri: 'ahp-session:/plugins',
    chatUri: 'ahp-chat:/plugins',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-chatid-')),
    emit: () => {},
    ...start,
  }).sendMessage('t1', 'hello');
  await settle();
  const one = cli.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

const SESSION = '11111111-2222-3333-4444-555555555555';
const CHAT = '99999999-8888-7777-6666-555555555555';

it('names the conversation after the chat, and after the session when the chat names none', async () => {
  expect(await startedWith({ uri: `ahp-session:/${SESSION}` })).toMatchObject({ sessionId: SESSION });
  expect(await startedWith({ uri: `ahp-session:/${SESSION}`, chatId: CHAT })).toMatchObject({ sessionId: CHAT });
});

it('sends no sessionId when the conversation is resumed by name', async () => {
  expect(await startedWith({ uri: `ahp-session:/${SESSION}`, chatId: CHAT, resume: SESSION })).not.toHaveProperty('sessionId');
});

/*
 * What the operator's environment becomes for the session's shells.
 *
 * `Start.shellEnv` is the daemon's, resolved before the session is built, and
 * it is handed to the CLI as VS Code's Claude hands its own environment: a
 * name set in the CLI's `settings.env`, which the CLI layers onto the commands
 * it runs, a name removed out of the environment the CLI is spawned with. A
 * client's shell init script in force goes in the same `settings.env`, as the
 * CLI's session environment file, which it runs before each Bash command. A
 * command runs as the model wrote it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkOptions.ts#L129-L150
 * https://code.claude.com/docs/en/hooks#persist-environment-variables
 */

/** One hook input, as the CLI sends it. */
interface HookInput { hook_event_name: string; tool_name: string; tool_input: Record<string, unknown>; tool_use_id: string }

/** The `PreToolUse` hooks a query names, each with the tool it is for. */
type PreToolUse = { matcher?: string; hooks: ((input: HookInput) => Promise<unknown>)[] }[];

/** The query options a session built with `start` handed the SDK, once its first send started a CLI. */
const builtWith = async (start: Record<string, unknown>): Promise<{
  settings?: { env?: Record<string, string> };
  env?: Record<string, string | undefined>;
  hooks?: { PreToolUse?: PreToolUse };
}> => {
  cli.options = [];
  createSession({
    uri: 'ahp-session:/shellenv',
    chatUri: 'ahp-chat:/shellenv',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-shellenv-')),
    emit: () => {},
    ...start,
  }).sendMessage('t1', 'hello');
  await settle();
  const one = cli.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

/** What the `PreToolUse` hooks a Bash call reaches put in place of `command`, or nothing when none puts anything. */
const commandedWith = async (start: Record<string, unknown>, command: string): Promise<unknown> => {
  const rewritten: unknown[] = [];
  for (const entry of (await builtWith(start)).hooks?.PreToolUse ?? []) {
    if (entry.matcher !== undefined && entry.matcher !== 'Bash') continue;
    for (const hook of entry.hooks) {
      const answer = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: 'toolu_shell' }) as
        { hookSpecificOutput?: { updatedInput?: { command?: unknown } } } | undefined;
      if (answer?.hookSpecificOutput?.updatedInput?.command !== undefined) rewritten.push(answer.hookSpecificOutput.updatedInput.command);
    }
  }
  return rewritten.at(-1);
};

/** A client's bash script, as the window sends it. */
const SCRIPT = { shellInitScripts: [{ shell: 'bash', script: 'echo init' }] };

it('hands a variable the operator set to the CLI as settings.env, and leaves the command as written', async () => {
  const start = { shellEnv: { XDG_CONFIG_HOME: '/home/me/.config' } };
  expect((await builtWith(start)).settings?.env).toEqual({ XDG_CONFIG_HOME: '/home/me/.config' });
  expect(await commandedWith(start, 'echo $XDG_CONFIG_HOME')).toBeUndefined();
});

it('spawns the CLI without a variable the operator removed', async () => {
  process.env.AHPD_OPERATOR_REMOVED = 'from the daemon';
  try {
    const env = (await builtWith({ shellEnv: { AHPD_OPERATOR_REMOVED: null } })).env;
    expect(env?.AHPD_OPERATOR_REMOVED).toBeUndefined();
    // Over the daemon's own environment, the one name taken out.
    expect(env?.PATH).toBe(process.env.PATH);
  }
  finally { delete process.env.AHPD_OPERATOR_REMOVED; }
});

it('hands a value with a quote in it as it is', async () => {
  expect((await builtWith({ shellEnv: { SAY: "it's" } })).settings?.env).toEqual({ SAY: "it's" });
});

it('leaves every command as the model wrote it, a client\'s script in force or not', async () => {
  expect(await commandedWith({}, 'echo hi')).toBeUndefined();
  expect(await commandedWith({ shellEnv: { SAY: 'b' } }, 'echo hi')).toBeUndefined();
  expect(await commandedWith({ settings: SCRIPT }, 'echo hi')).toBeUndefined();
});

it('hands the CLI the session\'s own init script as its session environment file, beside the operator\'s environment', async () => {
  const env = (await builtWith({ shellEnv: { SAY: 'b' }, settings: SCRIPT })).settings?.env;
  expect(env).toEqual({ SAY: 'b', CLAUDE_ENV_FILE: expect.stringMatching(/ahpd-shell-init-[^/]*\.sh$/u) });
  expect(readFileSync(String(env?.CLAUDE_ENV_FILE), 'utf8')).toBe('echo init');
});

it('hands a CLI in a machine no session environment file, the script being this host\'s', async () => {
  const inMachine = { settings: SCRIPT, spawn: () => { throw new Error('nothing is spawned here'); } };
  expect((await builtWith(inMachine)).settings?.env?.CLAUDE_ENV_FILE).toBeUndefined();
  // And its commands run as the model wrote them.
  expect(await commandedWith(inMachine, 'echo hi')).toBeUndefined();
});
