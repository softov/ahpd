import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { metaKeys } from '../../../tools/wire.mjs';
import type { Bag, SubagentChat, SubagentRequest } from '@ahpd/sdk';

/*
 * A turn's usage is every call it made, sent as it makes them.
 *
 * The stream reports one API call's usage in two halves: `message_start`
 * carries the input side, and `message_delta` the call's final output plus a
 * repeat of the input counts to the same numbers. `result.usage` is the main
 * agent loop alone, so a turn that delegated to a subagent is short by
 * everything the workers spent, and a client watching sees nothing at all
 * until the turn is already over.
 *
 * The rounds are the captured ones from `agent-claude-round-ended`, replayed
 * as one turn - two of the lead agent's and one of a worker's - with the usage
 * numbers that capture reported.
 */

const sdk = vi.hoisted(() => {
  interface Feed { held: Record<string, unknown>[]; wake: (() => void) | undefined }
  const fresh = (): Feed => ({ held: [], wake: undefined });
  const state = {
    /** The feed the next query reads, and the one `push` writes to. */
    feed: fresh(),
    reset() { state.feed = fresh(); },
    push(...frames: Record<string, unknown>[]) {
      const feed = state.feed;
      feed.held.push(...frames);
      feed.wake?.();
      feed.wake = undefined;
    },
    /** One feed's next frame, once one is queued. */
    async next(feed: Feed): Promise<Record<string, unknown>> {
      while (feed.held.length === 0) await new Promise<void>((resolve) => { feed.wake = resolve; });
      return feed.held.shift() as Record<string, unknown>;
    },
  };
  return state;
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: () => {
    const feed = sdk.feed;
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) yield await sdk.next(feed);
      },
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

const { createSession } = await import('../src/session.js');

const fixture = (name: string): Record<string, unknown>[] => readFileSync(
  new URL(`./fixtures/${name}`, import.meta.url),
  'utf8',
).split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Record<string, unknown>);

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/**
 * The same frames as a worker's: its stream events carry the call that runs it.
 *
 * Behind the spawning call, because the harness always sends that too, and this
 * host holds a worker's frames until it does - a worker whose call was never
 * seen is held for five seconds rather than counted as it speaks.
 */
const asSubagent = (frames: Record<string, unknown>[], toolCallId = 'toolu_worker'): Record<string, unknown>[] => [
  {
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      id: 'msg_worker_call',
      role: 'assistant',
      content: [{
        type: 'tool_use',
        id: toolCallId,
        name: 'Agent',
        input: { subagent_type: 'Explore', description: 'Count its tokens', prompt: 'answer once' },
      }],
    },
  },
  ...frames
    .filter((one) => one.type === 'stream_event')
    .map((one) => ({ ...one, parent_tool_use_id: toolCallId })),
];

/** The frame a turn ends with, priced at a query's running cost so far. */
const result = (costUSD: number, costBasis: 'list' | 'managed' | 'unknown' = 'list'): Record<string, unknown> => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  duration_ms: 1,
  total_cost_usd: costUSD,
  modelUsage: {
    'claude-opus-5': {
      inputTokens: 6,
      outputTokens: 167,
      cacheReadInputTokens: 65058,
      cacheCreationInputTokens: 3766,
      webSearchRequests: 0,
      contextWindow: 200000,
      maxOutputTokens: 64000,
      costUSD,
      costBasis,
    },
  },
});

/**
 * The frame the CLI sends when it takes its running total back to zero.
 *
 * `/clear`, a plan-mode exit and a fresh session all emit one, and the CLI's
 * own cost figures start again behind it.
 */
const reset = (): Record<string, unknown> => ({
  type: 'conversation_reset',
  new_conversation_id: 'conv-reset',
  uuid: 'reset-1',
  session_id: 's-usage',
});

interface Call { input: number; output: number; read: number; wrote: number; started: number }

/**
 * One captured round's own numbers, read off its own frames.
 *
 * From the frames rather than written out here, so a fixture that changes
 * cannot leave these expecting a total nothing produces.
 */
