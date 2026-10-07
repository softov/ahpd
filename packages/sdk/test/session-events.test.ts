import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import { createSessionEvents } from '../src/host/sessionevents.js';
import { fileSessions, memorySessions } from '../src/sessions.js';
import type { HostContext } from '../src/host/context.js';
import type { SessionStore } from '../src/types/sessions.js';
import type { SessionEvent, SessionTurn } from '../src/types/triggers.js';
import { claude, createHost, hello, hostTools, machine, peer, resetSdk, sessionQueries } from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * What a session does, as the stream a wake rule reads.
 *
 * The host's dispatch is where every chat action passes, so what is checked
 * here is the reading of those actions: which session a chat belongs to, what
 * the turn that just ended had been doing, and what waits behind it. A rule
 * about sessions is written against that and none of it is on the wire, so the
 * actions are the input and these are the only tests that can see it.
 */

const SESSION = 'echo:/parent-1';
const CHAT = 'echo:/parent-1/lead';
const WORKER = 'echo:/parent-1/worker';
const CHILD = 'echo:/child-1';
const CHILD_CHAT = 'echo:/child-1/lead';

/** The stream, over a stand-in for the parts of the host it reads. */
function area(over: { kept?: SessionStore; child?: boolean } = {}) {
  const byChat = new Map([[CHAT, { uri: SESSION, chat: {} }]]);
  const subagents = new Map<string, { session: string }>();
  const lead = { workingDirectories: () => ['file:///home/softov'] };
  const sessions = new Map([[SESSION, {
    defaultChat: CHAT, agent: { provider: 'echo' }, chats: new Map([[CHAT, lead]]),
  }]]);
  if (over.child === true) {
    byChat.set(CHILD_CHAT, { uri: CHILD, chat: {} });
    sessions.set(CHILD, { defaultChat: CHILD_CHAT, agent: { provider: 'echo' }, chats: new Map([[CHILD_CHAT, lead]]) });
  }
  /** What this host is running of its own, which is what makes a session one a run made. */
  const origins = new Map<string, { kind: 'automation'; automation: string; run: string }>();
  const heard: SessionEvent[] = [];
  const turns: SessionTurn[] = [];
  const moving: string[] = [];
  const kept = over.kept ?? memorySessions();
  if (over.child === true) kept.setParent?.('child-1', 'parent-1');
  const made = createSessionEvents({
    byChat,
    subagents,
    sessions,
    origins,
    kept,
    nameOf: (id: string) => `echo:/${id}`,
    leadOf: (held: { chats: Map<string, unknown>; defaultChat: string }) => held.chats.get(held.defaultChat),
    log: () => {},
  } as unknown as HostContext);
  made.watch((event) => heard.push(event));
  made.turns((turn) => turns.push(turn));
  made.moved((session) => moving.push(session));
  return { made, heard, turns, moving, subagents, origins };
}

const kinds = (heard: SessionEvent[]): string[] => heard.map((one) => one.kind);

it('emits turnCompleted, turnFailed and turnCancelled once per turn', () => {
  const { made, heard } = area();
  for (const [turn, ending] of [['t1', 'chat/turnComplete'], ['t2', 'chat/error'], ['t3', 'chat/turnCancelled']] as const) {
    made.observe(CHAT, { type: 'chat/turnStarted', turnId: turn });
    made.observe(CHAT, { type: ending, turnId: turn });
  }
  expect(kinds(heard).filter((kind) => kind !== 'idle'))
    .toEqual(['turnCompleted', 'turnFailed', 'turnCancelled']);
  // Each names the session, and says the turn is over rather than running.
  expect(heard.filter((one) => one.kind === 'turnFailed')[0]).toMatchObject({
    session: SESSION, running: false, provider: 'echo',
  });
});

