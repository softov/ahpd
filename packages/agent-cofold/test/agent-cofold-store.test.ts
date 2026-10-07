import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { textOf } from '@cofold/agents';
import { createFakeModel, createMemoryStore } from '@cofold/agents/testing';
import { createFileStore } from '@cofold/store-file';
import type { Message, MessageSource, ModelAdapter, ModelReply, ModelStreamEvent, Policy, RunEvent, Store } from '@cofold/agents';
import { chatReducer } from '@microsoft/agent-host-protocol';
import type { ChatAction, ChatState } from '@microsoft/agent-host-protocol';
import { uriOf } from '@ahpd/sdk';
import type { Agent, Bag, BoundTool, Listed, Start } from '@ahpd/sdk';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/clientcalls.js';
import { cofoldAgent, turnsOf } from '../src/index.js';

/**
 * Every store made in this file, in the order they were made.
 *
 * `cofoldAgent` builds its own store from its options, so a case that wants to
 * count what `find` reads has to hold the object the backend actually reads -
 * and that is the store `createFileStore` answered for it.
 */
const made = vi.hoisted(() => [] as Store[]);

vi.mock('@cofold/store-file', async (original) => {
  const actual = await original<typeof import('@cofold/store-file')>();
  return {
    ...actual,
    createFileStore: (options: { root: string }) => {
      const store = actual.createFileStore(options);
      made.push(store);
      return store;
    },
  };
});

/*
 * The catalogue, the transcript and a resume, over a file store.
 *
 * No network and no real model: the adapter is a script and each test builds
 * the backend directly, so the store the catalogue reads and the store the
 * session writes are the same object and a second backend over the same
 * directory is a restart. What this checks is that a conversation left on
 * disk can be listed, read back part by part, and continued - paused or
 * finished - under the cofold session id it already had.
 */

/**
 * Waits for `check` to hold, turning the event loop, and throws once `ms` of
 * wall-clock time has passed, inside the case's own limit so a wait that runs
 * out fails on its own message rather than letting the case read on. `seen`
 * describes what had arrived, for the message.
 */
