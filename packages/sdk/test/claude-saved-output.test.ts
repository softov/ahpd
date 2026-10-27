import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  resetSdk, actions, claude, createHost, emit, hello, machine, peer, sdk, settle,
} from './support/host.js';
import { fileSessions, memorySessions } from '../src/sessions/sessions.js';
import { uriOf } from '../src/resources/resources.js';
import { retainedTerminalOf } from '../src/host/channels.js';
import type { Bag } from '../src/types/common.js';
import type { SessionStore } from '../src/types/sessions.js';

/*
 * A Claude `Bash` result too large to send, through the host, and after it.
 *
 * Claude saves the whole output to a file and gives the model a notice in its
 * place. The host keeps the output for the call's chat, the call names the
 * terminal, and a subscribe is answered from what was kept. A host started
 * again on the same store reads the call back from Claude's transcript, which
 * holds the notice alone, and the call names its terminal again.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-claude-saved-'));
  made.push(dir);
  return dir;
};

type Client = { handle(request: unknown): Promise<unknown> };

const stateOf = async (client: Client, channel: string): Promise<Bag> =>
  (await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: Bag } }).snapshot.state;

/** The session, named the way the host holds it, so the chat read is the chat it names terminals under. */
const SESSION = 'claude:/kept';

/** The whole output, the file Claude saved it to, and the notice the model was given in its place. */
const savedOutput = () => {
  const path = join(temp(), 'b907a98.txt');
  const output = `BEGIN\n${'x'.repeat(40_000)}\nEND\n`;
  writeFileSync(path, output);
  const notice = ['<persisted-output>', `Output too large (39.1KB). Full output saved to: ${path}`, '', 'Preview (first 2KB):', 'BEGIN', '...', '</persisted-output>'].join('\n');
  return { path, output, notice };
};

/** A host on a store, with a client watching the root. */
const hostOn = async (dir: string, store: SessionStore) => {
  const host = createHost({ path: dir, agents: [claude({ paths: [dir] })], ...machine(), sessions: store });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
  return { host, client, peer: p };
};

/** The tool calls of a chat's turns, finished and running. */
const callsOf = (chat: Bag): Bag[] => [
  ...(Array.isArray(chat.turns) ? chat.turns as Bag[] : []),
  ...(chat.activeTurn === undefined ? [] : [chat.activeTurn as Bag]),
].flatMap((turn) => (turn.responseParts as Bag[]).filter((part) => part.kind === 'toolCall').map((part) => part.toolCall as Bag));

/** Run one `Bash` call whose output was too large to send, and answer the content its completion carries. */
const ranTooLarge = async (dir: string, store: SessionStore) => {
  const { host, client, peer: p } = await hostOn(dir, store);
  await client.handle({ method: 'createSession', params: { channel: SESSION, provider: 'claude', workingDirectories: [uriOf(dir)] } });
  const chat = String((await stateOf(client, SESSION)).defaultChat);
  await stateOf(client, chat);
  void client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'count it' } } } });
  await settle();
  const { path, output, notice } = savedOutput();
  await emit({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 'toolu_big', name: 'Bash', input: { command: 'seq 1 100000' } }] } });
  await emit({
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_big', content: notice }] },
    tool_use_result: { stdout: output.slice(0, 30_000), stderr: '', interrupted: false, persistedOutputPath: path, persistedOutputSize: output.length },
  });
  const completion = () => actions(p, chat).find((one) => one.action.type === 'chat/toolCallComplete')?.action;
  for (const until = Date.now() + WAIT_MS; completion() === undefined && Date.now() < until;) await new Promise((r) => { setTimeout(r, 20); });
  await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
  const content = (completion()?.result as { content?: Bag[] } | undefined)?.content ?? [];
  return { host, client, chat, output, notice, content };
};

/** The transcript Claude wrote for that call: the prompt, the call, and the notice in its result. */
const transcriptOf = (notice: string): Record<string, unknown>[] => [
  { type: 'user', uuid: 'u1', message: { role: 'user', content: 'count it' } },
  { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'tool_use', id: 'toolu_big', name: 'Bash', input: { command: 'seq 1 100000' } }] } },
  { type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_big', content: notice }] } },
];

it('names the terminal on the call, and answers a subscribe from what was kept', async () => {
  const dir = temp();
  const { client, chat, output, notice, content } = await ranTooLarge(dir, fileSessions({ dir: join(dir, 'sessions') }));
  expect(content[0]).toEqual({ type: 'text', text: notice });
  const resource = String(content[1]?.resource);
  expect(retainedTerminalOf(resource)).toEqual({ chat, key: 'toolu_big' });

  const terminal = await stateOf(client, resource);
  expect(terminal.content).toEqual([{ type: 'unclassified', value: output }]);
  expect(terminal.lifecycle).toEqual({ status: 'exited', exitCode: 0 });
  expect(terminal.isPty).toBe(false);
  expect(terminal.claim).toEqual({ kind: 'session', session: SESSION, chat, toolCallId: 'toolu_big' });
});

it('names the terminal again on the call read back after a restart, and rebuilds it', async () => {
  const dir = temp();
  const store = join(dir, 'sessions');
  const before = await ranTooLarge(dir, fileSessions({ dir: store }));
  const resource = String(before.content[1]?.resource);
  await before.host.close();

  // The same conversation, as Claude's transcript holds it: the notice alone.
  sdk.sessions.push({ sessionId: 'kept', summary: 'count it', lastModified: 1, cwd: dir });
  sdk.transcript.push(...transcriptOf(before.notice));
  const { client } = await hostOn(dir, fileSessions({ dir: store }));
  const chat = await stateOf(client, before.chat);
  const call = callsOf(chat).find((one) => one.toolCallId === 'toolu_big');
  expect(call?.content).toEqual([
    { type: 'text', text: before.notice },
    { type: 'terminal', resource, title: 'Bash', isPty: false, result: { exitCode: 0, preview: 'BEGIN', truncated: true } },
  ]);

  const terminal = await stateOf(client, resource);
  expect(terminal.content).toEqual([{ type: 'unclassified', value: before.output }]);
  expect(terminal.lifecycle).toEqual({ status: 'exited', exitCode: 0 });
});

it('names no terminal on a call read back where nothing was kept', async () => {
  const dir = temp();
  // A store with no folders, so the output was never kept.
  const before = await ranTooLarge(dir, memorySessions());
  expect(before.content).toEqual([{ type: 'text', text: before.notice }]);
  await before.host.close();

  sdk.sessions.push({ sessionId: 'kept', summary: 'count it', lastModified: 1, cwd: dir });
  sdk.transcript.push(...transcriptOf(before.notice));
  const { client } = await hostOn(dir, fileSessions({ dir: join(dir, 'sessions') }));
  const call = callsOf(await stateOf(client, before.chat)).find((one) => one.toolCallId === 'toolu_big');
  expect(call?.content).toEqual([{ type: 'text', text: before.notice }]);
});
