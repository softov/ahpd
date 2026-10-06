import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createFakeModel, createMemoryStore } from '@cofold/agents/testing';
import type { Agent as CofoldAgent, ModelAdapter, ModelProvider, Store } from '@cofold/agents';
import { chatReducer } from '@microsoft/agent-host-protocol';
import type { ChatAction, ChatState } from '@microsoft/agent-host-protocol';
import type { Bag, Emit, Start } from '@ahpd/sdk';
import { cofoldSession, compactionNotice, harnessConfig, storeOf, turnsOf } from '../src/index.js';
import type { CofoldOptions, Held } from '../src/agent.js';
import type { SessionContext } from '../src/context.js';
import { AUTO_COMPACT_AT, DEFAULT_CONTEXT_TOKENS, createTurnAgent } from '../src/turnagent.js';

/*
 * A session that folds its own history before it fills the model.
 *
 * No network and no real model: the adapter is a script, the store is in
 * memory, and the catalogue is a hand-made `Held` that says what one model's
 * window is. What this checks is the point a turn is built with - the
 * configured `autoCompactTokens`, never above 80% of the window the endpoint
 * listed - and that crossing it makes cofold write a summary into the
 * conversation rather than sending a history the model cannot take.
 */

let home: string;
let had: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-cofold-compact-'));
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
});

afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
  rmSync(home, { recursive: true, force: true });
});

