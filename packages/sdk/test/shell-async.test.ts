import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WAIT_MS } from '../../../tools/wait.ts';
import { posix } from '../../../tools/posix.ts';
import { uriOf } from '../src/resources/fileuri.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { ROOT } from '../src/host.js';
import type { Host } from '../src/types/host.js';
import type { Usage, UsageEntry } from '../src/types/usage.js';
import { directory, RECORD } from './users-gate-helpers.js';
import {
  actions, emit, resetSdk, claude, createHost, fileResources, gitBranches, hello, hostTools, peer, sessionQueries, settle, shellTerminals,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * An async command: this host's `mode=async` on the agent terminal tool.
 *
 * The reference host's own description promises a mode that answers with a
 * terminal id for a long-running command, and its schema has no such
 * parameter. What is checked here is this host's half of the promise: the call
 * is answered at once and the command's row is set on the chat, the shell the
 * command runs in is not handed to the next one until it ends, and the row
 * carries a stop that really interrupts the work.
 */

type Answer = { content: { text: string }[]; isError?: boolean };
type Handler = (input: unknown, extra?: unknown) => Promise<Answer>;
type Turn = { message?: { text?: string; _meta?: Record<string, unknown> } };
type ChatState = {
  backgroundWork?: Record<string, unknown>[];
  turns?: Turn[];
  activeTurn?: Turn;
  queuedMessages?: { id?: string; message?: { text?: string } }[];
};

/** A clock a case moves, as in `session-wakeup-tool.test.ts`. */
const clock = () => {
  let at = Date.parse('2026-10-10T12:00:00Z');
  const armed: (() => void)[] = [];
  return {
    now: (): Date => new Date(at),
    timer: (fire: () => void): { cancel(): void } => {
      armed.push(fire);
      return { cancel: () => { const i = armed.indexOf(fire); if (i >= 0) armed.splice(i, 1); } };
    },
    pass: (seconds: number): void => {
      at += seconds * 1000;
      for (const fire of armed.splice(0)) fire();
    },
  };
};

type Clock = ReturnType<typeof clock>;

/** Every host a case opened, closed after it so no shell outlives the case. */
const opened: Host[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (host) => { await host.close(); }));
});

/** Wait for something to become true, by the clock. */
const until = async (check: () => Promise<boolean> | boolean, what = 'it'): Promise<void> => {
  for (const end = Date.now() + WAIT_MS; Date.now() < end;) {
    if (await check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error(`${what} never happened`);
};

/**
 * A host with the terminal tool on, one session in a folder of its own, and
 * the backend's view of its tools, which is where a call is made from.
 */
const hosted = async (extra: { time?: Clock; users?: boolean; usage?: Usage } = {}) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-shell-async-')));
  const kept = memorySessions();
  const host = createHost({
    path: dir,
    agents: [claude({ paths: [dir] })],
    resources: fileResources(),
    directories: gitBranches(),
    terminals: shellTerminals(),
    tools: hostTools(),
    sessions: kept,
    ...(extra.time === undefined ? {} : { now: extra.time.now, timer: extra.time.timer }),
    ...(extra.users === true ? { users: directory({ ana: ['*:*'] }) } : {}),
    ...(extra.usage === undefined ? {} : { usage: extra.usage }),
  });
  opened.push(host);
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello(['0.9.0'], { initialSubscriptions: [ROOT] }));
  // Signed in before the config is pushed: a host with a directory refuses a
  // root action from a connection the directory does not know.
  if (extra.users === true) await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'ana' } });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { enableCustomTerminalTool: true } } },
  });
  await settle();
  const uri = 'ahp-session:/shell-async';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude', workingDirectories: [uriOf(dir)] } });
  const chatUri = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state.defaultChat;
  // Subscribed before the case runs anything, so a row set on the chat is an
  // action this peer hears rather than a snapshot it reads late.
  const chatState = async (): Promise<ChatState> => (await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: ChatState };
  }).snapshot.state;
  await chatState();
  /** One call of a host tool, as the CLI makes it: by its handler, naming the call. */
  const call = async (name: string, input: Record<string, unknown> = {}, id = 'tc-async'): Promise<Answer> => {
    const options = sessionQueries().at(-1)?.options as Record<string, unknown>;
    const servers = options.mcpServers as Record<string, { tools: { name: string; handler: Handler }[] }>;
    const found = servers.host?.tools.find((one) => one.name === name);
    if (found === undefined) throw new Error(`no tool ${name}`);
    return await found.handler(input, { _meta: { 'claudecode/toolUseId': id } });
  };
  return { host, client, p, dir, uri, chatUri, kept, call, chatState };
};