it('emits toolFailed with the tool name and the input hash', () => {
  const { made, heard } = area();
  const call = (id: string, input: string, success: boolean): void => {
    made.observe(CHAT, { type: 'chat/toolCallStart', turnId: 't1', toolCallId: id, toolName: 'Bash' });
    made.observe(CHAT, { type: 'chat/toolCallReady', turnId: 't1', toolCallId: id, toolInput: input });
    made.observe(CHAT, { type: 'chat/toolCallComplete', turnId: 't1', toolCallId: id, result: { success } });
  };
  made.observe(CHAT, { type: 'chat/turnStarted', turnId: 't1' });
  call('c1', '{"command":"ls"}', false);
  call('c2', '{"command":"ls"}', true);
  call('c3', '{"command":"rm -rf /"}', true);

  expect(kinds(heard)).toEqual(['toolFailed', 'toolCalled', 'toolCalled']);
  const [failed, same, other] = heard;
  expect(failed).toMatchObject({ kind: 'toolFailed', session: SESSION, tool: { name: 'Bash' } });
  expect(failed?.tool?.inputHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  // What the hash is for: two calls of one tool with one input are the same
  // call, and a rule about "this call three times" is written on that.
  expect(same?.tool?.inputHash).toBe(failed?.tool?.inputHash);
  expect(other?.tool?.inputHash).not.toBe(failed?.tool?.inputHash);
});

it('emits messageQueued with the queue length while a turn runs', () => {
  const { made, heard } = area();
  made.observe(CHAT, { type: 'chat/turnStarted', turnId: 't1' });
  // A message into the running turn is delivered rather than waiting, so it is
  // not one of these.
  made.observe(CHAT, { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'stop' } });
  made.observe(CHAT, { type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { text: 'then this' } });
  made.observe(CHAT, { type: 'chat/pendingMessageSet', kind: 'queued', id: 'q2', message: { text: 'and this' } });
  expect(heard.map((one) => one.queued)).toEqual([1, 2]);
  expect(heard.every((one) => one.kind === 'messageQueued' && one.running === true)).toBe(true);

  // Taken off the queue when the turn it started takes it, which is not an
  // event of its own.
  made.observe(CHAT, { type: 'chat/pendingMessageRemoved', kind: 'queued', id: 'q1' });
  expect(kinds(heard)).toEqual(['messageQueued', 'messageQueued']);
});

it('emits childFinished when a subagent ends', () => {
  const { made, heard, subagents } = area();
  subagents.set(WORKER, { session: SESSION });
  made.observe(WORKER, { type: 'chat/turnStarted', turnId: 'w1' });
  // A worker's tool call is a tool call of the session that opened it.
  made.observe(WORKER, { type: 'chat/toolCallStart', turnId: 'w1', toolCallId: 'c1', toolName: 'Read' });
  made.observe(WORKER, { type: 'chat/toolCallComplete', turnId: 'w1', toolCallId: 'c1', result: { success: true } });
  made.observe(WORKER, { type: 'chat/turnComplete', turnId: 'w1' });

  expect(kinds(heard)).toEqual(['toolCalled', 'childFinished']);
  // Said on the session that opened the worker, because the worker is a chat
  // and not a session - and it names the worker that finished.
  expect(heard[1]).toMatchObject({ kind: 'childFinished', session: SESSION, child: WORKER });
});

it('emits childFinished on the session that started a child, and keeps the parent link', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ahpd-parents-'));
  const first = fileSessions({ dir });
  first.setParent?.('child-1', 'parent-1');
  first.close?.();
  // Read back by a store that has only the file, which is the restart this is
  // kept for: the child can end long after the process that started it.
  const kept = fileSessions({ dir });
  expect(kept.parent?.('child-1')).toBe('parent-1');

  const { made, heard } = area({ kept });
  made.ended('echo:/child-1');
  expect(heard).toEqual([expect.objectContaining({
    kind: 'childFinished', session: 'echo:/parent-1', child: 'echo:/child-1',
  })]);
  // A session nothing started says nothing, and neither does a child whose
  // parent is not running here.
  made.ended('echo:/child-2');
  kept.setParent?.('child-3', 'gone');
  made.ended('echo:/child-3');
  expect(kinds(heard)).toEqual(['childFinished']);
});

