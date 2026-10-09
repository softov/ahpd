import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Bag, Start } from '../../sdk/src/types/index.js';
import { piAgent } from '../src/agent.js';
import { forget } from '../src/catalog.js';
import type { BackendOptions, PiBackend } from '../src/backend.js';
import { piSession } from '../src/session.js';
import { metaKeys } from '../../../tools/wire.mjs';
import type { OpenPi } from '../src/session.js';

/*
 * What a pi turn says it used, as the calls of that turn go by.
 *
 * A turn with tools is several model calls, and each one is an assistant
 * message of its own. So the usage a turn reports is the sum over them, sent
 * after every call and once more as the turn ends, with the cost pi priced the
 * calls at. Driven through the `open` seam, as the session cases in
 * `agent-pi.test.ts` are.
 */

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-pi-usage-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); forget(); });

/** A pi that settles a turn only when a case says so, so calls can be raised. */
function fakePi() {
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  let settle = true;
  const backend: PiBackend = {
    id: 'pi-session-1',
    file: undefined,
    subscribe: (one) => { listener = one; return () => { listener = undefined; }; },
    prompt: async () => { if (settle) listener?.({ type: 'agent_settled' }); },
    steer: async () => {},
    abort: async () => { listener?.({ type: 'agent_settled' }); },
    models: async () => [],
    leaf: () => 'entry-1',
    levels: () => ['off'],
    chosen: () => undefined,
    takesImages: () => false,
    choose: async () => true,
    rename: async () => {},
    rewind: async () => true,
    close: () => {},
  };
  return {
    backend,
    raise: (event: AgentSessionEvent) => { listener?.(event); },
    hold: () => { settle = false; },
    open: (async (_options: BackendOptions) => backend) as OpenPi,
  };
}

/** One session, with everything it emitted. */
function opened() {
  const pi = fakePi();
  const sent: { channel: string; action: Bag }[] = [];
  const start = {
    uri: 'ahp-session:/s1',
    chatUri: 'ahp-chat:/s1',
    settings: {},
    workingDirectory: root,
    schema: () => ({}),
    emit: (channel: string, action: Bag) => { sent.push({ channel, action }); },
  } as Start;
  const session = piSession({}, start, pi.open, async () => undefined);
  return { session, pi, sent };
}

/** The usages a turn sent, in the order it sent them. */
const totals = (sent: { channel: string; action: Bag }[], channel = 'chat'): Bag[] => sent
  .filter((one) => one.channel === channel && one.action.type === 'chat/usage')
  .map((one) => one.action.usage as Bag);

/** What pi priced one call at: a bare total, or the parts it split that total into. */
type Price = number | {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
};

/**
 * One price in pi's own shape.
 *
 * pi prices a call as four parts and makes `total` their sum, so a case naming
 * parts gets that sum unless it names one of its own. A bare number is a call
 * that reported a total and no split.
 */
const priced = (given: Price | undefined): Bag => {
  if (typeof given === 'number') return { total: given };
  const parts = {
    input: given?.input ?? 0,
    output: given?.output ?? 0,
    cacheRead: given?.cacheRead ?? 0,
    cacheWrite: given?.cacheWrite ?? 0,
  };
  return { ...parts, total: given?.total ?? parts.input + parts.output + parts.cacheRead + parts.cacheWrite };
};

/** One assistant message's call, at the counts and price a case names. */
const call = (counts: {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: Price;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
}): AgentSessionEvent => ({
  type: 'message_end',
  message: {
    role: 'assistant',
    content: [],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: counts.model ?? 'claude-opus-5',
    usage: {
      input: counts.input ?? 0,
      output: counts.output ?? 0,
      cacheRead: counts.cacheRead ?? 0,
      cacheWrite: counts.cacheWrite ?? 0,
      totalTokens: (counts.input ?? 0) + (counts.output ?? 0),
      cost: priced(counts.cost),
    },
    stopReason: counts.stopReason ?? 'stop',
    ...(counts.errorMessage !== undefined ? { errorMessage: counts.errorMessage } : {}),
    timestamp: Date.now(),
  },
} as unknown as AgentSessionEvent);

/** Let a run's zero-delay work finish; nothing here waits on a real model. */
const settled = async (): Promise<void> => { await new Promise((done) => { setTimeout(done, 5); }); };

it('grows the total it sends with every call, and ends on the sum', async () => {
  const { session, pi, sent } = opened();
  pi.hold();
  session.begin('t1', 'read two files');
  await settled();

  pi.raise(call({ input: 100, output: 20, cost: 0.01 }));
  pi.raise(call({ input: 50, output: 10, cacheRead: 5, cacheWrite: 7, cost: 0.02 }));
  pi.raise(call({ input: 30, output: 40, cost: 0.005 }));
  pi.raise({ type: 'agent_settled' });
  await settled();

  const sentTotals = totals(sent);
  // Three calls and a final one, each the sum of the calls up to it.
  expect(sentTotals).toHaveLength(4);
  expect(sentTotals.map((one) => [one.inputTokens, one.outputTokens, one.cacheReadTokens])).toEqual([
    [100, 20, 0],
    [150, 30, 5],
    [180, 70, 5],
    [180, 70, 5],
  ]);
  // The cache write rides `_meta`, summed as the other counts are.
  expect(sentTotals.map((one) => (one._meta as Bag | undefined)?.['ahpd.cacheWriteTokens'])).toEqual([0, 7, 7, 7]);
  for (const total of sentTotals) {
    const cost = (total._meta as Bag)['ahpd.cost'] as Bag;
    expect(cost.currency).toBe('USD');
  }
  const amounts = sentTotals.map((one) => ((one._meta as Bag)['ahpd.cost'] as Bag).amount as number);
  expect(amounts[0]).toBeCloseTo(0.01);
  expect(amounts[1]).toBeCloseTo(0.03);
  expect(amounts[2]).toBeCloseTo(0.035);
  // The census the wire test runs, over every report: no bare usage key.
  expect([...new Set(sentTotals.flatMap((one) => metaKeys(one).map(({ key }) => key)))].sort())
    .toEqual(['ahpd.cacheWriteTokens', 'ahpd.cost']);
  // Every total went out before the turn ended, or a client hangs it on a turn
  // that has already left the running list.
  const chat = sent.filter((one) => one.channel === 'chat').map((one) => String(one.action.type));
  expect(chat.lastIndexOf('chat/usage')).toBeLessThan(chat.indexOf('chat/turnComplete'));
  // And the turn keeps the sum on its transcript.
  const turns = await piAgent({}, [root]).transcript?.('pi-session-1');
  expect(turns?.[0]?.usage).toEqual(sentTotals[3]);
});

