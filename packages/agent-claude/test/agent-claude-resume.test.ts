import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';

/*
 * Which conversation a session picks up, by what the CLI wrote.
 *
 * The host resumes every chat it recorded by the id its conversation is under,
 * and the CLI writes a conversation only when its first message reaches it. A
 * chat nobody spoke to, or one whose CLI could not sign in, has an id with
 * nothing behind it, and one whose CLI was closed before it wrote its prompt
 * has a transcript with no entry of a conversation in it. The CLI ends at
 * startup rather than resume either, and refuses a new conversation under an
 * id it holds a transcript for. So a session resumes a conversation the CLI
 * wrote, wherever it wrote it, and starts any other under the id it was asked
 * to resume, on a clean transcript.
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

const { claude } = await import('../src/claude.js');

const home = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-claude-resume-')));
const FOLDER = join(home, 'work');
const OTHER = join(home, 'elsewhere');
mkdirSync(FOLDER, { recursive: true });
mkdirSync(OTHER, { recursive: true });
const before = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = join(home, 'config');
afterAll(() => {
  if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = before;
  rmSync(home, { recursive: true, force: true });
});

/** Where the CLI writes the transcript of `id` for a conversation of `folder`. */
const transcript = (id: string, folder: string): string => {
  const project = join(home, 'config', 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  return join(project, `${id}.jsonl`);
};

/** The transcript the CLI writes for a conversation of `folder`: its first entry, the prompt, as CLI 2.1.301 wrote it. */
const written = (id: string, folder: string): string => {
  const file = transcript(id, folder);
  writeFileSync(file, `${JSON.stringify({
    parentUuid: null, isSidechain: false, promptId: 'f0829d44-61b9-476c-abb6-cb4427e28cb3', type: 'user',
    message: { role: 'user', content: 'hi' }, uuid: '6f79faf7-646d-4773-b101-06232d161be1',
    timestamp: '2026-10-29T22:14:15.249Z', permissionMode: 'auto', promptSource: 'sdk', turnOrigin: 'sdk',
    turnPosition: { promptIndex: 0, turnIndex: 1 }, userType: 'external', entrypoint: 'sdk-cli',
    cwd: folder, sessionId: id, version: '2.1.301', gitBranch: 'master',
  })}\n`);
  return file;
};

/**
 * The transcript a CLI 2.1.301 left of a conversation when it was closed after
 * the prompt arrived and before it wrote the prompt's entry: the last prompt,
 * the latch and the cost, and no entry of the conversation.
 */
const leftBehind = (id: string, folder: string): string => {
  const file = transcript(id, folder);
  writeFileSync(file, [
    { type: 'last-prompt', lastPrompt: 'Reply with the single word: ok', leafUuid: '0cfcd2c8-ef04-44fd-8314-1f1f03446f2d', sessionId: id },
    { type: 'atis-latch', atis: '', sessionId: id },
    {
      type: 'cost-state', sessionId: id, totalCostUSD: 0, totalAPIDuration: 0, totalAPIDurationWithoutRetries: 0,
      totalToolDuration: 0, totalLinesAdded: 0, totalLinesRemoved: 0, totalDuration: 270, startTime: 1793243412780,
      modelUsage: {}, hasUnknownModelCost: false,
    },
  ].map((line) => `${JSON.stringify(line)}\n`).join(''));
  return file;
};

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** The `query()` options the first send of a session in `FOLDER` that `create` built from these start fields started its CLI with. */
const started = async (start: Record<string, unknown>): Promise<Record<string, unknown>> => {
  sdk.options = [];
  claude({ paths: [FOLDER] }).create({
    uri: 'ahp-session:/resume',
    chatUri: 'ahp-chat:/resume',
    workingDirectory: FOLDER,
    settings: {},
    clientToolTimeoutMs: 0,
    schema: () => ({ type: 'object', properties: {} }),
    emit: () => {},
    ...start,
  }).sendMessage('t1', 'hello');
  await settle();
  const one = sdk.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

const NEVER = '0a0a0a0a-1111-4111-8111-000000000001';
const HERE = '0a0a0a0a-1111-4111-8111-000000000002';
const THERE = '0a0a0a0a-1111-4111-8111-000000000003';
const PEER = '0a0a0a0a-1111-4111-8111-000000000004';
const FORKED = '0a0a0a0a-1111-4111-8111-000000000005';
const LEFT = '5433a783-2e55-4412-9afc-6b77ac92ac7b';
const OWN = '0a0a0a0a-1111-4111-8111-000000000006';
const KEPT = '0a0a0a0a-1111-4111-8111-000000000007';

it('starts a conversation the CLI never wrote under the id it was asked to resume', async () => {
  const options = await started({ resume: NEVER });
  expect(options).not.toHaveProperty('resume');
  expect(options).toMatchObject({ sessionId: NEVER });
});

it('keeps a chat\'s own id for a conversation the CLI never wrote', async () => {
  const options = await started({ chatId: PEER, resume: PEER });
  expect(options).not.toHaveProperty('resume');
  expect(options).toMatchObject({ sessionId: PEER });
});

it('carries no fork point beside a conversation it starts, and starts it under the chat\'s own id', async () => {
  const options = await started({ chatId: FORKED, resume: NEVER, forkAt: 'entry', rewindAt: 'entry' });
  expect(options).not.toHaveProperty('resume');
  expect(options).not.toHaveProperty('forkSession');
  expect(options).not.toHaveProperty('resumeSessionAt');
  expect(options).toMatchObject({ sessionId: FORKED });
});

it('resumes a conversation the CLI wrote under the folder\'s own project', async () => {
  written(HERE, FOLDER);
  const options = await started({ resume: HERE });
  expect(options).toMatchObject({ resume: HERE });
  expect(options).not.toHaveProperty('sessionId');
});

it('resumes a conversation the CLI wrote under another folder\'s project, which its resume finds', async () => {
  written(THERE, OTHER);
  const options = await started({ resume: THERE, forkAt: 'entry' });
  expect(options).toMatchObject({ resume: THERE, forkSession: true, resumeSessionAt: 'entry' });
});

it('starts a conversation whose transcript holds no entry of one under its id, on a clean transcript', async () => {
  const file = leftBehind(LEFT, FOLDER);
  const options = await started({ resume: LEFT });
  expect(options).not.toHaveProperty('resume');
  expect(options).toMatchObject({ sessionId: LEFT });
  expect(existsSync(file)).toBe(false);
});

it('clears a transcript with no entry of a conversation under the id a session starts its own under', async () => {
  const file = leftBehind(OWN, FOLDER);
  const options = await started({ uri: `ahp-session:/${OWN}` });
  expect(options).toMatchObject({ sessionId: OWN });
  expect(existsSync(file)).toBe(false);
});

it('keeps a conversation the CLI wrote under the id a session starts a new one under', async () => {
  const file = written(KEPT, FOLDER);
  const options = await started({ chatId: KEPT });
  expect(options).toMatchObject({ sessionId: KEPT });
  expect(existsSync(file)).toBe(true);
});
