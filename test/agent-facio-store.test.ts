import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { textOf } from '@facio/agents';
import { createFakeModel } from '@facio/agents/testing';
import { createFileStore } from '@facio/store-file';
import type { Message, ModelAdapter, Policy } from '@facio/agents';
import type { Agent, Bag, BoundTool, Listed, Start } from '@ahpd/sdk';
import { facioAgent } from '../packages/agent-facio/src/index.js';

/*
 * The catalogue, the transcript and a resume, over a file store.
 *
 * No network and no real model: the adapter is a script and each test builds
 * the backend directly, so the store the catalogue reads and the store the
 * session writes are the same object and a second backend over the same
 * directory is a restart. What this checks is that a conversation left on
 * disk can be listed, read back part by part, and continued - paused or
 * finished - under the facio session id it already had.
 */

/** Let the run's zero-delay work finish, up to a point; no wall-clock waiting on a real model. */
const until = async (check: () => boolean, times = 400): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

type Note = { channel: 'session' | 'chat' | 'terminal'; action: Bag };

/** One session's channels, collected the way the host would dispatch them. */
function channels() {
  const notes: Note[] = [];
  return {
    notes,
    emit: (channel: 'session' | 'chat' | 'terminal', action: Bag): void => { notes.push({ channel, action }); },
    types: (channel: string): string[] =>
      notes.filter((one) => one.channel === channel).map((one) => String(one.action.type)),
    said: (channel: string, kind: string): Bag | undefined =>
      notes.find((one) => one.channel === channel && one.action.type === kind)?.action,
  };
}

/**
 * Wait until the store says a session's newest run is waiting on a person.
 *
 * The `inputNeededSet` action is published before the run record is moved to
 * `awaiting`, so a test that restarts on the action alone can read a run that
 * is still `running`.
 */