it('emits childFinished when a child session goes quiet, and again on a later turn', () => {
  const { made, heard } = area({ child: true });
  made.observe(CHILD_CHAT, { type: 'chat/turnStarted', turnId: 'c1' });
  made.observe(CHILD_CHAT, { type: 'chat/turnComplete', turnId: 'c1' });
  // The session that started it hears as soon as there is nothing left for the
  // child to say, rather than waiting for somebody to dispose of it.
  expect(heard.filter((one) => one.kind === 'childFinished')).toEqual([expect.objectContaining({
    session: SESSION, child: CHILD, running: false, queued: 0,
  })]);

  // A child with something queued behind its turn is a child still working.
  made.observe(CHILD_CHAT, { type: 'chat/turnStarted', turnId: 'c2' });
  made.observe(CHILD_CHAT, { type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { text: 'more' } });
  made.observe(CHILD_CHAT, { type: 'chat/turnComplete', turnId: 'c2' });
  expect(heard.filter((one) => one.kind === 'childFinished')).toHaveLength(1);

  // And the next turn says it again, because the parent may have its own news
  // by then and this is what it waits to hear.
  made.observe(CHILD_CHAT, { type: 'chat/pendingMessageRemoved', kind: 'queued', id: 'q1' });
  made.observe(CHILD_CHAT, { type: 'chat/turnStarted', turnId: 'c3' });
  made.observe(CHILD_CHAT, { type: 'chat/turnComplete', turnId: 'c3' });
  expect(heard.filter((one) => one.kind === 'childFinished')).toHaveLength(2);
});

it('reads the session of every chat that moves, and says nothing else about it', () => {
  const { made, heard, moving, subagents } = area();
  made.observe(CHAT, { type: 'chat/turnStarted', turnId: 't1' });
  made.observe(CHAT, { type: 'chat/delta', turnId: 't1', content: 'one' });
  made.observe(CHAT, { type: 'chat/reasoning', turnId: 't1', content: 'hmm' });
  made.observe(CHAT, { type: 'chat/toolCallStart', turnId: 't1', toolCallId: 'c1', toolName: 'Bash' });
  made.observe(CHAT, { type: 'chat/toolCallReady', turnId: 't1', toolCallId: 'c1', toolInput: '{"command":"ls"}' });
  made.observe(CHAT, { type: 'chat/toolCallDelta', turnId: 't1', toolCallId: 'c1', invocationMessage: 'running' });

  // Words and calls are not events: a rule is written on what a session did,
  // and none of this is a kind. What it is, is a session that is working - so a
  // turn streaming an answer or running a tool is not one that has gone quiet.
  expect(moving).toEqual([SESSION, SESSION, SESSION, SESSION, SESSION]);
  expect(heard).toEqual([]);

  // A worker chat's own work is the session doing something too, and a chat
  // that is neither says nothing about anybody.
  subagents.set(WORKER, { session: SESSION });
  made.observe(WORKER, { type: 'chat/delta', turnId: 'w1', content: 'one' });
  made.observe('echo:/nobody/lead', { type: 'chat/delta', turnId: 'n1', content: 'one' });
  expect(moving).toEqual([SESSION, SESSION, SESSION, SESSION, SESSION, SESSION]);
});

it('stops holding what a chat that is gone was doing', () => {
  const { made, heard } = area();
  made.observe(CHAT, { type: 'chat/turnStarted', turnId: 't1' });
  made.observe(CHAT, { type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { text: 'one more' } });
  made.observe(CHAT, { type: 'chat/toolCallStart', turnId: 't1', toolCallId: 'c1', toolName: 'Bash' });
  made.forget(CHAT);

  // A name a client uses again is a new chat rather than this one coming back,
  // so a call that was half-run here is not a call at all - and the turn is not
  // open and nothing waits behind it.
  made.observe(CHAT, { type: 'chat/toolCallComplete', turnId: 't1', toolCallId: 'c1', result: { success: true } });
  expect(heard.at(-1)).toMatchObject({
    kind: 'toolCalled', session: SESSION, running: false, queued: 0, tool: { name: '' },
  });
  // And the words are the only thing left: nothing is asked about the chat.
  made.observe(CHAT, { type: 'chat/turnComplete', turnId: 't1' });
  expect(heard.at(-1)).toMatchObject({ kind: 'idle', running: false, queued: 0 });
});

it('emits idle when the last turn ends and nothing is queued', () => {
  const { made, heard } = area();
  made.observe(CHAT, { type: 'chat/turnStarted', turnId: 't1' });
  made.observe(CHAT, { type: 'chat/turnComplete', turnId: 't1' });
  expect(kinds(heard)).toEqual(['turnCompleted', 'idle']);

  // A turn with a message waiting behind it is not a session going quiet, so
  // nothing is said until the queue is empty.
  made.observe(CHAT, { type: 'chat/turnStarted', turnId: 't2' });
  made.observe(CHAT, { type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { text: 'one more' } });
  made.observe(CHAT, { type: 'chat/turnComplete', turnId: 't2' });
  made.observe(CHAT, { type: 'chat/turnStarted', turnId: 't3' });
  made.observe(CHAT, { type: 'chat/pendingMessageRemoved', kind: 'queued', id: 'q1' });
  made.observe(CHAT, { type: 'chat/turnComplete', turnId: 't3' });

  expect(kinds(heard).filter((kind) => kind === 'idle')).toHaveLength(2);
  expect(heard.at(-1)).toMatchObject({ kind: 'idle', running: false, queued: 0 });
});