const text = (answer: Answer): string => answer.content.map((one) => one.text).join('');

/** The shell id an answer starts with. */
const shellIdOf = (answer: Answer): string => /^Shell ID: (\S+)\n/u.exec(text(answer))?.[1] ?? '';

/** The rows a chat's snapshot carries. */
const rowsOf = async (on: Awaited<ReturnType<typeof hosted>>): Promise<Record<string, unknown>[]> => (await on.chatState()).backgroundWork ?? [];

/** Every message the chat holds: the turn running now, and the ones before it. */
const turnTexts = async (on: Awaited<ReturnType<typeof hosted>>): Promise<string[]> => {
  const state = await on.chatState();
  return [
    ...(state.turns ?? []).map((one) => String(one.message?.text ?? '')),
    ...(state.activeTurn === undefined ? [] : [String(state.activeTurn.message?.text ?? '')]),
  ];
};

/** The messages waiting their turn. */
const queuedTexts = async (on: Awaited<ReturnType<typeof hosted>>): Promise<string[]> =>
  ((await on.chatState()).queuedMessages ?? []).map((one) => String(one.message?.text ?? ''));

/** The wake a chat's record holds. */
const storedWake = (on: Awaited<ReturnType<typeof hosted>>): Record<string, unknown> | undefined =>
  on.kept.chats('shell-async').find((one) => one.uri === on.chatUri)?.wake as Record<string, unknown> | undefined;

/** The text of the turn an async command's end began, once there is one. */
const endTurn = async (on: Awaited<ReturnType<typeof hosted>>): Promise<string> => {
  await until(async () => (await turnTexts(on)).some((one) => one.startsWith('The background shell command ended')), 'the turn at the end');
  return (await turnTexts(on)).find((one) => one.startsWith('The background shell command ended')) ?? '';
};