const pausedRun = async (root: string, sessionId: string): Promise<void> => {
  const store = createFileStore({ root });
  for (let i = 0; i < 400; i++) {
    const runs = await store.runs.list({ sessionId });
    if (runs[0]?.status === 'awaiting') return;
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

/** A directory a store and a workspace can both live under. */
const place = (): { root: string; sweep: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-facio-store-'));
  return { root: join(dir, 'store'), sweep: join(dir, 'work') };
};

/** One backend over a file store, with a model scripted and the policy the test wants. */
const backend = (root: string, model: ModelAdapter, policy?: Partial<Policy>): Agent =>
  facioAgent({ adapter: model, store: root, ...(policy !== undefined ? { policy } : {}) });

/** Open one session on a backend, with everything the harness would have handed it. */
function open(agent: Agent, id: string, workingDirectory: string, extra: Partial<Start> = {}) {
  const view = channels();
  const session = agent.create({
    uri: `ahp-session:/${id}`,
    chatUri: `ahp-chat:/${id}`,
    settings: agent.defaults(),
    workingDirectory,
    schema: () => agent.schema(),
    emit: view.emit,
    ...extra,
  });
  return { session, view, uri: `ahp-session:/${id}`, chatUri: `ahp-chat:/${id}` };
}

/** A policy that lets every tool run, so only the tests that ask get a pause. */
const allowAll = (): Partial<Policy> => ({ decide: () => ({ behavior: 'allow' }) });

/** A tool that records that it ran, so a resume can show it reached execution. */
const lookup = (ran: string[]): BoundTool => ({
  definition: {
    name: 'lookup',
    title: 'Look something up',
    description: 'Looks a word up.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  run: (input) => {
    ran.push(String(input.query));
    return `found ${String(input.query)}`;
  },
});

const ended = (view: ReturnType<typeof channels>): boolean =>
  view.types('chat').some((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled');

it('lists a session that was created and torn down, with its workspace and title', async () => {
  const { root, sweep } = place();
  const model = createFakeModel({ script: [{ text: 'hi there' }], stream: true });
  const agent = backend(root, model, allowAll());
  const one = open(agent, 'one', sweep);
  one.session.begin('t1', 'remember the number 41');
  await until(() => ended(one.view));
  one.session.close();

  const listed = await agent.list?.();
  expect(listed).toHaveLength(1);
  expect(listed?.[0]).toMatchObject({
    id: 'one',
    title: 'remember the number 41',
    workingDirectories: [`file://${sweep}`],
  } satisfies Partial<Listed>);
  // The timestamps are the store's, so a row says when the conversation moved.
  expect(Date.parse(String(listed?.[0]?.createdAt))).not.toBeNaN();
  expect(Date.parse(String(listed?.[0]?.modifiedAt))).not.toBeNaN();
});

it('rebuilds a turn with its text, its reasoning and its tool call in order', async () => {
  const { root, sweep } = place();
  const model = createFakeModel({
    script: [
      {
        reasoning: 'weighing it up',
        text: 'let me look',
        toolCalls: [{ name: 'lookup', input: { query: 'x' }, callId: 'call-1' }],
      },
      { text: 'found it' },
    ],
    stream: true,
  });
  const agent = backend(root, model, allowAll());
  const one = open(agent, 'one', sweep, { tools: [lookup([])] });
  one.session.begin('t1', 'hello there');
  await until(() => ended(one.view));
  one.session.close();

  const turns = await agent.transcript?.('one');
  expect(turns).toHaveLength(1);
  const turn = turns?.[0];
  expect(turn?.message).toMatchObject({ text: 'hello there', origin: { kind: 'user' } });
  expect(turn?.state).toBe('complete');
  const parts = (turn?.responseParts ?? []) as Bag[];
  // The order facio recorded, which is what keeps a tool call beside its
  // answer rather than after it.
  expect(parts.map((part) => String(part.kind))).toEqual(['reasoning', 'markdown', 'toolCall', 'markdown']);
  expect(parts[0]?.content).toBe('weighing it up');
  expect(parts[1]?.content).toBe('let me look');

  const call = parts[2]?.toolCall as Bag;
  expect(call).toMatchObject({ toolCallId: 'call-1', toolName: 'lookup', status: 'completed', success: true });
  expect(call.pastTenseMessage).toBe('lookup');
  expect(call.content).toEqual([{ type: 'text', text: 'found x' }]);
  // The timing rides `_meta`: AHP's tool-call states have no duration field.
  expect((call._meta as Bag).durationMs).toEqual(expect.any(Number));
  expect(parts[3]?.content).toBe('found it');
});

it('answers undefined for a session the store does not know and empty for one with nothing said', async () => {
  const { root, sweep } = place();
  const model = createFakeModel({ script: [{ text: 'unused' }], stream: true });
  const agent = backend(root, model, allowAll());

  expect(await agent.transcript?.('nobody')).toBeUndefined();

  const store = createFileStore({ root });
  await store.sessions.create({ sessionId: 'empty', agentId: 'facio', workspace: sweep });
  expect(await agent.transcript?.('empty')).toEqual([]);
  // The empty session is a row all the same: it exists, it has just said
  // nothing yet.
  expect((await agent.list?.())?.map((row) => row.id)).toContain('empty');
});

it('reopens a paused run through start.resume without replaying the input', async () => {
  const { root, sweep } = place();
  const ran: string[] = [];
  const asks: Partial<Policy> = {
    decide: ({ tool }) => (tool.name === 'lookup' ? { behavior: 'ask' } : { behavior: 'allow' }),
  };
  const tool = lookup(ran);

  // The first process: one turn that pauses on the approval and stays open.
  const first = backend(root, createFakeModel({
    script: [{ toolCalls: [{ name: 'lookup', input: { query: 'x' }, callId: 'call-1' }] }],
    stream: true,
  }), asks);
  const before = open(first, 'one', sweep, { tools: [tool] });
  before.session.begin('t1', 'hi');
  await until(() => before.view.said('session', 'session/inputNeededSet') !== undefined);
  /*
   * Wait for the pause to be persisted, not only announced: the request event
   * precedes the run record's `awaiting`, and a restart that read the store in
   * between would find a run still `running` and refuse to rejoin it.
   */
  await pausedRun(root, 'one');
  /*
   * The first process is abandoned rather than closed. `close()` stops the
   * run, and stopping a paused one answers its open request with a denial, so
   * a graceful end is not the restart this is about: the point is a process
   * that went away leaving the run `awaiting`.
   */
  expect(before.view.said('chat', 'chat/toolCallReady')?.confirmationTitle).toBeDefined();

  // The restart: a second backend over the same directory, told to continue
  // the same facio session.
  const second = backend(root, createFakeModel({ script: [{ text: 'done' }], stream: true }), asks);
  const after = open(second, 'one', sweep, { resume: 'one', tools: [tool] });
  expect(after.session.agentId()).toBe('one');
  await until(() => after.view.said('session', 'session/inputNeededSet') !== undefined);

  // The open request was re-raised by the replay, and answering it reaches
  // the run the first process left waiting.
  const entry = after.view.said('session', 'session/inputNeededSet');
  expect((entry?.request as Bag | undefined)?.kind).toBe('toolConfirmation');
  await until(() => after.view.said('chat', 'chat/toolCallStart') !== undefined);
  after.session.confirm('call-1', true);
  await until(() => ended(after.view));

  expect(ran).toEqual(['x']);
  expect(after.view.types('chat').at(-1)).toBe('chat/turnComplete');

  // One facio session, one run, and the input written once: the rejoin
  // continued the conversation rather than starting it over.
  const reader = createFileStore({ root });
  const runs = await reader.runs.list({ sessionId: 'one' });
  expect(runs).toHaveLength(1);
  expect(runs[0]?.status).toBe('completed');
  const messages = await reader.sessions.listMessages({ sessionId: 'one' });
  expect(messages.filter((one: Message) => one.role === 'user' && textOf(one) === 'hi')).toHaveLength(1);
});

it('appends a new run under the same session id when a finished session is resumed', async () => {
  const { root, sweep } = place();
  const first = backend(root, createFakeModel({ script: [{ text: 'first' }], stream: true }), allowAll());
  const before = open(first, 'one', sweep);
  before.session.begin('t1', 'say first');
  await until(() => ended(before.view));
  before.session.close();

  const second = backend(root, createFakeModel({ script: [{ text: 'second' }], stream: true }), allowAll());
  const after = open(second, 'one', sweep, { resume: 'one', seed: [] });
  after.session.begin('t2', 'say second');
  await until(() => ended(after.view));

  expect(after.session.agentId()).toBe('one');
  const reader = createFileStore({ root });
  const runs = await reader.runs.list({ sessionId: 'one' });
  expect(runs).toHaveLength(2);
  expect(runs.every((run) => run.sessionId === 'one')).toBe(true);
  const messages = await reader.sessions.listMessages({ sessionId: 'one' });
  expect(messages.filter((one: Message) => one.role === 'user' && one.source === 'input')).toHaveLength(2);
  // The past turn is still readable, now with the new one beside it.
  expect(await second.transcript?.('one')).toHaveLength(2);
});

it('stops listing a session that the store no longer has', async () => {
  const { root, sweep } = place();
  const model = createFakeModel({ script: [{ text: 'gone' }], stream: true });
  const agent = backend(root, model, allowAll());
  const one = open(agent, 'one', sweep);
  one.session.begin('t1', 'still here');
  await until(() => ended(one.view));
  one.session.close();
  expect((await agent.list?.())?.map((row) => row.id)).toEqual(['one']);

  await createFileStore({ root }).sessions.delete({ sessionId: 'one' });
  expect(await agent.list?.()).toEqual([]);
  expect(await agent.transcript?.('one')).toBeUndefined();
});