const call = (name: string): Call => {
  const events = fixture(name)
    .filter((one) => one.type === 'stream_event')
    .map((one) => one.event as Bag);
  const start = (events.find((one) => one.type === 'message_start')?.message as Bag).usage as Bag;
  const delta = (events.find((one) => one.type === 'message_delta')?.usage) as Bag;
  return {
    input: start.input_tokens as number,
    output: delta.output_tokens as number,
    read: start.cache_read_input_tokens as number,
    wrote: start.cache_creation_input_tokens as number,
    /** What `message_start` said of the output, which is not this call's. */
    started: start.output_tokens as number,
  };
};

const answered = call('claude-answered-round.jsonl');
const empty = call('claude-empty-round.jsonl');

/** The protocol's spelling of what these calls added up to. */
const total = (...calls: Call[]): Bag => ({
  inputTokens: calls.reduce((sum, one) => sum + one.input, 0),
  outputTokens: calls.reduce((sum, one) => sum + one.output, 0),
  cacheReadTokens: calls.reduce((sum, one) => sum + one.read, 0),
  _meta: { cacheWriteTokens: calls.reduce((sum, one) => sum + one.wrote, 0) },
});

/** Replay frames through a real session with a recording host seam. */
async function replay(frames: Record<string, unknown>[]) {
  sdk.reset();
  sdk.push(...frames);
  const main: Bag[] = [];
  const workers = new Map<string, Bag[]>();
  const subagent = (toolCallId: string, _request: SubagentRequest): SubagentChat => {
    const held: Bag[] = [];
    workers.set(toolCallId, held);
    return {
      uri: `ahp-chat://subagent/fake/${toolCallId}`,
      turnId: `wturn-${toolCallId}`,
      emit: (action) => { held.push(action as Bag); },
      end: () => {},
    };
  };
  const session = createSession({
    uri: 'ahp-session:/usage',
    chatUri: 'ahp-chat:/usage',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-usage-')),
    emit: (_channel, action) => { main.push(action as Bag); },
    subagent,
  });
  await settle();
  return { main, workers, session };
}

/** The `chat/usage` actions the session's own chat received, in order. */
const reports = (main: Bag[]): Bag[] => main.filter((one) => one.type === 'chat/usage');
const payload = (action: Bag | undefined): Bag => (action?.usage ?? {}) as Bag;

it('counts one call from the half of it that completes that half, and says so before the turn ends', async () => {
  const { main } = await replay([...fixture('claude-answered-round.jsonl'), result(0.5)]);

  const said = reports(main);
  // The call's own, and then the turn's total when it ended - the first is
  // what a client watching sees while the model is still working.
  expect(said).toHaveLength(2);
  expect(main.findIndex((one) => one.type === 'chat/usage'))
    .toBeLessThan(main.findIndex((one) => one.type === 'chat/turnComplete'));
  expect(payload(said[0])).toMatchObject(total(answered));
  /*
   * The input counts arrive twice, on both halves, to the same numbers, and
   * `message_start` calls the output one token where the call finished at
   * seventeen. A sum that read either half whole, or both, would bill a
   * seventeen-token call as thirty-six tokens and its prompt as a 1265-token
   * one twice over.
   */
  expect(answered.started).toBe(1);
  expect(payload(said[0])).toMatchObject({ inputTokens: answered.input, outputTokens: answered.output });
});

it('sends a total that grows with every call, a worker\'s included, and ends at their sum', async () => {
  const { main, workers, session } = await replay([
    ...fixture('claude-answered-round.jsonl'),
    ...fixture('claude-empty-round.jsonl'),
    ...asSubagent(fixture('claude-answered-round.jsonl')),
    result(1.25),
  ]);

  const said = reports(main);
  // One after each of the three calls, and the turn's own total after the last.
  expect(said).toHaveLength(4);
  expect(said.slice(0, 3).map(payload)).toEqual([
    total(answered),
    total(answered, empty),
    total(answered, empty, answered),
  ]);
  expect(payload(said[3])).toEqual({
    ...total(answered, empty, answered),
    _meta: { ...total(answered, empty, answered)._meta as Bag, cost: { amount: 1.25, currency: 'USD' } },
  });

  // The sum belongs to the turn, so the worker's own chat carries none of it.
  expect(workers.get('toolu_worker')?.some((one) => one.type === 'chat/usage')).toBe(false);

  // And the snapshot a client reads afterwards holds the same number.
  const turns = (session.chatState().turns ?? []) as Bag[];
  expect(turns[0]?.usage).toEqual(payload(said[3]));
});

