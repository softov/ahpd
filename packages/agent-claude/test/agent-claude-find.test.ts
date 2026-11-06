import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { uriOf } from '@ahpd/sdk';
import type { Listed } from '@ahpd/sdk';

/*
 * The CLI's store, asked by id and listed whole.
 *
 * `getSessionInfo` reads one session file, and asked with no directory it
 * searches every project; `listSessions` with no directory is every session
 * the store holds, wherever it ran. VS Code's Claude agent asks both that way.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2239
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSdkService.ts#L171-L174
 */

const sdk = vi.hoisted(() => ({
  listed: [] as { dir?: string }[],
  asked: [] as { id?: string; dir?: string }[],
  read: [] as { id?: string; dir?: string }[],
  /** Every session the store has, by the directory it sits under. */
  store: {} as Record<string, Record<string, unknown>>,
}));

/** What a call named, with its directory where it named one. */
const named = (id: string | undefined, options?: { dir?: string }) => ({
  ...(id === undefined ? {} : { id }),
  ...(options?.dir === undefined ? {} : { dir: options.dir }),
});

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  // The SDK's own scoping: one project with a directory, every project without.
  listSessions: async (options?: { dir?: string }) => {
    sdk.listed.push(named(undefined, options));
    const projects = options?.dir === undefined ? Object.values(sdk.store) : [sdk.store[options.dir] ?? {}];
    return projects.flatMap((project) => Object.values(project));
  },
  getSessionInfo: async (id: string, options?: { dir?: string }) => {
    sdk.asked.push(named(id, options));
    const projects = options?.dir === undefined ? Object.values(sdk.store) : [sdk.store[options.dir] ?? {}];
    return projects.map((project) => project[id]).find((one) => one !== undefined);
  },
  getSessionMessages: async (id: string, options?: { dir?: string }) => {
    sdk.read.push(named(id, options));
    return [];
  },
  createSdkMcpServer: () => ({}),
  query: () => ({
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
  }),
}));

const { claude } = await import('../src/claude.js');

const ONE = '/home/softov/one';
const TWO = '/home/softov/two';

const session = (id: string, dir: string): Record<string, unknown> => ({
  sessionId: id, summary: `A session in ${dir}`, lastModified: 1_800_000_000_000, cwd: dir,
});

const stored = (): void => {
  sdk.listed.length = 0;
  sdk.asked.length = 0;
  sdk.read.length = 0;
  sdk.store = { [ONE]: { one: session('one', ONE) }, [TWO]: { two: session('two', TWO) } };
};

const agent = () => claude({ paths: [ONE, TWO] });

it('answers a row for one id without listing anything', async () => {
  stored();
  const row = await agent().find?.('two') as Listed;
  // The store was asked about that id alone.
  expect(sdk.asked).toEqual([{ id: 'two' }]);
  expect(sdk.listed).toEqual([]);
  // The row a listing would have offered, in the shape a host records.
  expect(row).toMatchObject({
    id: 'two', title: `A session in ${TWO}`,
    createdAt: new Date(1_800_000_000_000).toISOString(),
    modifiedAt: new Date(1_800_000_000_000).toISOString(),
    workingDirectories: [uriOf(TWO)],
  });
});

it('answers nothing for an id the store does not have', async () => {
  stored();
  expect(await agent().find?.('nobody')).toBeUndefined();
  expect(sdk.listed).toEqual([]);
});

it('reads a transcript through the one file it needs, not through a listing', async () => {
  stored();
  // No turns are on disk, so the reader answers an empty conversation: the
  // session is settled by the call about that id, and its turns are read by
  // the id alone.
  expect(await agent().transcript?.('two')).toEqual([]);
  expect(sdk.asked).toEqual([{ id: 'two' }]);
  expect(sdk.read).toEqual([{ id: 'two' }]);
  expect(sdk.listed).toEqual([]);
});

it('reads a session\'s subagents the same way', async () => {
  stored();
  expect(await agent().subagents?.('two')).toEqual([]);
  expect(sdk.listed).toEqual([]);
});

/*
 * A session that ran outside the configured paths: a bot's folder, a subfolder,
 * a worktree. The store holds it under its own project.
 */

const home = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-claude-find-')));
const BOT = join(home, 'bots', 'one');
const before = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = join(home, 'config');
afterAll(() => {
  if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = before;
  rmSync(home, { recursive: true, force: true });
});

/** The transcript the CLI writes for a session of `folder`, with one line in it. */
const written = (id: string, folder: string): void => {
  const project = join(home, 'config', 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, `${id}.jsonl`), '{}\n');
};

const withBot = (): void => {
  stored();
  mkdirSync(BOT, { recursive: true });
  sdk.store[BOT] = { bot: session('bot', BOT) };
  written('bot', BOT);
};

it('lists every session the store holds, wherever it ran, in one listing', async () => {
  withBot();
  const rows = await agent().list?.();
  expect(rows?.map((one) => one.id)).toEqual(['one', 'two', 'bot']);
  expect(rows?.find((one) => one.id === 'bot')?.workingDirectories).toEqual([uriOf(BOT)]);
  expect(sdk.listed).toEqual([{}]);
});

it('lists a session the store names no folder for in none', async () => {
  stored();
  sdk.store[ONE] = { bare: { sessionId: 'bare', summary: 'No folder', lastModified: 1_800_000_000_000 } };
  const rows = await agent().list?.();
  expect(rows?.find((one) => one.id === 'bare')?.workingDirectories).toEqual([]);
});

it('answers a session that ran outside the paths by its id alone', async () => {
  withBot();
  const row = await agent().find?.('bot');
  expect(row).toMatchObject({ id: 'bot', workingDirectories: [uriOf(BOT)] });
  expect(sdk.asked).toEqual([{ id: 'bot' }]);
});

it('hands the SDK no folder the host recorded', async () => {
  withBot();
  // A folder outside the paths, one that is gone, and one of the paths: the
  // store is asked by the id each time.
  expect(await agent().find?.('other', { workingDirectory: BOT })).toBeUndefined();
  expect(await agent().find?.('two', { workingDirectory: join(home, 'gone') })).toMatchObject({ id: 'two' });
  expect(await agent().find?.('two', { workingDirectory: TWO })).toMatchObject({ id: 'two' });
  expect(sdk.asked).toEqual([{ id: 'other' }, { id: 'two' }, { id: 'two' }]);
});

it('reads the transcript and the subagents of a session that ran outside the paths', async () => {
  withBot();
  expect(await agent().transcript?.('bot')).toEqual([]);
  expect(await agent().subagents?.('bot')).toEqual([]);
  expect(sdk.asked).toEqual([{ id: 'bot' }, { id: 'bot' }]);
  expect(sdk.read).toEqual([{ id: 'bot' }, { id: 'bot' }]);
});