it('names the model of the last call, whatever the turn ran before', async () => {
  const { session, pi, sent } = opened();
  pi.hold();
  session.begin('t1', 'switch model');
  await settled();

  pi.raise(call({ input: 10, model: 'claude-opus-5' }));
  pi.raise(call({ input: 20, model: 'gpt-5' }));
  pi.raise({ type: 'agent_settled' });
  await settled();

  expect(totals(sent).map((one) => one.model)).toEqual([
    'anthropic/claude-opus-5',
    'anthropic/gpt-5',
    'anthropic/gpt-5',
  ]);
});

it('sends no usage for a call that failed before the provider answered', async () => {
  const { session, pi, sent } = opened();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();

  pi.raise(call({ input: 40, output: 5, cost: 0.02 }));
  pi.raise(call({ stopReason: 'error', errorMessage: '401 Unauthorized' }));
  pi.raise({ type: 'agent_settled' });
  await settled();

  // The failed call reported every count at zero, which is not something the
  // turn used, so the total is the one real call made.
  expect(totals(sent)).toEqual([{
    inputTokens: 40,
    outputTokens: 5,
    cacheReadTokens: 0,
    model: 'anthropic/claude-opus-5',
    _meta: { 'ahpd.cacheWriteTokens': 0, 'ahpd.cost': { amount: 0.02, currency: 'USD' } },
  }, {
    inputTokens: 40,
    outputTokens: 5,
    cacheReadTokens: 0,
    model: 'anthropic/claude-opus-5',
    _meta: { 'ahpd.cacheWriteTokens': 0, 'ahpd.cost': { amount: 0.02, currency: 'USD' } },
  }]);
  expect(sent.some((one) => one.action.type === 'chat/error')).toBe(true);
});

it('sends the cost split the way pi priced it, the sent side summed into one part', async () => {
  const { session, pi, sent } = opened();
  pi.hold();
  session.begin('t1', 'read two files');
  await settled();

  // pi prices the tokens it sent as three of its four parts. The protocol has
  // one field for what was sent, so input, cacheRead and cacheWrite are added
  // together, and the received side is pi's output. Two calls of these add to
  // 3 dollars sent and 4 received against a total of 7.
  const one: Price = { input: 1, cacheRead: 0.5, output: 2 };
  pi.raise(call({ input: 100, output: 20, cost: one }));
  pi.raise(call({ input: 50, output: 30, cost: one }));
  pi.raise({ type: 'agent_settled' });
  await settled();

  // The running total after each call, and the turn's own when it ended.
  expect(totals(sent).map((each) => (each._meta as Bag)['ahpd.cost'])).toEqual([
    { amount: 3.5, currency: 'USD', input: 1.5, output: 2 },
    { amount: 7, currency: 'USD', input: 3, output: 4 },
    { amount: 7, currency: 'USD', input: 3, output: 4 },
  ]);
});

it('sends a call priced as a bare total with no split invented for it', async () => {
  const { session, pi, sent } = opened();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();

  // A total and no parts: there is nothing to say which side of the call cost
  // what, and a nought written into either would be a figure pi never gave.
  pi.raise(call({ input: 10, output: 5, cost: 0.5 }));
  pi.raise({ type: 'agent_settled' });
  await settled();

  expect(totals(sent).map((each) => (each._meta as Bag)['ahpd.cost'])).toEqual([
    { amount: 0.5, currency: 'USD' },
    { amount: 0.5, currency: 'USD' },
  ]);
});

it('starts the next turn from nothing, rather than on what the last one used', async () => {
  const { session, pi, sent } = opened();
  pi.hold();
  session.begin('t1', 'hello');
  await settled();
  pi.raise(call({ input: 100, output: 20, cost: 0.01 }));
  pi.raise({ type: 'agent_settled' });
  await settled();

  session.begin('t2', 'again');
  await settled();
  pi.raise(call({ input: 7, output: 3, cost: 0.002 }));
  pi.raise({ type: 'agent_settled' });
  await settled();

  const after = totals(sent).slice(2);
  expect(after).toEqual([{
    inputTokens: 7,
    outputTokens: 3,
    cacheReadTokens: 0,
    model: 'anthropic/claude-opus-5',
    _meta: { 'ahpd.cacheWriteTokens': 0, 'ahpd.cost': { amount: 0.002, currency: 'USD' } },
  }, {
    inputTokens: 7,
    outputTokens: 3,
    cacheReadTokens: 0,
    model: 'anthropic/claude-opus-5',
    _meta: { 'ahpd.cacheWriteTokens': 0, 'ahpd.cost': { amount: 0.002, currency: 'USD' } },
  }]);
});