it('takes the turn\'s cost from the change in modelUsage, which is cumulative per query', async () => {
  const { main, session } = await replay([...fixture('claude-answered-round.jsonl'), result(0.5)]);
  expect(payload(reports(main).at(-1))?._meta).toMatchObject({ cost: { amount: 0.5, currency: 'USD' } });

  // The next result carries the query's running total, not this turn's spend.
  session.begin('t2', 'and again');
  await settle();
  sdk.push(...fixture('claude-empty-round.jsonl'), result(1.25));
  await settle();
  expect(payload(reports(main).at(-1))?._meta).toMatchObject({ cost: { amount: 0.75, currency: 'USD' } });
});

it('sends no cost for a result that found the books where the last one left them', async () => {
  /*
   * The 2026-10-07 20:43 `claude-deepseek-build` record: an empty model name,
   * every token count 0, and a cost of 0. That was a `result` whose
   * `modelUsage` had not moved, and a turn that spent nothing has no cost
   * rather than a cost of nothing.
   */
  const { main, session } = await replay([...fixture('claude-empty-round.jsonl'), result(0.5)]);
  expect(payload(reports(main).at(-1))?._meta).toMatchObject({ cost: { amount: 0.5, currency: 'USD' } });

  session.begin('t2', 'and again');
  await settle();
  // The same figures again: the query is where it was.
  sdk.push(...fixture('claude-empty-round.jsonl'), result(0.5));
  await settle();
  const meta = payload(reports(main).at(-1))?._meta as Bag;
  expect(meta).toMatchObject({ cacheWriteTokens: empty.wrote });
  expect(meta.cost).toBeUndefined();
});

it('sends no cost for a result the CLI came back with zeroed, and bills the total once', async () => {
  /*
   * A crash or a startup error comes back with every figure zeroed, and the
   * turn it ends has no tokens of its own. Read as a measurement the zero is a
   * negative cost, and the baseline it leaves behind bills the conversation's
   * whole total again on the result that carries it back.
   */
  const { main, session } = await replay([...fixture('claude-empty-round.jsonl'), result(0.68)]);
  expect(payload(reports(main).at(-1))?._meta).toMatchObject({ cost: { amount: 0.68, currency: 'USD' } });

  session.begin('t2', 'and again');
  await settle();
  sdk.push({ ...result(0), usage: { input_tokens: 0, output_tokens: 0 } });
  await settle();
  // No cost key rather than one holding a nought, which read as a measurement
  // of the turn would negate what the turn before it spent.
  expect(payload(reports(main).at(-1))).not.toHaveProperty('_meta.cost');

  // The running total is back on the result behind it, and the turn that spent
  // the money keeps it: only what grew since it was last billed is charged.
  session.begin('t3', 'and again');
  await settle();
  sdk.push(result(1.36));
  await settle();
  expect(payload(reports(main).at(-1))?._meta).toMatchObject({ cost: { amount: 0.68, currency: 'USD' } });
});

