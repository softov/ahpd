import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * A subagent's chat, there again after a restart.
 *
 * The CLI writes each conversation that ran inside a session's tool calls
 * beside the session: `subagents/agent-<id>.jsonl`, with a `.meta.json` naming
 * the call that spawned it. This repository reads that meta file directly -
 * it already reads the CLI's transcript files - so restoring a worker is one
 * read and no inference. A harness that writes no meta file falls back to the
 * `agentId:` line the spawning call's own result sometimes ends with, and a
 * worker neither names is skipped rather than linked to the wrong call.
 */

const sdk = vi.hoisted(() => ({
  sessions: [] as Record<string, unknown>[],
  messages: [] as Record<string, unknown>[],
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  listSessions: async () => sdk.sessions,
  getSessionMessages: async () => sdk.messages,
  createSdkMcpServer: () => ({}),
}));

const { claude } = await import('../packages/agent-claude/src/claude.js');
const { createHost } = await import('../packages/sdk/src/host.js');

const DIR = '/home/softov/project';
const SESSION = '11111111-2222-4333-8444-555555555555';
const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

const frame = (kind: 'user' | 'assistant', uuid: string, message: unknown): Record<string, unknown> => ({
  type: kind, uuid, timestamp: '2020-01-01T00:00:00.000Z', message,
});

const CONFIG = mkdtempSync(join(tmpdir(), 'ahpd-restore-'));
const before = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = CONFIG;
afterAll(() => {
  if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = before;
});

/** A session directory, exactly as the CLI lays one out. */
function laid(): { project: string; session: string } {
  const project = join(CONFIG, 'projects', DIR.replace(/[^A-Za-z0-9]/g, '-'));
  const session = join(project, SESSION);
  const subagents = join(session, 'subagents');
  mkdirSync(subagents, { recursive: true });

  // The session: a `Task` linked by its meta, one linked only by the suffix
  // its result ends with, and one plain answer.
  sdk.messages = [
    frame('user', 'u1', { role: 'user', content: 'spawn a couple of workers' }),
    frame('assistant', 'a1', {
      id: 'm1', model: 'claude-opus-5',
      content: [{ type: 'tool_use', id: 'toolu_task', name: 'Agent', input: { subagent_type: 'Explore', description: 'List files', prompt: 'list the files' } }],
    }),
    frame('user', 'u2', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_task', content: 'done' }] }),
    frame('assistant', 'a2', {
      id: 'm2', model: 'claude-opus-5',
      content: [{ type: 'tool_use', id: 'toolu_second', name: 'Agent', input: { description: 'Audit', prompt: 'audit it' } }],
    }),
    frame('user', 'u3', {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_second', content: [{ type: 'text', text: 'All clear.\nagentId: b2' }] }],
    }),
    frame('assistant', 'a3', { id: 'm3', model: 'claude-opus-5', content: [{ type: 'text', text: 'Both are done.' }] }),
  ];
  sdk.sessions = [{ sessionId: SESSION, lastModified: Date.now(), cwd: DIR, summary: 'Restored' }];

  writeFileSync(join(project, `${SESSION}.jsonl`), sdk.messages.map(line).join(''));
  // Linked by its meta file.
  writeFileSync(join(subagents, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'List files', toolUseId: 'toolu_task', spawnDepth: 1 }));
  writeFileSync(join(subagents, 'agent-a1.jsonl'), [
    frame('user', 'su1', { role: 'user', content: 'list the files' }),
    frame('assistant', 'sa1', { id: 'sm1', model: 'claude-opus-5', content: [{ type: 'text', text: 'Found three files.' }] }),
  ].map(line).join(''));
  // No meta file at all, linked only by the `agentId:` suffix.
  writeFileSync(join(subagents, 'agent-b2.jsonl'), [
    frame('user', 'su2', { role: 'user', content: 'audit it' }),
    frame('assistant', 'sa2', { id: 'sm2', model: 'claude-opus-5', content: [{ type: 'text', text: 'Nothing to report.' }] }),
  ].map(line).join(''));
  // Neither a meta file nor a suffix, so nothing names the call that ran it.
  writeFileSync(join(subagents, 'agent-c3.jsonl'), [
    frame('assistant', 'sa3', { id: 'sm3', model: 'claude-opus-5', content: [{ type: 'text', text: 'Orphan.' }] }),
  ].map(line).join(''));
  return { project, session };
}

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

