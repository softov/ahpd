import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { parseYaml } from '@cofold/yaml';
import { uriOf } from '@ahpd/sdk';
import type { Bag } from '@ahpd/sdk';

/*
 * A Claude session before its first send, which starts its CLI.
 *
 * VS Code's Claude agent makes a session with no SDK contact and materializes
 * it on its first send; until then its lists are the agent's own and what the
 * disk scan finds, and a switch made meanwhile is the first CLI's to take.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1543-L1556
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1499-L1533
 */

const sdk = vi.hoisted(() => ({
  /** The options of each query built, in order. */
  built: [] as Record<string, unknown>[],
  closed: 0,
  /** Whether a CLI answers what it has. */
  answers: true,
  /** The account a CLI reports: one signed in to claude.ai, by its subscription. */
  account: { email: 'softov@brbyte.com', subscriptionType: 'Claude Max', apiProvider: 'firstParty' } as Record<string, unknown>,
  /** What a CLI reports of its servers. */
  servers: [] as Record<string, unknown>[],
  /** What each CLI was asked, in order, and when it read its first prompt. */
  calls: [] as string[],
  reset() {
    sdk.built = [];
    sdk.closed = 0;
    sdk.answers = true;
    sdk.account = { email: 'softov@brbyte.com', subscriptionType: 'Claude Max', apiProvider: 'firstParty' };
    sdk.servers = [];
    sdk.calls = [];
  },
}));

const watched = vi.hoisted(() => ({ changes: [] as (() => void)[] }));

vi.mock('../src/session/watch.js', () => ({
  createClaudeCustomizationWatcher: (_roots: unknown, onChange: () => void) => {
    watched.changes.push(onChange);
    return () => {};
  },
}));

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    sdk.built.push(options);
    let closed = false;
    let wake: (() => void) | undefined;
    return {
      async *[Symbol.asyncIterator]() {
        void prompt[Symbol.asyncIterator]().next().then(() => { sdk.calls.push('prompt'); });
        while (!closed) await new Promise<void>((done) => { wake = done; });
      },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async (name: string, enabled: boolean) => { sdk.calls.push(`toggle ${name} ${enabled}`); },
      reconnectMcpServer: async (name: string) => { sdk.calls.push(`reconnect ${name}`); },
      setMcpServers: async () => {},
      initializationResult: () => (sdk.answers
        ? Promise.resolve({ account: sdk.account, models: [{ value: 'sonnet', displayName: 'Sonnet' }], commands: [], agents: [] })
        : Promise.reject(new Error('the CLI did not answer'))),
      mcpServerStatus: async () => sdk.servers,
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => {
        closed = true;
        sdk.closed += 1;
        wake?.();
      },
    };
  },
}));

const { createSession } = await import('../src/session.js');

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setImmediate(r); });
};

const SESSION = '11111111-2222-3333-4444-555555555555';

/** The plugin the agent's own lists hold, id'd by its root's URI. */
const HELPER = uriOf('/plugins/helper');

/** The agent's own lists, as the host seeds a session with them, each named by its uri. */
const SEEDS: Bag[] = [
  { type: 'plugin', id: HELPER, uri: HELPER, name: 'helper@market', children: [] },
  {
    type: 'directory', id: 'agent-builtin:/skills', uri: 'agent-builtin:/skills', name: 'builtin', writable: false, contents: 'skill', enabled: true,
    children: [{ type: 'skill', id: 'agent-builtin:/skill/compact', name: 'compact', uri: 'agent-builtin:/skill/compact', enabled: true }],
  },
  { type: 'mcpServer', id: 'claude-internal:/mcp/seeded#mcp=seeded', name: 'seeded', uri: 'claude-internal:/mcp/seeded', enablement: [{ kind: 'session', enabled: true }], state: { kind: 'ready' } },
];
const MODELS = [{ id: 'opus', name: 'Opus' }];

/** A working directory with a project skill and a server its `.mcp.json` declares. */
const project = (): string => {
  const cwd = mkdtempSync(join(tmpdir(), 'ahpd-first-send-'));
  mkdirSync(join(cwd, '.claude', 'skills', 'review'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'skills', 'review', 'SKILL.md'), '---\nname: review\ndescription: Reviews a change\n---\n');
  writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { docs: { command: 'docs-server' } } }));
  return cwd;
};

const open = (extra: Record<string, unknown> = {}): { session: ReturnType<typeof createSession>; said: Bag[]; cwd: string } => {
  const said: Bag[] = [];
  const cwd = project();
  const session = createSession({
    uri: `ahp-session:/${SESSION}`,
    chatUri: 'ahp-chat:/first-send',
    cwd,
    emit: (_channel: string, action: Bag) => { said.push(action); },
    seedCustomizations: SEEDS,
    seedModels: MODELS,
    // The YAML the host hands a plugin, which a frontmatter is read with.
    parseYaml,
    // The record that starts its CLI at the first send, as VS Code does.
    preset: { cliStart: 'send' },
    ...extra,
  } as never);
  return { session, said, cwd };
};

const listed = (session: ReturnType<typeof createSession>): Bag[] => session.customizations() as Bag[];
const serverOf = (session: ReturnType<typeof createSession>, name: string): Bag | undefined =>
  listed(session).find((one) => one.type === 'mcpServer' && one.name === name);