describe.skipIf(!posix)('an async command', () => {
  it('is answered at once with its shell id, before it ends', async () => {
    const on = await hosted();
    const answer = await on.call('bash', { command: 'sleep 1; echo done', mode: 'async' });
    expect(answer.isError).toBeUndefined();
    // The shell, and not the command's output: an answer that waited would
    // carry the exit code and the row would already be gone.
    expect(text(answer)).toBe(`Shell ID: ${shellIdOf(answer)}\nThe command is running in the background. It is shown as a task in this chat, and this session is woken with its output when it ends.`);
    const id = shellIdOf(answer);
    expect((await rowsOf(on)).map((one) => one.id)).toEqual([`shell:${id}`]);
    // And the row goes once the command has ended.
    await until(async () => (await rowsOf(on)).length === 0, 'the row to go');
  });

  it('is a row on its chat, naming the command and the terminal it runs in', async () => {
    const on = await hosted();
    const answer = await on.call('bash', { command: 'sleep 1; echo done', mode: 'async' });
    const id = shellIdOf(answer);
    const [row] = await rowsOf(on);
    expect(row).toMatchObject({
      kind: 'shell',
      id: `shell:${id}`,
      label: 'sleep 1; echo done',
      command: 'sleep 1; echo done',
      terminal: expect.stringMatching(/^ahp-terminal:\/\/shell\//u),
      _meta: { 'vscode.stopBackgroundWork': true },
    });
    await settle();
    const sent = actions(on.p)
      .filter((one) => one.action.type === 'chat/backgroundWorkSet')
      .map((one) => one.action.work as Record<string, unknown>);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: `shell:${id}`, command: 'sleep 1; echo done' });
    await until(async () => (await rowsOf(on)).length === 0, 'the row to go');
  });

  it('starts the command in a terminal, which is still running right after the answer', async () => {
    const on = await hosted();
    await on.call('bash', { command: 'sleep 1; echo done', mode: 'async' });
    const row = (await rowsOf(on))[0];
    const terminals = (await on.client.handle({ method: 'subscribe', params: { channel: ROOT } }) as {
      snapshot: { state: { terminals?: { resource: string; claim: Record<string, unknown> }[] } };
    }).snapshot.state.terminals ?? [];
    // The row names the terminal the command was given, claimed by this call.
    expect(terminals.find((one) => one.resource === row?.terminal)?.claim)
      .toMatchObject({ kind: 'session', session: on.uri, toolCallId: 'tc-async' });
  });

  it('is stopped by vscode/stopBackgroundWork, which interrupts it and takes the row down', async () => {
    const on = await hosted();
    const answer = await on.call('bash', { command: 'sleep 30; echo done', mode: 'async' });
    const id = `shell:${shellIdOf(answer)}`;
    expect((await rowsOf(on)).map((one) => one.id)).toEqual([id]);
    const stopped = await on.client.handle({ method: 'vscode/stopBackgroundWork', params: { chat: on.chatUri, id } }) as { stopped: boolean };
    expect(stopped).toEqual({ stopped: true });
    await until(async () => (await rowsOf(on)).length === 0, 'the row to go');
  });

  it('keeps the shell from the next command until it ends, which then gets another', async () => {
    const on = await hosted();
    const running = await on.call('bash', { command: 'sleep 1; echo done', mode: 'async' });
    const next = await on.call('bash', { command: 'echo other' });
    expect(text(next)).toMatch(/^Shell ID: \S+\nExit code: 0\nother$/u);
    expect(shellIdOf(next)).not.toBe(shellIdOf(running));
    // And the first shell is handed back once its command ends.
    await until(async () => (await rowsOf(on)).length === 0, 'the row to go');
    expect(shellIdOf(await on.call('bash', { command: 'echo back' }))).toBe(shellIdOf(running));
  });
});

/*
 * The end of an async command wakes the session with it.
 *
 * The turn is begun the way a wake's is - through the host's own turn gate,
 * queued behind a turn that is running, and acting as the person whose turn
 * started the command - and it is not a wake: a wake the model set stays where
 * it was.
 */