/** A harness file that owns the endpoint the configured model is asked for. */
const CONFIG = {
  providers: [{ id: 'open_router', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' }],
  model: 'open_router/deepseek/deepseek-chat',
};

const put = (value: unknown): void => {
  mkdirSync(join(home, 'cofold'), { recursive: true });
  writeFileSync(join(home, 'cofold', 'config.json'), JSON.stringify(value));
};

/** The window the catalogue listed for the configured model. */
const WINDOW = 10000;

/**
 * What the backend holds for a turn: the transport, and what the list said.
 *
 * The provider hands back the adapter the test scripted rather than building
 * one, which is what a real endpoint's `model()` does with a real transport;
 * `window` is the `contextTokens` the catalogue published, absent for a model
 * it said nothing about.
 */
const holding = (adapter: ModelAdapter, window?: number): Held => ({
  providerOf: (): ModelProvider => ({
    id: 'open_router',
    listModels: async () => [],
    model: () => adapter,
  }),
  infoOf: (reference) => (reference === undefined || window === undefined
    ? undefined
    : {
        id: reference,
        name: reference,
        features: { tools: true, streaming: true, images: false, structuredOutput: false, reasoning: false },
        contextTokens: window,
      }),
});

/** One session's channels, collected the way the host would dispatch them. */
function channels() {
  const notes: { channel: string; action: Bag }[] = [];
  return {
    notes,
    emit: ((channel, action) => { notes.push({ channel, action }); }) as Emit,
    types: (channel: string): string[] =>
      notes.filter((one) => one.channel === channel).map((one) => String(one.action.type)),
  };
}

/** One session as the harness would hand it over. */
const start = (emit: Emit): Start => ({
  uri: 'ahpd-session:/one',
  chatUri: 'ahpd-chat:/one',
  settings: {},
  workingDirectory: process.cwd(),
  schema: () => ({}),
  emit,
});

/**
 * The cofold agent one turn of a session runs on, reached the way the session
 * reaches it.
 *
 * `agentOf` is what turns the options and the config in force into the frozen
 * agent a run executes, so reading `context` off it is reading exactly what a
 * turn would be built with, without running one.
 */
const agentOn = (options: CofoldOptions, held?: Held): CofoldAgent => {
  const ctx = {
    options,
    start: start(() => {}),
    harness: harnessConfig(),
    where: process.cwd(),
    store: storeOf(options),
    held,
    offered: [],
    editing: new Map(),
  } as unknown as SessionContext;
  return createTurnAgent(ctx).agentOf({});
};

/** What the turns left in the store, and the actions they sent. */
const run = async (
  options: CofoldOptions,
  held: Held,
  texts: string[],
): Promise<{ store: Store; view: ReturnType<typeof channels> }> => {
  const store = createMemoryStore();
  const view = channels();
  const session = cofoldSession(options, start(view.emit), store, harnessConfig(), () => [], held);
  const ends = (): number =>
    view.types('chat').filter((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled').length;
  for (const [index, text] of texts.entries()) {
    const wanted = ends() + 1;
    session.begin(`t${index + 1}`, text);
    const limit = Date.now() + 4000;
    while (ends() < wanted) {
      if (Date.now() > limit) throw new Error('timed out waiting for the turn');
      await new Promise((r) => { setTimeout(r, 0); });
    }
  }
  return { store, view };
};

/** The summary message a turn left, if it wrote one. */
const summaryIn = async (store: Store): Promise<Bag | undefined> =>
  (await store.sessions.listMessages({ sessionId: 'one' })).find((one) => one.source === 'summary') as Bag | undefined;

/** Every turn's parts as a client watching the chat drew them, folded as it folds. */
const drawn = (view: ReturnType<typeof channels>): Bag[] => {
  let state = { turns: [], status: 0, modifiedAt: 'now' } as unknown as ChatState;
  for (const note of view.notes.filter((one) => one.channel === 'chat')) {
    state = chatReducer(state, note.action as unknown as ChatAction);
  }
  return (state.turns ?? []).flatMap((turn) => (turn.responseParts ?? []) as unknown as Bag[]);
};

/** What the turn's own answer streamed, joined the way a client redraws it. */
const streamed = (view: ReturnType<typeof channels>, type: string): string =>
  view.notes
    .filter((one) => one.channel === 'chat' && one.action.type === type)
    .map((one) => String(one.action.content))
    .join('');

it('compacts at 80% of the window the endpoint listed', async () => {
  put(CONFIG);
  const agent = agentOn({ ...CONFIG, memory: true }, holding(createFakeModel({ script: [{ text: 'hi' }] }), WINDOW));
  // cofold's own estimate, and 80% of what the list published.
  expect(agent.context.maxTokens).toBe(WINDOW);
  expect(agent.context.autoCompactTokens).toBe(Math.floor(WINDOW * AUTO_COMPACT_AT));
  expect(agent.context.autoCompactTokens).toBe(8000);
});

it('takes the configured point when it is under the cap', async () => {
  put(CONFIG);
  const agent = agentOn(
    { ...CONFIG, memory: true, autoCompactTokens: 5000 },
    holding(createFakeModel({ script: [{ text: 'hi' }] }), WINDOW),
  );
  expect(agent.context.autoCompactTokens).toBe(5000);
});

it('caps a configured point at 80% of the window', async () => {
  put(CONFIG);
  const agent = agentOn(
    { ...CONFIG, memory: true, autoCompactTokens: 9000 },
    holding(createFakeModel({ script: [{ text: 'hi' }] }), WINDOW),
  );
  expect(agent.context.autoCompactTokens).toBe(8000);
});

it('holds a session with no catalogue at cofold\'s own default, capped', async () => {
  put(CONFIG);
  const plain = agentOn({ ...CONFIG, memory: true });
  expect(plain.context.maxTokens).toBe(DEFAULT_CONTEXT_TOKENS);
  expect(plain.context.autoCompactTokens).toBe(Math.floor(DEFAULT_CONTEXT_TOKENS * AUTO_COMPACT_AT));
  expect(plain.context.autoCompactTokens).toBe(25600);

  // A caller-passed adapter names no endpoint to read a window from.
  const model = createFakeModel({ script: [{ text: 'hi' }] });
  const adapted = agentOn({ adapter: model, memory: true, autoCompactTokens: 30000 });
  expect(adapted.context.maxTokens).toBe(DEFAULT_CONTEXT_TOKENS);
  expect(adapted.context.autoCompactTokens).toBe(25600);
});

it('summarizes a history past the point, and leaves it in the conversation', async () => {
  put(CONFIG);
  const model = createFakeModel({
    script: [{ text: 'first answer' }, { text: 'the summary so far' }, { text: 'second answer' }],
    stream: true,
  });
  /*
   * A first turn of 5000 tokens, under the point, then a second of 8001 more.
   * Four characters to a token is cofold's own estimate, and the window the
   * list published allows 8000, so it is the second turn that folds - and what
   * it folds is the first, whose own 5000 tokens stand over the 2000 cofold
   * keeps verbatim.
   */
  const { store } = await run(
    { ...CONFIG, memory: true },
    holding(model, WINDOW),
    ['y'.repeat(20000), 'x'.repeat(32004)],
  );

  const summary = await summaryIn(store);
  expect(summary?.source).toBe('summary');
  // What it stands for is the turn before: the second turn's own input is what
  // it is about to answer, so that one is not folded in.
  expect(summary?.summarizes).toHaveLength(1);
  // The step after the summary reads it in place of the history it stands for.
  expect(JSON.stringify(model.requests.at(-1)?.messages)).toContain('the summary so far');
});

it('says a compaction as one notice rather than as the model\'s answer', async () => {
  put(CONFIG);
  const model = createFakeModel({
    script: [{ text: 'first answer' }, { text: 'the summary so far' }, { text: 'second answer' }],
    stream: true,
  });
  const { store, view } = await run(
    { ...CONFIG, memory: true },
    holding(model, WINDOW),
    ['y'.repeat(20000), 'x'.repeat(32004)],
  );

  // The two numbers are cofold's, so the notice is checked against the event
  // they arrived on rather than against numbers this test made up.
  const runs = await store.runs.list({ sessionId: 'one' });
  const events = await store.runs.listEvents({ sessionId: 'one', runId: String(runs[0]?.runId) });
  const compacted = events.find((one) => one.type === 'context.compacted') as
    { estimatedTokens: number; afterTokens: number } | undefined;
  expect(compacted).toBeDefined();

  const parts = drawn(view);
  const notices = parts.filter((part) => part.kind === 'systemNotification');
  expect(notices).toHaveLength(1);
  expect(notices[0]?.content).toBe(
    compactionNotice({ before: Number(compacted?.estimatedTokens), after: Number(compacted?.afterTokens) }),
  );

  /*
   * The summary is the model's own working text, not its answer: it reaches
   * neither a delta nor a part a client draws. The turn's own answer does.
   */
  expect(streamed(view, 'chat/delta')).toContain('second answer');
  expect(streamed(view, 'chat/delta')).not.toContain('the summary so far');
  expect(parts.map((part) => String(part.content ?? '')).join('|')).not.toContain('the summary so far');

  /*
   * Reopening the session reads the same sentence back: the transcript takes
   * the numbers from the event this turn took them from, so a client that
   * restarts is not told a different story about the same compaction.
   */
  const read = await turnsOf(store, 'one');
  const noticesRead = read
    .flatMap((turn) => turn.responseParts as Bag[])
    .filter((part) => part.kind === 'systemNotification');
  expect(noticesRead.map((part) => part.content)).toEqual(notices.map((part) => part.content));
});

it('words the notice the way the Claude backend does', () => {
  expect(compactionNotice({ before: 9000, after: 2000 })).toBe('Context compacted automatically: 9000 tokens to 2000.');
  expect(compactionNotice()).toBe('Context compacted automatically.');
});

it('runs no summary step for a session that stays under the point', async () => {
  put(CONFIG);
  const model = createFakeModel({ script: [{ text: 'answered' }], stream: true });
  const { store } = await run({ ...CONFIG, memory: true }, holding(model, WINDOW), ['hello there']);

  expect(await summaryIn(store)).toBeUndefined();
  // One step, which is the model answering rather than summarizing first.
  expect(model.requests).toHaveLength(1);
});
