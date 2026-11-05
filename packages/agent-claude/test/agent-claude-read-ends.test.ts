import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { Bag, Session, Start } from '@ahpd/sdk';

/*
 * Where a turn read back off a transcript ended.
 *
 * A fork copies a conversation through the last entry of a turn, and a rewind
 * keeps everything up to it. A session names that entry for a turn it watched
 * from the frames its CLI sent. A turn read back was sent by a CLI that is
 * gone, so the read names its end by the same rule, and a session that resumes
 * the conversation answers from what the read named.
 */

const sdk = vi.hoisted(() => ({ messages: [] as Record<string, unknown>[] }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  getSessionMessages: async () => sdk.messages,
  getSessionInfo: async (id: string, options?: { dir?: string }) => ({ sessionId: id, summary: 'read back', lastModified: 0, cwd: options?.dir }),
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

const home = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-claude-read-ends-')));
const FOLDER = join(home, 'work');
mkdirSync(FOLDER, { recursive: true });
const before = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = join(home, 'config');
afterAll(() => {
  if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = before;
  rmSync(home, { recursive: true, force: true });
});

/**
 * The transcript the CLI writes for a conversation of `FOLDER`, which is what
 * makes a start a resume: its first entry, the prompt, as CLI 2.1.301 wrote it.
 */
const written = (id: string): void => {
  const project = join(home, 'config', 'projects', FOLDER.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, `${id}.jsonl`), `${JSON.stringify({
    parentUuid: null, isSidechain: false, promptId: 'f0829d44-61b9-476c-abb6-cb4427e28cb3', type: 'user',
    message: { role: 'user', content: 'hi' }, uuid: '6f79faf7-646d-4773-b101-06232d161be1',
    timestamp: '2026-10-29T22:14:15.249Z', permissionMode: 'auto', promptSource: 'sdk', turnOrigin: 'sdk',
    turnPosition: { promptIndex: 0, turnIndex: 1 }, userType: 'external', entrypoint: 'sdk-cli',
    cwd: FOLDER, sessionId: id, version: '2.1.301', gitBranch: 'master',
  })}\n`);
};

const frame = (kind: 'user' | 'assistant', uuid: string, message: unknown): Record<string, unknown> => ({
  type: kind, uuid, timestamp: '2020-01-01T00:00:00.000Z', message,
});
const prompt = (uuid: string, text: string): Record<string, unknown> => frame('user', uuid, { role: 'user', content: text });
const results = (uuid: string, id: string, text: string): Record<string, unknown> => frame('user', uuid, {
  role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }],
});
const said = (uuid: string, id: string, blocks: unknown[]): Record<string, unknown> => frame('assistant', uuid, {
  id, model: 'claude-opus-5', content: blocks, usage: { input_tokens: 1, output_tokens: 1 },
});

/** Two turns: one that ran a tool before it answered, and one that answered at once. */
const CONVERSATION = [
  prompt('u1', 'look around'),
  said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
  results('u2', 'toolu_1', 'a b c'),
  said('a2', 'm2', [{ type: 'text', text: 'Three files.' }]),
  prompt('u3', 'and now'),
  said('a3', 'm3', [{ type: 'text', text: 'Done.' }]),
];

const START: Start = {
  uri: 'ahp-session:/read-ends',
  chatUri: 'ahp-chat:/read-ends',
  workingDirectory: FOLDER,
  settings: {},
  clientToolTimeoutMs: 0,
  schema: () => ({ type: 'object', properties: {} }),
  emit: () => {},
};

/** One agent's read of a conversation, and a session it then starts with `start`. */
const readThenStart = async (id: string, start: Partial<Start>, messages = CONVERSATION): Promise<Session> => {
  const agent = claude({ paths: [FOLDER] });
  sdk.messages = messages;
  written(id);
  const turns = await agent.transcript?.(id, { workingDirectory: FOLDER });
  if (turns === undefined) throw new Error('the read found no conversation');
  return agent.create({ ...START, resume: id, seed: turns as unknown as Bag[], ...start });
};

