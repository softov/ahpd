import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { optionsSchema } from '../src/plugin.js';
import { claudeExecutablePath } from '../src/claude.js';
import { resolveNeeds } from '../../sdk/src/machine.js';

/*
 * The plugin's options, held to the schema it exports.
 *
 * The loader checks them before `apply`, so a value of the wrong type is
 * reported with the plugin's name and the key, and the plugin is skipped
 * without running. The README's options table is what a person configures
 * from, so the schema declares what it lists.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-claude/src/index.ts';
const NAME = '@ahpd/agent-claude';

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
  ['workerStop', 'all'],
  ['computerCli', 'image'],
  ['computerCliFallback', 'skip'],
])('reports %s of the wrong type and skips the plugin', async (key, value) => {
  const { loaded, problems } = await load({ ...VALID, [key]: value });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toMatch(new RegExp(`^plugin ${NAME} skipped: plugins\\.${NAME}\\.options\\.${key} must be `, 'u'));
  expect(loaded).toEqual([]);
});

/** The agents one load registered, beside the echo the base always carries. */
const agentsOf = async (options: Record<string, unknown>) => {
  const { problems, options: served } = await load(options);
  expect(problems).toEqual([]);
  return (served.agents ?? []).slice(1);
};

/** What the first registered agent says a machine needs. */
const needsOf = async (options: Record<string, unknown>) => (await agentsOf(options))[0]?.machine?.() ?? {};

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

it('answers one part need for every variant of one load', async () => {
  const agents = await agentsOf({ computerCliFallback: 'host', presets: { router: {} } });
  const [built, router] = agents.map((one) => one.machine?.().claudePart);
  expect(router).toEqual(built);
});

/** The Claude state volume as every variant declares it, at its own directory. */
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

it('gives each variant the same state need at its own directory', async () => {
  const agents = await agentsOf({ presets: { router: {} } });
  const [built, router] = agents.map((one) => one.machine?.().claudeState);
  expect(built).toEqual(stateAt('/ahpd/claude'));
  expect(router).toEqual(stateAt('/ahpd/router'));
  // One directory named for both answers equal needs, field by field.
  const shared = await agentsOf({ computerConfigDir: '/ahpd/shared', presets: { router: {} } });
  expect(shared[0]?.machine?.().claudeState).toEqual(shared[1]?.machine?.().claudeState);
});

/*
 * What a session's plugins become in the CLI's own options.
 *
 * `Start.plugins` names directories this host copied a client's plugins into,
 * and the CLI loads them when it starts - so the shape it is handed is the
 * whole of what this backend does with them, and a session without any has to
 * be told nothing rather than given an empty list.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
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

/** The `query()` options one session was built with, given these plugins. */
const queriedWith = (plugins?: { path: string }[]): Record<string, unknown> => {
  cli.options = [];
  createSession({
    uri: 'ahp-session:/plugins',
    chatUri: 'ahp-chat:/plugins',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-plugins-')),
    emit: () => {},
    ...(plugins === undefined ? {} : { plugins }),
  });
  const one = cli.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

it('hands the CLI the session\'s plugins as local directories it need not search', () => {
  expect(queriedWith([{ path: '/copies/one' }, { path: '/copies/two' }])).toMatchObject({
    plugins: [
      { type: 'local', path: '/copies/one', skipMcpDiscovery: true },
      { type: 'local', path: '/copies/two', skipMcpDiscovery: true },
    ],
  });
});

it('passes no plugins to a session that has none', () => {
  expect(queriedWith()).not.toHaveProperty('plugins');
  expect(queriedWith([])).not.toHaveProperty('plugins');
});

/*
 * Which conversation the CLI is told its first query carries.
 *
 * A chat is a conversation of its own, so a peer chat names one of its own and
 * the session's id names the first chat alone. A resume names the conversation
 * to pick up already, so nothing of this is sent beside it.
 */

/** The `query()` options one session was built with, given these start fields. */
const startedWith = (start: Record<string, unknown>): Record<string, unknown> => {
  cli.options = [];
  createSession({
    uri: 'ahp-session:/plugins',
    chatUri: 'ahp-chat:/plugins',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-chatid-')),
    emit: () => {},
    ...start,
  });
  const one = cli.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

const SESSION = '11111111-2222-3333-4444-555555555555';
const CHAT = '99999999-8888-7777-6666-555555555555';

it('names the conversation after the chat, and after the session when the chat names none', () => {
  expect(startedWith({ uri: `ahp-session:/${SESSION}` })).toMatchObject({ sessionId: SESSION });
  expect(startedWith({ uri: `ahp-session:/${SESSION}`, chatId: CHAT })).toMatchObject({ sessionId: CHAT });
});

it('sends no sessionId when the conversation is resumed by name', () => {
  expect(startedWith({ uri: `ahp-session:/${SESSION}`, chatId: CHAT, resume: SESSION })).not.toHaveProperty('sessionId');
});
