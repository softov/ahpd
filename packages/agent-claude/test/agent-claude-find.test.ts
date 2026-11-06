import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { uriOf } from '@ahpd/sdk';
import type { Listed } from '@ahpd/sdk';

/*
 * One session, asked for by id.
 *
 * Every read of a past session used to begin by listing: `transcript` and
 * `subagents` each walked every configured directory looking for the id, and
 * each of those is a pass over every transcript on the machine, for one
 * conversation. `getSessionInfo` reads one session file and says which
 * directory it was under, which is the one thing both of those wanted from the
 * listing in the first place.
 */

const sdk = vi.hoisted(() => ({
  listed: 0,
  asked: [] as { id: string; dir?: string }[],
  /** Every session the store has, by the directory it sits under. */
  store: {} as Record<string, Record<string, unknown>>,
}));

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  listSessions: async ({ dir }: { dir: string }) => {
    sdk.listed += 1;
    return Object.entries(sdk.store[dir] ?? {}).map(([sessionId, info]) => info);
  },
  getSessionInfo: async (id: string, options?: { dir?: string }) => {
    sdk.asked.push({ id, ...(options?.dir === undefined ? {} : { dir: options.dir }) });
    const found = sdk.store[options?.dir ?? '']?.[id];
    return found;
  },
  getSessionMessages: async () => [],
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
  sdk.listed = 0;
  sdk.asked.length = 0;
  sdk.store = { [ONE]: { one: session('one', ONE) }, [TWO]: { two: session('two', TWO) } };
};

const agent = () => claude({ paths: [ONE, TWO] });

it('answers a row for one id without listing anything', async () => {
  stored();
  const row = await agent().find?.('two') as Listed;
  // The store was asked about that id, under the directory it sits in.
  expect(sdk.asked).toEqual([{ id: 'two', dir: ONE }, { id: 'two', dir: TWO }]);
  expect(sdk.listed).toBe(0);
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
  expect(sdk.listed).toBe(0);
});

it('reads a transcript through the one file it needs, not through a listing', async () => {
  stored();
  // No turns are on disk, so the reader answers an empty conversation - which is
  // the point: the directory is settled by the call about that id, not by
  // listing every configured path to find out which one the session was in.
  expect(await agent().transcript?.('two')).toEqual([]);
  expect(sdk.asked.map((one) => one.id)).toEqual(['two', 'two']);
  expect(sdk.listed).toBe(0);
});

it('reads a session\'s subagents the same way', async () => {
  stored();
  expect(await agent().subagents?.('two')).toEqual([]);
  expect(sdk.listed).toBe(0);
});

it('still lists for a host that asks for the catalogue', async () => {
  stored();
  const rows = await agent().list?.();
  expect(rows?.map((one) => one.id)).toEqual(['one', 'two']);
  expect(sdk.listed).toBe(2);
});

/*
 * A session that ran outside the configured paths: a bot's folder, a subfolder,
 * a worktree. The host gives the folder it recorded, and it is asked first.
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

it('answers a session in the given folder outside the paths, asking there first', async () => {
  withBot();
  const row = await agent().find?.('bot', { workingDirectory: BOT });
  expect(row).toMatchObject({ id: 'bot', workingDirectories: [uriOf(BOT)] });
  expect(sdk.asked).toEqual([{ id: 'bot', dir: BOT }]);
});

it('answers nothing for the same session when no folder is given', async () => {
  withBot();
  expect(await agent().find?.('bot')).toBeUndefined();
  expect(sdk.asked).toEqual([{ id: 'bot', dir: ONE }, { id: 'bot', dir: TWO }]);
});

it('falls back to the paths when the given folder does not exist', async () => {
  stored();
  const gone = join(home, 'gone');
  const row = await agent().find?.('two', { workingDirectory: gone });
  expect(row).toMatchObject({ id: 'two', workingDirectories: [uriOf(TWO)] });
  expect(sdk.asked).toEqual([{ id: 'two', dir: ONE }, { id: 'two', dir: TWO }]);
});

it('does not ask the SDK about a folder whose project holds no transcript for the id', async () => {
  withBot();
  expect(await agent().find?.('other', { workingDirectory: BOT })).toBeUndefined();
  expect(sdk.asked).toEqual([{ id: 'other', dir: ONE }, { id: 'other', dir: TWO }]);
});

it('asks a given folder that is one of the paths once, first', async () => {
  stored();
  await agent().find?.('two', { workingDirectory: TWO });
  expect(sdk.asked).toEqual([{ id: 'two', dir: TWO }]);
});

it('reads the transcript and the subagents of a session in the given folder', async () => {
  withBot();
  expect(await agent().transcript?.('bot', { workingDirectory: BOT })).toEqual([]);
  expect(await agent().subagents?.('bot', undefined, { workingDirectory: BOT })).toEqual([]);
  expect(sdk.asked).toEqual([{ id: 'bot', dir: BOT }, { id: 'bot', dir: BOT }]);
});