it('answers each turn read back with its last entry, for a session that resumes the conversation', async () => {
  const session = await readThenStart('0a0a0a0a-2222-4222-8222-000000000001', {});
  expect(session.forkPoint?.('u1')).toBe('a2');
  expect(session.endPoint?.('u1')).toBe('a2');
  expect(session.forkPoint?.('u3')).toBe('a3');
  expect(session.endPoint?.('u3')).toBe('a3');
});

/*
 * A turn is cut at its last assistant message on the main chain, as VS Code's
 * resolveForkAnchorUuid reads the transcript: a turn that stopped after a
 * tool result is cut before that result.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L72-L112
 */
it('ends a turn that stopped after a tool result at its last assistant message', async () => {
  const session = await readThenStart('0a0a0a0a-2222-4222-8222-000000000002', {}, [
    prompt('u1', 'look around'),
    said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
    results('u2', 'toolu_1', 'a b c'),
    prompt('u3', 'never mind'),
    said('a3', 'm3', [{ type: 'text', text: 'All right.' }]),
  ]);
  expect(session.endPoint?.('u1')).toBe('a1');
  expect(session.endPoint?.('u3')).toBe('a3');
  // A frame of tool results is part of a turn, never one of its own.
  expect(session.endPoint?.('u2')).toBeUndefined();
});

/** A turn whose steering message the CLI ran after its last answer, as a prompt of its own, and a turn after it. */
const STEERED = [
  prompt('u1', 'look around'),
  said('a1', 'm1', [{ type: 'text', text: 'Three files.' }]),
  prompt('s1', 'and count them'),
  said('a2', 'm2', [{ type: 'text', text: 'Three.' }]),
  prompt('u3', 'and now'),
  said('a3', 'm3', [{ type: 'text', text: 'Done.' }]),
];

/** The turns a host reads that conversation back as, its record putting the steering message inside the turn it steered. */
const JOINED = [{ id: 'u1', message: { text: 'look around' } }, { id: 'u3', message: { text: 'and now' } }];

it('ends a turn the host read back with another inside it where that other one ended', async () => {
  const agent = claude({ paths: [FOLDER] });
  const id = '0a0a0a0a-2222-4222-8222-000000000006';
  sdk.messages = STEERED;
  written(id);
  await agent.transcript?.(id, { workingDirectory: FOLDER });
  const session = agent.create({ ...START, resume: id, seed: JOINED });
  expect(session.endPoint?.('u1')).toBe('a2');
  expect(session.forkPoint?.('u1')).toBe('a2');
  expect(session.endPoint?.('u3')).toBe('a3');
});

it('keeps a turn the host read back with another inside it to the rewind point, past which nothing is kept', async () => {
  const agent = claude({ paths: [FOLDER] });
  const id = '0a0a0a0a-2222-4222-8222-000000000007';
  sdk.messages = STEERED;
  written(id);
  await agent.transcript?.(id, { workingDirectory: FOLDER });
  // Cut back to the end of the first turn, which is the end of the message inside it.
  const session = agent.create({ ...START, resume: id, seed: JOINED.slice(0, 1), rewindAt: 'a2' });
  expect(session.endPoint?.('u1')).toBe('a2');
  expect(session.endPoint?.('u3')).toBeUndefined();
});

it('answers no point read back for a session that forks the conversation', async () => {
  const session = await readThenStart('0a0a0a0a-2222-4222-8222-000000000003', {
    chatUri: 'ahp-chat:/read-ends-fork',
    chatId: '0a0a0a0a-2222-4222-8222-000000000004',
    forkAt: 'a2',
  });
  expect(session.forkPoint?.('u1')).toBeUndefined();
});

it('answers no point for a session that resumes a conversation nothing read', async () => {
  const agent = claude({ paths: [FOLDER] });
  const id = '0a0a0a0a-2222-4222-8222-000000000005';
  written(id);
  const session = agent.create({ ...START, resume: id, seed: [{ id: 'u1', message: { text: 'look around' } }] });
  expect(session.forkPoint?.('u1')).toBeUndefined();
  expect(session.endPoint?.('u1')).toBeUndefined();
});