it('counts the tool calls of the running turn on each event', () => {
  const { made, heard } = area();
  made.observe(CHAT, { type: 'chat/turnStarted', turnId: 't1' });
  for (const id of ['c1', 'c2']) {
    made.observe(CHAT, { type: 'chat/toolCallStart', turnId: 't1', toolCallId: id, toolName: 'Read' });
    made.observe(CHAT, { type: 'chat/toolCallComplete', turnId: 't1', toolCallId: id, result: { success: true } });
  }
  made.observe(CHAT, { type: 'chat/turnComplete', turnId: 't1' });

  expect(heard.filter((one) => one.kind === 'toolCalled').map((one) => one.turnToolCalls)).toEqual([1, 2]);
  // And the turn that ended says what it had run, which is what a rule about a
  // turn that ran long and called nothing reads.
  expect(heard.find((one) => one.kind === 'turnCompleted')?.turnToolCalls).toBe(2);
});

it('says where the session works and whether a run made it, on every event', () => {
  const { made, heard, origins } = area();
  origins.set(SESSION, { kind: 'automation', automation: 'ahp-automation:/triage', run: 'ahp-automation-run:/one' });
  made.observe(CHAT, { type: 'chat/turnStarted', turnId: 't1' });
  made.observe(CHAT, { type: 'chat/toolCallStart', turnId: 't1', toolCallId: 'c1', toolName: 'Read' });
  made.observe(CHAT, { type: 'chat/toolCallComplete', turnId: 't1', toolCallId: 'c1', result: { success: true } });
  made.observe(CHAT, { type: 'chat/turnComplete', turnId: 't1' });

  // Both are facts the host settles before an event is read, so a rule may
  // filter on them without the engine asking anybody.
  expect(heard.length).toBeGreaterThan(1);
  expect(heard.every((one) => one.folders.join() === 'file:///home/softov' && one.automated)).toBe(true);
});

it('says a turn started, which is what a rule about a long turn is measured from', () => {
  const { made, turns, subagents } = area();
  made.observe(CHAT, { type: 'chat/turnStarted', turnId: 't1' });
  expect(turns).toHaveLength(1);
  expect(turns[0]).toMatchObject({
    session: SESSION, folders: ['file:///home/softov'], automated: false,
  });

  // A worker chat's turn is the session doing something rather than the turn
  // of the session itself, so nothing is measured from it.
  subagents.set(WORKER, { session: SESSION });
  made.observe(WORKER, { type: 'chat/turnStarted', turnId: 'w1' });
  expect(turns).toHaveLength(1);
});

it('records the parent of a session the create tool started', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ahpd-made-'));
  const kept = fileSessions({ dir });
  const host = createHost({
    path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), tools: hostTools(), sessions: kept,
  });
  const client = host.accept(peer());
  await client.handle(hello(['0.9.0']));
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/parent', provider: 'claude' } });

  const servers = sessionQueries().at(-1)?.options.mcpServers as Record<string, { tools: {
    name: string; handler: (input: unknown) => Promise<{ content: { text: string }[] }>;
  }[] }>;
  const create = servers.ahp?.tools.find((one) => one.name === 'create_session');
  const said = await create?.handler({
    relationship: 'independent', workspace: '/home/softov', title: 'Child', prompt: 'go', worktree: false,
  });
  const child = /agent-host-session:\/\/claude\/([0-9a-f-]+)/.exec(said?.content[0]?.text ?? '')?.[1] as string;
  expect(child).toBeTruthy();
  // The link is on the child, kept with the rest of what this host knows about
  // it, and written down rather than held: a daemon that restarts still knows
  // which session to tell when this child ends.
  expect(kept.parent?.(child)).toBe('parent');
  kept.close?.();
  expect(fileSessions({ dir }).parent?.(child)).toBe('parent');
});