const until = async (check: () => boolean, ms = 4000, seen?: () => string): Promise<void> => {
  const limit = Date.now() + ms;
  while (!check()) {
    if (Date.now() > limit) throw new Error(seen === undefined ? 'timed out waiting' : `timed out waiting; seen: ${seen()}`);
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

type Note = { channel: 'session' | 'chat' | 'terminal'; action: Bag };

/** One session's channels, collected the way the host would dispatch them. */
function channels(onEmit?: (channel: 'session' | 'chat' | 'terminal', action: Bag) => void) {
  const notes: Note[] = [];
  return {
    notes,
    emit: (channel: 'session' | 'chat' | 'terminal', action: Bag): void => {
      notes.push({ channel, action });
      onEmit?.(channel, action);
    },
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
const pausedRun = async (root: string, sessionId: string, ms = 4000): Promise<void> => {
  const store = createFileStore({ root });
  const limit = Date.now() + ms;
  for (;;) {
    const runs = await store.runs.list({ sessionId });
    if (runs[0]?.status === 'awaiting') return;
    if (Date.now() > limit) throw new Error('timed out waiting for the run to be awaiting');
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

/** A directory a store and a workspace can both live under. */
const place = (): { root: string; sweep: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-cofold-store-'));
  return { root: join(dir, 'store'), sweep: join(dir, 'work') };
};

/** One backend over a file store, with a model scripted and the policy the test wants. */
const backend = (root: string, model: ModelAdapter, policy?: Partial<Policy>): Agent =>
  cofoldAgent({ adapter: model, store: root, ...(policy !== undefined ? { policy } : {}) });

/** Open one session on a backend, with everything the harness would have handed it. */
function open(
  agent: Agent,
  id: string,
  workingDirectory: string,
  extra: Partial<Start> = {},
  onEmit?: (channel: 'session' | 'chat' | 'terminal', action: Bag) => void,
) {
  const view = channels(onEmit);
  const session = agent.create({
    uri: `ahp-session:/${id}`,
    chatUri: `ahp-chat:/${id}`,
    settings: agent.defaults(),
    workingDirectory,
    schema: () => agent.schema(),
    emit: view.emit,
    // The host always resolves this, and its own answer when the deployment
    // said nothing is ten minutes.
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
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

it('answers a session on disk with the row the listing answers, title and workspace included', async () => {
  const { root, sweep } = place();
  const model = createFakeModel({ script: [{ text: 'hi there' }], stream: true });
  const agent = backend(root, model, allowAll());
  const one = open(agent, 'one', sweep);
  one.session.begin('t1', 'remember the number 41');
  await until(() => ended(one.view));
  one.session.close();

  const listed = (await agent.list?.())?.find((row) => row.id === 'one');
  const found = await agent.find?.('one');
  // The one row, so a row found by id is the row a listing would have offered
  // and the next refresh has nothing to say about it.
  expect(listed).toBeDefined();
  expect(found).toEqual(listed);
  expect(found).toMatchObject({
    id: 'one',
    title: 'remember the number 41',
    workingDirectories: [uriOf(sweep)],
  } satisfies Partial<Listed>);
});

it('finds a session written after the last listing, and nothing for one the store does not have', async () => {
  const { root, sweep } = place();
  // One step per turn: the first conversation, then the one after the listing.
  const model = createFakeModel({ script: [{ text: 'hi' }, { text: 'said later' }], stream: true });
  const agent = backend(root, model, allowAll());
  const one = open(agent, 'one', sweep);
  one.session.begin('t1', 'the first one');
  await until(() => ended(one.view));
  one.session.close();
  expect((await agent.list?.())?.map((row) => row.id)).toEqual(['one']);

  // A conversation that happened after that listing: `find` reads the store
  // when it is asked, so the row is there although no listing has seen it.
  const two = open(agent, 'late', sweep);
  two.session.begin('t2', 'said later');
  await until(() => ended(two.view));
  two.session.close();

  expect((await agent.find?.('late'))?.title).toBe('said later');
  expect(await agent.find?.('nobody')).toBeUndefined();
});

it('reads one record and never lists the store', async () => {
  const { root, sweep } = place();
  const before = made.length;
  const model = createFakeModel({ script: [{ text: 'hi' }], stream: true });
  const agent = backend(root, model, allowAll());
  const store = made[before] as Store;
  const one = open(agent, 'one', sweep);
  one.session.begin('t1', 'hello');
  await until(() => ended(one.view));
  one.session.close();

  const listing = vi.spyOn(store.sessions, 'list');
  let found;
  try { found = await agent.find?.('one'); }
  finally { listing.mockRestore(); }
  expect(found?.id).toBe('one');
  expect(listing).not.toHaveBeenCalled();
});

it('reports the folder a session works in as a URI a host reads back as that folder', () => {
  /*
   * The session's own directory, as the host reads it back. `file://` with the
   * path as it is puts a raw `#` on the wire, and a reader that takes `#` for a
   * fragment - which is what node and every client do - opens `C` where the
   * folder is called `C# a b`, and opens `C# a b` where the real name has a
   * space in it. This is the directory a turn's tools and a diff's base come
   * from, so both wrong answers are commands run somewhere else.
   */
  const { root } = place();
  const where = join(root, 'C# a b');
  mkdirSync(where, { recursive: true });
  const model = createFakeModel({ script: [{ text: 'hi' }], stream: true });
  const agent = backend(root, model, allowAll());
  const one = open(agent, 'uris', where);
  const asked = [uriOf(where)];
  expect(one.session.workingDirectories()).toEqual(asked);
  expect((one.session.sessionState() as { workingDirectories: string[] }).workingDirectories).toEqual(asked);
  one.session.close();
});

/** One model step as a script gives it: the deltas it streams, then the reply they add up to. */
type Step = { deltas: ModelStreamEvent[]; parts: Message['parts'] };

/**
 * A model that streams each step's deltas and then its reply, as a real
 * adapter does, naming its replies `m1`, `m2` and on.
 */
const scripted = (steps: Step[]): ModelAdapter => {
  let ids = 0;
  const reply = (parts: Message['parts']): ModelReply => ({
    message: { id: `m${++ids}`, role: 'assistant', source: 'model', createdAt: new Date().toISOString(), parts },
    usage: { inputTokens: 1, outputTokens: 1 },
    finish: parts.some((one) => one.type === 'toolCall') ? 'tool_calls' : 'stop',
  });
  return {
    id: 'thinker',
    modelId: 'thinker',
    features: { tools: true, streaming: true, images: false, structuredOutput: false, reasoning: true },
    complete: async () => reply([{ type: 'text', text: 'not streamed' }]),
    stream: async function* (): AsyncIterable<ModelStreamEvent> {
      const step = steps.shift();
      if (step === undefined) throw new Error('the script is done');
      yield* step.deltas;
      yield { type: 'done', reply: reply(step.parts) };
    },
  };
};

/** The first turn's parts as a client watching the chat drew them, folded as it folds. */
const drawn = (view: ReturnType<typeof channels>): Bag[] => {
  let state = { turns: [], status: 0, modifiedAt: 'now' } as unknown as ChatState;
  for (const note of view.notes.filter((held) => held.channel === 'chat')) {
    state = chatReducer(state, note.action as unknown as ChatAction);
  }
  return (state.turns[0]?.responseParts ?? []) as unknown as Bag[];
};

/** Each part's kind and what it holds, a call's being its call id. */
const shape = (parts: Bag[]): unknown[] => parts.map((part) => [
  part.kind,
  part.kind === 'toolCall' ? (part.toolCall as Bag).toolCallId : part.content,
]);

/** A part's id, a call's being its call id. */
const idOf = (part: Bag): unknown => (part.kind === 'toolCall' ? (part.toolCall as Bag).toolCallId : part.id);

/**
 * One turn run to its end on a scripted model: the chat actions sent, what a
 * client drew from them, and what the transcript reads back.
 */
const played = async (steps: Step[], tools: BoundTool[] = [lookup([])]): Promise<{ said: Bag[]; live: Bag[]; read: Bag[] }> => {
  const { root, sweep } = place();
  const agent = backend(root, scripted(steps), allowAll());
  const one = open(agent, 'one', sweep, { tools });
  one.session.begin('t1', 'hello there');
  await until(() => ended(one.view));
  one.session.close();
  const turns = await agent.transcript?.('one');
  return {
    said: one.view.notes.filter((held) => held.channel === 'chat').map((held) => held.action),
    live: drawn(one.view),
    read: (turns?.[0]?.responseParts ?? []) as Bag[],
  };
};

/** A tool under one of cofold's own names, answering `ran` whatever it is given. */
const stub = (name: string): BoundTool => ({
  definition: { name, description: name, inputSchema: { type: 'object' } },
  run: () => 'ran',
});

it.each([
  ['shell_exec', { command: 'ls' }, 'ls'],
  ['read_file', { path: 'a.ts' }, 'a.ts'],
  ['write_file', { path: 'b.ts', content: '' }, 'b.ts'],
  ['edit_file', { path: 'c.ts', edits: [] }, 'c.ts'],
  ['memory_write', { path: 'notes.md', content: '' }, 'notes.md'],
  ['search_files', { pattern: 'TODO' }, 'TODO'],
  ['list_files', { pattern: '*.ts' }, '*.ts'],
  ['web_fetch', { url: 'https://example.com/' }, 'https://example.com/'],
  ['web_search', { query: 'cofold' }, 'cofold'],
  ['lookup', { query: 'x' }, 'lookup'],
])('draws a %s call by what it runs on, live and read back', async (name, input, described) => {
  const { said, live, read } = await played([
    { deltas: [], parts: [{ type: 'toolCall', callId: 'c1', name, input, raw: JSON.stringify(input) }] },
    { deltas: [{ type: 'text.delta', text: 'done' }], parts: [{ type: 'text', text: 'done' }] },
  ], [stub(name)]);
  expect(said.find((action) => action.type === 'chat/toolCallReady')?.invocationMessage).toBe(described);
  expect((said.find((action) => action.type === 'chat/toolCallComplete')?.result as Bag).pastTenseMessage).toBe(described);
  const drew = live.find((part) => part.kind === 'toolCall')?.toolCall as Bag;
  const readBack = read.find((part) => part.kind === 'toolCall')?.toolCall as Bag;
  expect(drew).toMatchObject({ invocationMessage: described, pastTenseMessage: described });
  expect(readBack).toMatchObject({ invocationMessage: described, pastTenseMessage: described });
});

it('shows live the parts its transcript rebuilds, in the order the model wrote them', async () => {
  // A model that thinks, calls a tool, thinks again and answers.
  const { live, read } = await played([
    {
      deltas: [{ type: 'reasoning.delta', text: 'THINK-' }, { type: 'reasoning.delta', text: '1' }],
      parts: [
        { type: 'reasoning', text: 'THINK-1' },
        { type: 'toolCall', callId: 'c1', name: 'lookup', input: { query: 'x' }, raw: '{"query":"x"}' },
      ],
    },
    {
      deltas: [{ type: 'reasoning.delta', text: 'THINK-2' }, { type: 'text.delta', text: 'REPLY' }],
      parts: [{ type: 'reasoning', text: 'THINK-2' }, { type: 'text', text: 'REPLY' }],
    },
  ]);
  expect(shape(live)).toEqual([['reasoning', 'THINK-1'], ['toolCall', 'c1'], ['reasoning', 'THINK-2'], ['markdown', 'REPLY']]);
  expect(shape(read)).toEqual(shape(live));
  /*
   * Each part named by its step and its place in it, as the transcript names
   * it by the reply's message and its place there. cofold mints the message
   * id once the reply is whole, after its deltas, so live has the step.
   */
  expect(live.map(idOf)).toEqual(['t1:1:0', 'c1', 't1:2:0', 't1:2:1']);
  expect(read.map(idOf)).toEqual(['m1:0', 'c1', 'm2:0', 'm2:1']);
});

it('opens no part for text that is only whitespace, live or read back', async () => {
  // Kimi K2.6's shape: a blank text between each thought and its call.
  const { live, read } = await played([
    {
      deltas: [{ type: 'reasoning.delta', text: 'THINK-1' }, { type: 'text.delta', text: ' ' }],
      parts: [
        { type: 'reasoning', text: 'THINK-1' },
        { type: 'text', text: ' ' },
        { type: 'toolCall', callId: 'c1', name: 'lookup', input: { query: 'x' }, raw: '{"query":"x"}' },
      ],
    },
    {
      deltas: [{ type: 'reasoning.delta', text: 'THINK-2' }, { type: 'text.delta', text: 'REPLY' }],
      parts: [{ type: 'reasoning', text: 'THINK-2' }, { type: 'text', text: 'REPLY' }],
    },
  ]);
  expect(shape(live)).toEqual([['reasoning', 'THINK-1'], ['toolCall', 'c1'], ['reasoning', 'THINK-2'], ['markdown', 'REPLY']]);
  expect(shape(read)).toEqual(shape(live));
  expect(live.map(idOf)).toEqual(['t1:1:0', 'c1', 't1:2:0', 't1:2:1']);
  // The blank block keeps its place in the message, so `m1:1` names nothing.
  expect(read.map(idOf)).toEqual(['m1:0', 'c1', 'm2:0', 'm2:1']);
});

it('keeps the whitespace a reply starts with in its one part, live and read back', async () => {
  const { said, live, read } = await played([{
    deltas: [{ type: 'text.delta', text: ' ' }, { type: 'text.delta', text: '\n' }, { type: 'text.delta', text: 'REPLY' }],
    parts: [{ type: 'text', text: ' \nREPLY' }],
  }]);
  // Held until the words arrive, then sent ahead of them in the part they open.
  expect(said.filter((action) => action.type === 'chat/delta').map((action) => action.content)).toEqual([' \nREPLY']);
  expect(shape(live)).toEqual([['markdown', ' \nREPLY']]);
  expect(shape(read)).toEqual(shape(live));
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
  // The order cofold recorded, which is what keeps a tool call beside its
  // answer rather than after it.
  expect(parts.map((part) => String(part.kind))).toEqual(['reasoning', 'markdown', 'toolCall', 'markdown']);
  expect(parts[0]?.content).toBe('weighing it up');
  expect(parts[1]?.content).toBe('let me look');

  const call = parts[2]?.toolCall as Bag;
  expect(call).toMatchObject({ toolCallId: 'call-1', toolName: 'lookup', status: 'completed', success: true });
  expect(call.pastTenseMessage).toBe('lookup');
  expect(call.content).toEqual([{ type: 'text', text: 'found x' }]);
  // The timing rides `_meta`: AHP's tool-call states have no duration field.
  expect(call._meta).toMatchObject({
    'ahpd.startedAt': expect.any(String),
    'ahpd.endedAt': expect.any(String),
    'ahpd.durationMs': expect.any(Number),
  });
  expect(parts[3]?.content).toBe('found it');
});

it('rebuilds a call whose run recorded a result but no start, with a start it worked back', async () => {
  const { root, sweep } = place();
  const model = createFakeModel({
    script: [
      {
        reasoning: 'weighing it up',
        text: 'let me look',
        toolCalls: [{ name: 'shell_exec', input: { command: 'echo hi' }, callId: 'call-1' }],
      },
      { text: 'found it' },
    ],
    stream: true,
  });
  const agent = backend(root, model, allowAll());
  const one = open(agent, 'one', sweep, { tools: [] });
  one.session.begin('t1', 'hello there');
  await until(() => ended(one.view));
  one.session.close();

  // A run that lost its `tool.started`, which is what a store written by a
  // version that recorded no start - or a truncated one - looks like.
  const events = readdirSync(root, { recursive: true }).map(String)
    .filter((one) => one.endsWith('events.jsonl'));
  expect(events).toHaveLength(1);
  const file = join(root, events[0] as string);
  writeFileSync(file, readFileSync(file, 'utf8')
    .split('\n').filter((line) => line === '' || !line.includes('"tool.started"')).join('\n'));

  const parts = ((await agent.transcript?.('one'))?.[0]?.responseParts ?? []) as Bag[];
  const call = parts.find((one) => one.kind === 'toolCall')?.toolCall as Bag;
  // The end and the duration are both on file, so the start is the end less
  // the duration: three times rather than two and a gap.
  expect(call._meta).toMatchObject({
    toolKind: 'terminal',
    'ahpd.startedAt': expect.any(String),
    'ahpd.endedAt': expect.any(String),
    'ahpd.durationMs': expect.any(Number),
  });
  const meta = call._meta as Bag;
  expect(Date.parse(meta['ahpd.endedAt'] as string) - Date.parse(meta['ahpd.startedAt'] as string))
    .toBe(meta['ahpd.durationMs']);
});

it('answers undefined for a session the store does not know and empty for one with nothing said', async () => {
  const { root, sweep } = place();
  const model = createFakeModel({ script: [{ text: 'unused' }], stream: true });
  const agent = backend(root, model, allowAll());

  expect(await agent.transcript?.('nobody')).toBeUndefined();

  const store = createFileStore({ root });
  await store.sessions.create({ sessionId: 'empty', agentId: 'cofold', workspace: sweep });
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
  // the same cofold session.
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
  await until(() => ended(after.view), 4000, () => JSON.stringify(after.view.notes.map((one) => [one.channel, one.action.type, one.action.type === 'chat/toolCallComplete' || one.action.type === 'chat/error' || one.action.type === 'session/inputNeededSet' ? one.action : undefined])));

  // A silent give-up in `until` must not read as a pass: the turn this asserts
  // is the one the answer was supposed to reach.
  expect(ended(after.view)).toBe(true);
  expect(ran).toEqual(['x']);
  expect(after.view.types('chat').at(-1)).toBe('chat/turnComplete');

  // One cofold session, one run, and the input written once: the rejoin
  // continued the conversation rather than starting it over.
  const reader = createFileStore({ root });
  const runs = await reader.runs.list({ sessionId: 'one' });
  expect(runs).toHaveLength(1);
  expect(runs[0]?.status).toBe('completed');
  const messages = await reader.sessions.listMessages({ sessionId: 'one' });
  expect(messages.filter((one: Message) => one.role === 'user' && textOf(one) === 'hi')).toHaveLength(1);
});

it('answers a request the replay announced before the resumed run had a handle', async () => {
  /*
   * The window this pins is small and real: a `start.resume` replays the run's
   * history, and the replay announces the approval it is waiting on before
   * `reopen` attaches the handle that takes commands. A person answering the
   * moment the form appears - or a test polling on the action - can get their
   * answer in between, and an answer with nowhere to go used to be dropped:
   * the request left `pending`, the run left `awaiting` for ever, and the turn
   * never ended.
   *
   * The confirmation is queued as a microtask from inside the emission, which
   * is the earliest it can be sent once the request exists: `pending` is set
   * right after the actions go out and the handle is attached after the whole
   * replay, so this lands in between every time rather than under load.
   */
  const { root, sweep } = place();
  const ran: string[] = [];
  const asks: Partial<Policy> = {
    decide: ({ tool }) => (tool.name === 'lookup' ? { behavior: 'ask' } : { behavior: 'allow' }),
  };
  const tool = lookup(ran);

  const first = backend(root, createFakeModel({
    script: [{ toolCalls: [{ name: 'lookup', input: { query: 'x' }, callId: 'call-1' }] }],
    stream: true,
  }), asks);
  const before = open(first, 'one', sweep, { tools: [tool] });
  before.session.begin('t1', 'hi');
  await until(() => before.view.said('session', 'session/inputNeededSet') !== undefined);
  await pausedRun(root, 'one');

  const second = backend(root, createFakeModel({ script: [{ text: 'done' }], stream: true }), asks);
  let answer: (() => void) | undefined;
  const after = open(second, 'one', sweep, { resume: 'one', tools: [tool] }, (channel, action) => {
    if (answer === undefined) return;
    if (channel !== 'session' || action.type !== 'session/inputNeededSet') return;
    const send = answer;
    answer = undefined;
    queueMicrotask(send);
  });
  answer = () => after.session.confirm('call-1', true);

  await until(() => ended(after.view));
  expect(ended(after.view)).toBe(true);
  expect(ran).toEqual(['x']);
  expect(after.view.types('chat').at(-1)).toBe('chat/turnComplete');
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

it('rebuilds a turn with the model it ran on, after a restart', async () => {
  const { root, sweep } = place();
  const first = backend(root, createFakeModel({ script: [{ text: 'ok' }], stream: true }), allowAll());
  const before = open(first, 'one', sweep);
  before.session.begin('t1', 'hi', { id: 'open_router/x' });
  await until(() => ended(before.view));
  before.session.close();

  // The restart: a fresh backend over the same directory reads the store alone.
  const second = backend(root, createFakeModel({ script: [{ text: 'unused' }], stream: true }), allowAll());
  const turn = (await second.transcript?.('one'))?.at(-1);
  expect((turn?.message as { model?: { id?: string } } | undefined)?.model?.id).toBe('open_router/x');
  expect(turn?.usage?.model).toBe('open_router/x');
});

it('rebuilds a turn with no model when its run recorded none', async () => {
  const { root, sweep } = place();
  const agent = backend(root, createFakeModel({ script: [{ text: 'ok' }], stream: true }), allowAll());
  const one = open(agent, 'one', sweep);
  one.session.begin('t1', 'hi');
  await until(() => ended(one.view));
  one.session.close();

  const runs = await createFileStore({ root }).runs.list({ sessionId: 'one' });
  expect(runs[0]?.model).toBeUndefined();
  const turn = (await agent.transcript?.('one'))?.at(-1);
  expect((turn?.message as { model?: unknown } | undefined)?.model).toBeUndefined();
  expect(turn?.usage).toBeDefined();
  expect(turn?.usage?.model).toBeUndefined();
});

/*
 * A compaction as a reopened session reads it.
 *
 * The messages are written straight into a memory store rather than run
 * through a turn: what a summary looks like on the way back is a fact about
 * the transcript, and one turn of a scripted model is a longer way to say the
 * same store. What the numbers are checked against is the event cofold
 * recorded them on, which is where the live turn read them too.
 */

const AT = '2026-01-01T00:00:00.000Z';

/** One message as cofold wrote it, with the one text part these cases need. */
const wrote = (id: string, role: 'user' | 'assistant', source: MessageSource, text: string): Message => ({
  id, role, source, createdAt: AT, parts: [{ type: 'text', text }],
});

/** A summary cofold wrote, standing for the messages it names. */
const summed = (id: string, text: string, summarizes: string[]): Message => ({
  id, role: 'user', source: 'summary', createdAt: AT, parts: [{ type: 'text', text }], summarizes,
});

/** The event a compaction is recorded as, which the transcript reads its numbers from. */
const compactedAt = (messageId: string, before: number, after: number): RunEvent => ({
  seq: 1,
  runId: 'r1',
  sessionId: 'one',
  agentId: 'cofold',
  at: AT,
  type: 'context.compacted',
  messageId,
  summarized: 2,
  kept: 0,
  estimatedTokens: before,
  afterTokens: after,
});

/** A memory store holding one finished session: the messages, and the events written after them. */
const stored = async (messages: Message[], events: RunEvent[] = []): Promise<Store> => {
  const store = createMemoryStore();
  await store.sessions.create({ sessionId: 'one', agentId: 'cofold' });
  await store.runs.create({
    runId: 'r1',
    sessionId: 'one',
    agentId: 'cofold',
    status: 'completed',
    createdAt: AT,
    updatedAt: AT,
    usage: { inputTokens: 1, outputTokens: 1 },
    steps: 1,
    denials: [],
  });
  await store.sessions.claimWriter({ sessionId: 'one', runId: 'r1' });
  await store.sessions.appendMessages({ sessionId: 'one', runId: 'r1', messages });
  for (const event of events) await store.runs.appendEvent(event);
  return store;
};

it('reads a compacted session\'s summary as the notice the live turn sent', async () => {
  const store = await stored(
    [
      wrote('u1', 'user', 'input', 'the first thing'),
      wrote('a1', 'assistant', 'model', 'answer one'),
      wrote('u2', 'user', 'input', 'the second thing'),
      summed('s1', 'Summary of the conversation so far:\neverything so far', ['u1', 'a1']),
      wrote('a2', 'assistant', 'model', 'answer two'),
    ],
    [compactedAt('s1', 9000, 2000)],
  );

  const turns = await turnsOf(store, 'one');
  // Every message keeps its turn: what the summary stands for is what a
  // request no longer carries, not what the conversation has lost.
  expect(turns.map((one) => one.id)).toEqual(['u1', 'u2']);
  const parts = (turns[1]?.responseParts ?? []) as Bag[];
  expect(parts[0]).toMatchObject({
    kind: 'systemNotification',
    content: 'Context compacted automatically: 9000 tokens to 2000.',
  });
  // The notice is where the summary was written, before the answer that follows it.
  expect(parts[1]).toMatchObject({ kind: 'markdown', content: 'answer two' });
  // The summary was written for the model, so its text is nowhere a client reads.
  expect(JSON.stringify(turns)).not.toContain('everything so far');
});

it('says a compaction happened when the store kept no numbers for it', async () => {
  const store = await stored([
    wrote('u1', 'user', 'input', 'the first thing'),
    summed('s1', 'Summary of the conversation so far:\neverything so far', ['u1']),
    wrote('a1', 'assistant', 'model', 'answer one'),
  ]);

  const turns = await turnsOf(store, 'one');
  const parts = (turns[0]?.responseParts ?? []) as Bag[];
  expect(parts[0]).toMatchObject({ kind: 'systemNotification', content: 'Context compacted automatically.' });
  expect(JSON.stringify(turns)).not.toContain('everything so far');
});

it('reads a session with no summary as the conversation it was', async () => {
  const store = await stored([
    wrote('u1', 'user', 'input', 'the first thing'),
    wrote('a1', 'assistant', 'model', 'answer one'),
    wrote('u2', 'user', 'input', 'the second thing'),
    wrote('a2', 'assistant', 'model', 'answer two'),
  ]);

  const turns = await turnsOf(store, 'one');
  expect(turns.map((one) => one.id)).toEqual(['u1', 'u2']);
  expect(((turns[0]?.responseParts ?? []) as Bag[]).map((part) => [part.kind, part.content]))
    .toEqual([['markdown', 'answer one']]);
  expect(((turns[1]?.responseParts ?? []) as Bag[]).map((part) => [part.kind, part.content]))
    .toEqual([['markdown', 'answer two']]);
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