describe.skipIf(!posix)('the end of an async command', () => {
  it('starts a turn that names the command, its exit code and the end of its output', async () => {
    const on = await hosted();
    await on.call('bash', { command: 'echo done', mode: 'async' });
    const said = await endTurn(on);
    expect(said).toContain('The background shell command ended with exit code 0.');
    expect(said).toContain('echo done');
    expect(said).toContain('The end of its output:\ndone');
    // The row went before the turn: a client is not told the work is still
    // going while the turn that reads its end runs.
    expect(await rowsOf(on)).toEqual([]);
  });

  it('starts no turn when the session is closed under it, and does not bring the session back', async () => {
    const on = await hosted();
    await on.call('bash', { command: 'sleep 30', mode: 'async' });
    await until(async () => (await rowsOf(on)).length === 1, 'the row');
    const queries = sessionQueries().length;
    await on.client.handle({ method: 'disposeSession', params: { channel: on.uri } });
    await new Promise((resolve) => { setTimeout(resolve, 500); });
    // A woken turn would have opened the session's backend again.
    expect(sessionQueries().length).toBe(queries);
    const listed = await on.client.handle({ method: 'listSessions', params: { channel: ROOT } }) as { items?: { resource?: string }[] };
    expect((listed.items ?? []).map((one) => one.resource)).not.toContain(on.uri);
  });

  it('starts no turn when the host closes under it', async () => {
    const on = await hosted();
    await on.call('bash', { command: 'sleep 30', mode: 'async' });
    await until(async () => (await rowsOf(on)).length === 1, 'the row');
    const queries = sessionQueries().length;
    await on.host.close();
    await new Promise((resolve) => { setTimeout(resolve, 500); });
    // A turn begun while the host closed would have opened the backend again,
    // and a message queued then would be read back as one the person sent.
    expect(sessionQueries().length).toBe(queries);
    expect(on.kept.chats('shell-async').flatMap((one) => (one as { queued?: unknown[] }).queued ?? [])).toEqual([]);
  });

  it('is queued behind a turn that is already running', async () => {
    const on = await hosted();
    await on.client.handle({
      method: 'dispatchAction',
      params: { channel: on.chatUri, clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 't-running', message: { text: 'busy here' } } },
    });
    await until(async () => (await on.chatState()).activeTurn !== undefined, 'the running turn');
    await on.call('bash', { command: 'sleep 1; echo done', mode: 'async' });
    await until(async () => (await rowsOf(on)).length === 0, 'the row to go');
    await until(async () => (await queuedTexts(on)).some((one) => one.startsWith('The background shell command ended')), 'the queued end');
    // Still the one it was, and the command's end is next in line.
    expect((await on.chatState()).activeTurn?.message?.text).toBe('busy here');
  });

  it('leaves a wake the model set where it was, which still fires after it', async () => {
    const time = clock();
    const on = await hosted({ time });
    expect(text(await on.call('schedule_wakeup', { delaySeconds: 60, prompt: 'check the build' })))
      .toBe('Wakeup scheduled for 2026-10-10T12:01:00.000Z.');
    await on.call('bash', { command: 'echo done', mode: 'async' });
    await endTurn(on);
    // The end is not a wake: the chat still holds the one the model set.
    expect(storedWake(on)).toMatchObject({ prompt: 'check the build' });
    time.pass(61);
    await until(async () => (await queuedTexts(on)).some((one) => one.includes('check the build')), 'the wake to fire');
  });

  it('wakes the session as the person whose turn started the command', async () => {
    const records: UsageEntry[] = [];
    const usage = {
      record: async (entry: UsageEntry) => { records.push(entry); },
      total: async () => ({}),
      pools: async () => [],
      records: async () => [],
      groups: async () => [],
    } as Usage;
    const on = await hosted({ users: true, usage });
    await on.client.handle({
      method: 'dispatchAction',
      params: { channel: on.chatUri, clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 't-ana', message: { text: 'start the server' } } },
    });
    await until(async () => (await on.chatState()).activeTurn !== undefined, 'the turn');
    await on.call('bash', { command: 'sleep 1; echo done', mode: 'async' });
    // The turn is over before the command is, so its end begins one at once.
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
    await endTurn(on);
    const started = actions(on.p)
      .filter((one) => one.action.type === 'chat/turnStarted')
      .map((one) => one.action);
    const woken = started.find((one) => String(((one.message ?? {}) as { text?: unknown }).text ?? '').startsWith('The background shell command ended'));
    // Who sent it is this host's own record, which names them on the turn's usage.
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, usage: { input_tokens: 3, output_tokens: 5 } });
    await until(() => records.some((one) => one.turn === woken?.turnId), 'the usage record');
    expect(records.find((one) => one.turn === woken?.turnId)?.owner).toBe('user:ana');
    // The host started it: a system notification, not a message from another chat.
    const message = (woken?.message ?? {}) as { origin?: unknown; _meta?: Record<string, unknown> };
    expect(message.origin).toEqual({ kind: 'systemNotification' });
    expect(message._meta?.['vscode.chat.delegation']).toBeUndefined();
  });
});