it('starts the cost baseline again when the CLI resets the conversation', async () => {
  /*
   * `/clear`, a plan-mode exit and a fresh session all send
   * `conversation_reset`, and the CLI's running total starts again at zero
   * behind it. The baseline the last result left sits above the figure that
   * comes next, and a figure that did not go up is read as no spend - so every
   * turn after a `/clear` was billed nothing until the total climbed back past
   * where it had been.
   */
  const { main, session } = await replay([...fixture('claude-empty-round.jsonl'), result(1)]);
  expect(payload(reports(main).at(-1))?._meta).toMatchObject({ cost: { amount: 1, currency: 'USD' } });

  session.begin('t2', 'and again');
  await settle();
  // A zeroed result with no reset before it is still no spend: the books are
  // where the last result left them, and the baseline only moves for a model a
  // result spent on. It is the reset, and nothing else, that takes it to zero.
  sdk.push({ ...result(0), usage: { input_tokens: 0, output_tokens: 0 } });
  await settle();
  expect(payload(reports(main).at(-1))).not.toHaveProperty('_meta.cost');

  session.begin('t3', 'after the clear');
  await settle();
  // The reset first, then the turn it belongs to, then the result that prices
  // it. Twenty cents is well under the one-dollar baseline, so only a baseline
  // taken back to zero reads it as the spend it is.
  sdk.push(reset(), ...fixture('claude-empty-round.jsonl'), result(0.2));
  await settle();
  expect(payload(reports(main).at(-1))?._meta).toMatchObject({ cost: { amount: 0.2, currency: 'USD' } });
});

it('sends no cost the CLI could only guess at, and still differences the next one from it', async () => {
  // `costBasis: 'unknown'` is a model the CLI had no price row for, so the
  // figure beside it is the default model's rate and nothing more.
  const { main, session } = await replay([...fixture('claude-answered-round.jsonl'), result(0.5, 'unknown')]);
  expect(payload(reports(main).at(-1))?._meta).toEqual({ cacheWriteTokens: answered.wrote });

  // The guess is not sent, but it is still on the books: the next result
  // differences from where this one left them, or it would bill those 0.5
  // dollars a second time under a price this time.
  session.begin('t2', 'and again');
  await settle();
  sdk.push(...fixture('claude-empty-round.jsonl'), result(1.25));
  await settle();
  expect(payload(reports(main).at(-1))?._meta).toMatchObject({ cost: { amount: 0.75, currency: 'USD' } });
});

it('lets a guess made in an earlier turn spoil only that turn\'s cost', async () => {
  // `modelUsage` keeps every model the query ever used, so the guessed one is
  // still listed, unchanged, when a later turn spends only on a priced one.
  const both = (priced: number, guessed: number): Record<string, unknown> => {
    const frame = result(priced);
    const models = frame.modelUsage as Bag;
    models['stealth/model'] = { ...(models['claude-opus-5'] as Bag), costUSD: guessed, costBasis: 'unknown' };
    return frame;
  };
  const { main, session } = await replay([...fixture('claude-answered-round.jsonl'), both(0.5, 0.2)]);
  expect((payload(reports(main).at(-1))?._meta as Bag).cost).toBeUndefined();

  session.begin('t2', 'and again');
  await settle();
  sdk.push(...fixture('claude-empty-round.jsonl'), both(1.25, 0.2));
  await settle();
  expect(payload(reports(main).at(-1))?._meta).toMatchObject({ cost: { amount: 0.75, currency: 'USD' } });
});

it('writes no key into the usage\'s `_meta` that nothing has been told about', async () => {
  const { main } = await replay([...fixture('claude-answered-round.jsonl'), result(0.5)]);
  /*
   * `_meta` is the protocol's one open bag: no declaration names a key in it,
   * so a name added here reaches every client with no schema noticing. The
   * wire test runs this same census over the whole capture; this is it over
   * the part of it this file produces, so a key invented here fails here
   * rather than in a capture nobody took.
   */
  expect(metaKeys(payload(reports(main).at(-1))).map((one) => one.key).sort())
    .toEqual(['cacheWriteTokens', 'cost']);
});

it('falls back to the result\'s own count when the stream carried no partial messages', async () => {
  const frame = { ...result(0.5), usage: { input_tokens: 7, output_tokens: 11, cache_read_input_tokens: 3 } };
  const { main, session } = await replay([]);
  session.begin('t1', 'no stream');
  await settle();
  sdk.push(frame);
  await settle();
  expect(payload(reports(main).at(-1))).toMatchObject({ inputTokens: 7, outputTokens: 11, cacheReadTokens: 3 });
});