it('reads a session\'s subagents back, their turns and the call that ran each', async () => {
  laid();
  const agent = claude({ paths: [DIR] });
  const found = await agent.subagents?.(SESSION);
  expect(found).toHaveLength(2);
  const byCall = new Map((found ?? []).map((one) => [one.toolCallId, one]));

  const first = byCall.get('toolu_task');
  expect(first).toMatchObject({ title: 'Explore', agentName: 'Explore', description: 'List files' });
  expect(first?.turns).toHaveLength(1);
  const parts = first?.turns[0]?.responseParts as Bag[];
  expect(parts[0]).toMatchObject({ kind: 'markdown', content: 'Found three files.' });

  // No meta file: the suffix at the end of the spawning call's result is the link.
  expect(byCall.get('toolu_second')).toMatchObject({ title: 'Subagent' });

  // And the one with neither is left out, not linked to somebody else's call.
  expect(found?.some((one) => one.title === 'Orphan')).toBe(false);
});

it('lists a restored session\'s worker chats and serves each one read-only', async () => {
  laid();
  const host = createHost({ path: DIR, agents: [claude({ paths: [DIR] })] });
  const notes: { method: string; params: unknown }[] = [];
  const peer: Peer = {
    send: () => {},
    notify: (method, params) => { notes.push({ method, params }); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
  const client = host.accept(peer);
  await client.handle({
    method: 'initialize',
    params: { channel: 'ahp-root://', clientId: 'restore', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const session = await client.handle({ method: 'subscribe', params: { channel: `ahp-session:/${SESSION}` } }) as { snapshot: { state: Bag } };
  const chats = session.snapshot.state.chats as Bag[];
  const workerUri = `ahp-chat://subagent/${Buffer.from(`ahp-session:/${SESSION}`, 'utf8').toString('base64url')}/${encodeURIComponent('toolu_task')}`;
  const row = chats.find((one) => one.resource === workerUri);
  expect(row).toBeDefined();
  expect(row).toMatchObject({
    title: 'Explore',
    interactivity: 'read-only',
    origin: { kind: 'tool', toolCallId: 'toolu_task' },
  });

  // Its own transcript, on its own channel, and no turn may be sent to it.
  const worker = await client.handle({ method: 'subscribe', params: { channel: workerUri } }) as { snapshot: { state: Bag } };
  expect(worker.snapshot.state).toMatchObject({ resource: workerUri, interactivity: 'read-only' });
  const drawn = (worker.snapshot.state.turns as Bag[]) ?? [];
  expect(JSON.stringify(drawn)).toContain('Found three files.');

  void client.handle({
    method: 'dispatchAction',
    params: { channel: workerUri, action: { type: 'chat/turnStarted', turnId: 'no', message: { text: 'hello' } } },
  });
  await settle();
  const refused = notes.filter((one) => one.method === 'action'
    && (one.params as Bag).channel === workerUri && typeof (one.params as Bag).rejectionReason === 'string');
  expect(refused).toHaveLength(1);

  // And the spawning call in the main transcript carries the link.
  const main = await client.handle({ method: 'subscribe', params: { channel: `ahp-chat://default/${Buffer.from(`ahp-session:/${SESSION}`, 'utf8').toString('base64url')}` } }) as { snapshot: { state: Bag } };
  const turns = (main.snapshot.state.turns as Bag[]) ?? [];
  const link = turns.flatMap((turn) => (turn.responseParts as Bag[]) ?? [])
    .map((part) => (part.toolCall as Bag | undefined)?.content as Bag[] | undefined)
    .flatMap((content) => content ?? [])
    .find((one) => one.type === 'subagent');
  expect(link).toMatchObject({ resource: workerUri, title: 'Explore' });
});