beforeEach(() => {
  sdk.reset();
  watched.changes = [];
});

it('starts no CLI until its first send, which starts one on the conversation it names', async () => {
  const { session } = open();
  await settle();
  expect(sdk.built).toHaveLength(0);

  session.sendMessage('t1', 'hello');
  await settle();
  expect(sdk.built).toHaveLength(1);
  expect(sdk.built[0]).toMatchObject({ sessionId: SESSION });
  expect(sdk.calls).toContain('prompt');
  await session.close();
});

it('starts its first CLI on the agent its first send picks', async () => {
  const { session } = open();
  session.changeAgent({ uri: 'claude-internal:/agent/Plan' });
  session.sendMessage('t1', 'plan this');
  await settle();
  expect(sdk.built).toHaveLength(1);
  expect(sdk.built[0]).toMatchObject({ agent: 'Plan' });
  await session.close();
});

it("lists the agent's own and its disk scan until its first CLI answers", async () => {
  const { session, cwd } = open();
  expect(session.models()).toEqual(MODELS);
  const ids = listed(session).map((one) => one.id);
  const projectSkills = uriOf(join(cwd, '.claude', 'skills'));
  expect(ids).toEqual(expect.arrayContaining([HELPER, 'agent-builtin:/skills', projectSkills]));
  const skills = listed(session).find((one) => one.id === projectSkills);
  expect(skills?.children).toEqual([expect.objectContaining({ name: 'review', description: 'Reviews a change' })]);
  // The scan's servers, each declared and not started; the seeds' are another CLI's.
  expect(listed(session).filter((one) => one.type === 'mcpServer').map((one) => one.name)).toEqual(['docs']);
  expect(serverOf(session, 'docs')).toMatchObject({ uri: uriOf(join(cwd, '.mcp.json')), state: { kind: 'stopped' } });

  session.sendMessage('t1', 'hello');
  await settle();
  expect(session.models()).toEqual([{ id: 'sonnet', name: 'Sonnet' }]);
  await session.close();
});

/*
 * A CLI signed in to nothing lists models no turn could run on, and a
 * session offers none of them, as VS Code's Claude agent offers no models
 * where no account is set up.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1002-L1021
 */
it('lists no models once its first CLI answers signed in to nothing', async () => {
  sdk.account = { tokenSource: 'none', apiProvider: 'firstParty' };
  const { session } = open();
  session.sendMessage('t1', 'hello');
  await settle();
  expect(session.models()).toEqual([]);
  await session.close();
});

it('keeps its lists when its first CLI does not answer what it has', async () => {
  sdk.answers = false;
  const { session, cwd } = open();
  session.sendMessage('t1', 'hello');
  await settle();
  expect(sdk.built).toHaveLength(1);
  expect(session.models()).toEqual(MODELS);
  expect(listed(session).map((one) => one.id)).toContain(uriOf(join(cwd, '.claude', 'skills')));
  await session.close();
});

it('keeps a switch made before its first send for its first CLI, before its prompt', async () => {
  sdk.servers = [{ name: 'docs', status: 'connected' }];
  const { session, said } = open();
  const docs = String(serverOf(session, 'docs')?.id);

  expect(await session.setCustomizationEnabled(docs, false)).toBe(true);
  expect(await session.setCustomizationEnabled(HELPER, false)).toBe(true);
  expect(sdk.built).toHaveLength(0);
  expect(sdk.calls).toEqual([]);
  const updated = said.filter((one) => one.type === 'session/customizationUpdated').map((one) => one.customization as Bag);
  expect(updated).toEqual([
    expect.objectContaining({ id: docs, enablement: [{ kind: 'session', enabled: false }] }),
    expect.objectContaining({ id: HELPER, enablement: [{ kind: 'session', enabled: false }] }),
  ]);

  // The first CLI is handed the switch under the plugin's `enabledPlugins` id, which its row is named by.
  session.sendMessage('t1', 'hello');
  await settle();
  expect(sdk.built[0]?.settings).toMatchObject({ enabledPlugins: { 'helper@market': false } });
  expect(sdk.calls).toEqual(['toggle docs false', 'prompt']);
  await session.close();
});

it('refuses to start or stop a server before its first send', async () => {
  const { session } = open();
  const docs = String(serverOf(session, 'docs')?.id);
  expect(await session.startMcpServer(docs)).toBe(false);
  expect(await session.stopMcpServer(docs)).toBe(false);
  expect(sdk.built).toHaveLength(0);
  await session.close();
});

it('stops and closes before its first send with no CLI to reach', async () => {
  const { session } = open();
  session.abort();
  await session.close();
  expect(sdk.built).toHaveLength(0);
  expect(sdk.closed).toBe(0);
});

it('lists a file written before its first send', async () => {
  const { session, said, cwd } = open();
  mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(cwd, '.claude', 'agents', 'scout.md'), '---\nname: scout\ndescription: Looks around\n---\n');
  for (const change of watched.changes) change();
  await settle();
  const last = said.filter((one) => one.type === 'session/customizationsChanged').at(-1)?.customizations as Bag[] | undefined;
  const agents = last?.find((one) => one.id === uriOf(join(cwd, '.claude', 'agents')));
  expect(agents?.children).toEqual([expect.objectContaining({ name: 'scout', description: 'Looks around' })]);
  expect(sdk.built).toHaveLength(0);
  await session.close();
});
