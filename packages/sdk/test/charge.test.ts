/*
 * Which row pays for a piece of work, over the draft's own store.
 *
 * The setup is `decide.test.ts`'s: the same fifteen rows, the same people and
 * the same today. What is new is step 5 - the order, the room and the keys a
 * record is charged under - so each case fills a `memoryUsage` to the state the
 * draft's example names and asserts the keys the walk answered.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { chargeFor, countCall, limitsOf } from '../src/usage/charge.js';
import type { Charge, PayOrder } from '../src/usage/charge.js';
import { createMinuteMeter } from '../src/usage/minute.js';
import type { MinuteMeter } from '../src/usage/minute.js';
import { decide } from '../src/access/decide.js';
import type { Asked } from '../src/access/decide.js';
import { memoryPolicies } from '../src/access/policies.js';
import type { Scope } from '../src/usage/scopes.js';
import type { Policies, Policy, PolicyKind, PolicyLimit } from '../src/types/policies.js';
import type { Usage, UsageTotal } from '../src/types/usage.js';
import type { Grant, Principal } from '../src/types/users.js';

const DAY = (amount: number, measure: PolicyLimit['measure'], period: PolicyLimit['period'], pool: PolicyLimit['pool'] = 'shared'): PolicyLimit[] => [
  { amount, measure, period, pool },
];

/** The draft's store, with the limits it writes and the windows it gives. */
const ROWS: Policy[] = [
  { id: 'M1', scope: 'all', kind: 'model', effect: 'allow', match: { model: ['deepseek/*', 'qwen/*'], proxy: ['local-vllm'] } },
  { id: 'M2', scope: 'team:backend', kind: 'model', effect: 'allow', match: { model: ['anthropic/*'] }, limits: DAY(500, 'usd', 'week') },
  { id: 'M3', scope: 'user:bob', kind: 'model', effect: 'deny', match: { model: ['anthropic/fable-5'] } },
  { id: 'M4', scope: 'project:backend:billing', kind: 'model', effect: 'allow', match: { model: ['anthropic/*'] }, limits: DAY(300, 'usd', 'week') },
  { id: 'M5', scope: 'user:carol', kind: 'model', effect: 'allow', match: { model: ['*'] }, limits: DAY(2000000, 'tokens', 'week') },
  { id: 'M6', scope: 'team:data', kind: 'model', effect: 'allow', match: { model: ['openai/gpt-6-mini'] }, limits: [...DAY(20, 'usd', 'week', 'each'), ...DAY(5000000, 'tokens', 'week', 'each')] },
  { id: 'A1', scope: 'all', kind: 'agent', effect: 'allow', match: { agent: ['*'], model: ['deepseek/*', 'qwen/*'] } },
  { id: 'A2', scope: 'team:backend', kind: 'agent', effect: 'allow', match: { agent: ['claude', 'pi'], model: ['anthropic/*'] }, limits: [...DAY(400, 'usd', 'week'), ...DAY(40, 'hours', 'week', 'each')] },
  { id: 'A3', scope: 'user:alice', kind: 'agent', effect: 'allow', match: { agent: ['claude'], model: ['anthropic/fable-5'] }, limits: [...DAY(100, 'usd', 'week'), ...DAY(1000000, 'tokens', 'week')] },
  { id: 'A4', scope: 'project:backend:search', kind: 'agent', effect: 'allow', match: { agent: ['cofold'], model: ['*'] }, limits: DAY(100, 'turns', 'week') },
  { id: 'A5', scope: 'user:bob', kind: 'agent', effect: 'deny', match: { agent: ['*'], model: ['anthropic/fable-5'] } },
  { id: 'A6', scope: 'user:alice', kind: 'agent', effect: 'allow', match: { agent: ['claude'], model: ['anthropic/fable-5'] }, limits: DAY(50, 'usd', 'total'), from: '2026-10-22', until: '2026-10-31' },
  { id: 'C1', scope: 'user:alice', kind: 'computer', effect: 'allow', match: { computer: ['sandbox-alice'] } },
  { id: 'C2', scope: 'team:backend', kind: 'computer', effect: 'allow', match: { computer: ['kvm-shared'] }, limits: [...DAY(20, 'hours', 'week', 'each'), ...DAY(2, 'sessions', 'total', 'each')] },
  { id: 'C3', scope: 'project:backend:search', kind: 'computer', effect: 'allow', match: { computer: ['host'] } },
];

let policies: Policies;
beforeEach(async () => {
  policies = await storeOf(...ROWS);
});

/** A store holding the rows written, in the order they are written. */
async function storeOf(...rows: Policy[]): Promise<Policies> {
  const store = memoryPolicies();
  for (const row of rows) await store.put(row);
  return store;
}

/**
 * A usage store whose totals the test fills, by pool.
 *
 * A state in the draft's examples is one map from key to the figure the period
 * has used, so a case reads as the table row it comes from. The range is not
 * narrowed here: every state is inside the period its limit counts, and the
 * ranges themselves are `periods.test.ts`'s.
 */
const memoryUsage = (totals: Record<string, UsageTotal> = {}): Usage => ({
  record: async () => {},
  total: async (pool) => totals[pool] ?? {},
  pools: async () => Object.keys(totals).sort(),
  records: async () => [],
  groups: async () => [],
});

/** Somebody who holds the grants written, which is all the check ever asks. */
const person = (id: string, grants: Grant[] = ['session:*']): Principal => ({
  id,
  roles: grants,
  can: (grant) => grants.includes(grant),
});

const alice = person('alice');
const bob = person('bob');
const carol = person('carol');
const frank = person('frank');
/** Holds `*:*`, which is the whole of the charge walk's first step. */
const dave = person('dave', ['*:*']);
/** In no team and no project, so nothing but an `all` row holds her. */
const erin = person('erin');

/** The scope the draft's people work under, `billing` being alice's and bob's default. */
const BILLING: Scope = { team: 'backend', project: 'billing' };
const SEARCH: Scope = { team: 'backend', project: 'search' };
const DATA: Scope = { team: 'data' };

/** The draft's today. */
const TODAY = new Date('2026-10-20T00:00:00.000Z');

const at = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** `decide` then `chargeFor`, then the count a caller makes, which is the pair the host runs for one piece of work. */
const charged = async (
  kind: PolicyKind,
  principal: Principal,
  scope: Scope | undefined,
  asked: Asked,
  usage: Usage,
  moment: Date = TODAY,
  payOrder?: PayOrder,
  store: Policies = policies,
  meter?: MinuteMeter,
): Promise<Charge> => {
  const decision = await decide(store, principal, scope, kind, asked, moment);
  if (!decision.allowed) throw new Error(`the check refused it: ${decision.refusal.message}`);
  const walked = await chargeFor(decision, kind, principal, scope, usage, {
    zone: 'UTC',
    at: moment,
    ...(payOrder === undefined ? {} : { payOrder }),
    ...(meter === undefined ? {} : { meter }),
  });
  if (walked.allowed) countCall(walked.pools, meter, moment);
  return walked;
};

/** The keys of an answer the walk allowed. */
const poolsOf = (answer: Charge): string[] => {
  expect(answer.allowed).toBe(true);
  if (!answer.allowed) throw new Error(answer.refusal.message);
  return answer.pools;
};

/** The refusal, once the answer is known to be one. */
const refusalOf = (answer: Charge): NonNullable<Charge['refusal']> => {
  expect(answer.allowed).toBe(false);
  if (answer.allowed) throw new Error('the walk allowed it');
  return answer.refusal;
};

/** The row a test asks about, as the store holds it after its checks. */
const rowOf = async (id: string): Promise<Policy> => {
  const row = await policies.get(id);
  if (row === undefined) throw new Error(`no ${id} in the store`);
  return row;
};

describe('the row the draft charges', () => {
  it('example 1: M1 allows a deepseek call and has no limits, so no key is added', async () => {
    const answer = await charged('model', alice, BILLING, { model: 'deepseek/deepseek-v4.1-flash' }, memoryUsage());
    expect(poolsOf(answer)).toEqual([]);
  });

  it('example 10: M1 covers erin, who is in no team, and adds no key', async () => {
    const answer = await charged('model', erin, undefined, { model: 'qwen/qwen3-8b' }, memoryUsage());
    expect(poolsOf(answer)).toEqual([]);
  });

  it('example 19: A3 does not match a sonnet, so A2 pays the usd', async () => {
    const answer = await charged('agent', alice, BILLING, { agent: 'claude', model: 'anthropic/sonnet-5' }, memoryUsage());
    expect(poolsOf(answer)).toEqual(['policy:A2/usd']);
  });

  it('examples 2 and 4: auto walks the project before the team, so M4 pays and not M2', async () => {
    // The draft charges M2 through alice's and bob's charge rules, which this
    // plan does not build: under `auto` the project row is the more specific one.
    const two = await charged('model', alice, BILLING, { model: 'anthropic/fable-5' }, memoryUsage());
    expect(poolsOf(two)).toEqual(['policy:M4/usd']);
    const four = await charged('model', bob, BILLING, { model: 'anthropic/sonnet-5' }, memoryUsage());
    expect(poolsOf(four)).toEqual(['policy:M4/usd']);
  });

  it('example 6: M5 pays the tokens and M2 pays the usd, each measure walking on its own', async () => {
    const answer = await charged('model', carol, SEARCH, { model: 'anthropic/sonnet-5' }, memoryUsage());
    expect(poolsOf(answer)).toEqual(['policy:M2/usd', 'policy:M5/tokens']);
  });

  it('example 14: A3 closed by tokens pays no usd, and A2 pays it', async () => {
    const usage = memoryUsage({ 'policy:A3/usd': { usd: 60 }, 'policy:A3/tokens': { tokens: 1000000 } });
    const answer = await charged('agent', alice, BILLING, { agent: 'claude', model: 'anthropic/fable-5' }, usage);
    expect(poolsOf(answer)).toEqual(['policy:A2/usd']);
  });

  it('example 17: A3 pays the usd and the tokens when both have room', async () => {
    const usage = memoryUsage({ 'policy:A3/usd': { usd: 40 } });
    const answer = await charged('agent', alice, BILLING, { agent: 'claude', model: 'anthropic/fable-5' }, usage);
    expect(poolsOf(answer)).toEqual(['policy:A3/usd', 'policy:A3/tokens']);
  });

  it('example 18: A2 pays the usd when A3 is at its amount', async () => {
    const usage = memoryUsage({ 'policy:A3/usd': { usd: 100 } });
    const answer = await charged('agent', alice, BILLING, { agent: 'claude', model: 'anthropic/fable-5' }, usage);
    expect(poolsOf(answer)).toEqual(['policy:A2/usd']);
  });
});

describe('a row with more than one limit', () => {
  it('example 11: tokens close M6 first, and the refusal names that figure', async () => {
    const usage = memoryUsage({
      'policy:M6/usd/user:frank': { usd: 8 },
      'policy:M6/tokens/user:frank': { tokens: 5000000 },
    });
    const refusal = refusalOf(await charged('model', frank, DATA, { model: 'openai/gpt-6-mini' }, usage));
    expect(refusal.policy).toBe('M6');
    expect(refusal.measure).toBe('tokens');
    expect(refusal.period).toBe('week');
    expect(refusal.used).toBe(5000000);
    expect(refusal.amount).toBe(5000000);
    expect(refusal.message).toBe('M6 has no room: 5000000 / 5000000 tokens this week');
  });

  it('example 12: dollars close M6 first, and the refusal names that figure', async () => {
    const usage = memoryUsage({
      'policy:M6/usd/user:frank': { usd: 20 },
      'policy:M6/tokens/user:frank': { tokens: 1200000 },
    });
    const refusal = refusalOf(await charged('model', frank, DATA, { model: 'openai/gpt-6-mini' }, usage));
    expect(refusal.measure).toBe('usd');
    expect(refusal.message).toBe('M6 has no room: 20 / 20 usd this week');
  });

  it('example 13: both limits have room, so the call passes both', async () => {
    const usage = memoryUsage({
      'policy:M6/usd/user:frank': { usd: 19.9 },
      'policy:M6/tokens/user:frank': { tokens: 4900000 },
    });
    const answer = await charged('model', frank, DATA, { model: 'openai/gpt-6-mini' }, usage);
    expect(poolsOf(answer)).toEqual(['policy:M6/usd/user:frank', 'policy:M6/tokens/user:frank']);
  });
});

describe('the windows and the pay order', () => {
  it('example 28: A6 pays inside its window, because `ending` puts it before A3', async () => {
    const usage = memoryUsage({ 'policy:A3/usd': { usd: 100 } });
    const answer = await charged('agent', alice, BILLING, { agent: 'claude', model: 'anthropic/fable-5' }, usage, at('2026-10-23'));
    expect(poolsOf(answer)).toEqual(['policy:A6/usd']);
  });

  it('example 29: A6 pays the usd and A3 the tokens when both have room', async () => {
    const usage = memoryUsage({ 'policy:A3/usd': { usd: 40 } });
    const answer = await charged('agent', alice, BILLING, { agent: 'claude', model: 'anthropic/fable-5' }, usage, at('2026-10-23'));
    expect(poolsOf(answer)).toEqual(['policy:A6/usd', 'policy:A3/tokens']);
  });

  it('example 30: after A6 ends, A2 pays the usd again', async () => {
    const usage = memoryUsage({ 'policy:A3/usd': { usd: 100 } });
    const answer = await charged('agent', alice, BILLING, { agent: 'claude', model: 'anthropic/fable-5' }, usage, at('2026-11-01'));
    expect(poolsOf(answer)).toEqual(['policy:A2/usd']);
  });

  /** Three rows of one scope: open-ended, ending on the 25th, ending on the 30th. */
  const PAY_ROWS: Policy[] = [
    { id: 'B1', scope: 'user:alice', kind: 'agent', effect: 'allow', match: { agent: ['claude'], model: ['anthropic/fable-5'] }, limits: DAY(10, 'usd', 'week') },
    { id: 'B2', scope: 'user:alice', kind: 'agent', effect: 'allow', match: { agent: ['claude'], model: ['anthropic/fable-5'] }, limits: DAY(10, 'usd', 'week'), from: '2026-10-01', until: '2026-10-25' },
    { id: 'B3', scope: 'user:alice', kind: 'agent', effect: 'allow', match: { agent: ['claude'], model: ['anthropic/fable-5'] }, limits: DAY(10, 'usd', 'week'), from: '2026-10-20', until: '2026-10-30' },
  ];

  const paysWith = async (payOrder: PayOrder): Promise<string[]> => {
    const store = await storeOf(...PAY_ROWS);
    const answer = await charged('agent', alice, undefined, { agent: 'claude', model: 'anthropic/fable-5' }, memoryUsage(), at('2026-10-21'), payOrder, store);
    return poolsOf(answer);
  };

  it('ending: the row that ends soonest pays first', async () => {
    expect(await paysWith('ending')).toEqual(['policy:B2/usd']);
  });

  it('regular: the open-ended row pays first', async () => {
    expect(await paysWith('regular')).toEqual(['policy:B1/usd']);
  });

  it('extra: the newest `from` among the rows with an `until` pays first', async () => {
    expect(await paysWith('extra')).toEqual(['policy:B3/usd']);
  });
});

describe('cap and pool', () => {
  it('a cap row at its amount refuses, and names the figure that closed it', async () => {
    const store = await storeOf(...ROWS.map((row) => (row.id === 'A3' ? { ...row, cap: true } : row)));
    const usage = memoryUsage({ 'policy:A3/usd': { usd: 100 } });
    const refusal = refusalOf(await charged('agent', alice, BILLING, { agent: 'claude', model: 'anthropic/fable-5' }, usage, TODAY, undefined, store));
    expect(refusal.policy).toBe('A3');
    expect(refusal.message).toBe('A3 has no room: 100 / 100 usd this week');
  });

  it('a cap row below its amount adds its key and the next row pays', async () => {
    const store = await storeOf(...ROWS.map((row) => (row.id === 'A3' ? { ...row, cap: true } : row)));
    const usage = memoryUsage({ 'policy:A3/usd': { usd: 40 } });
    const answer = await charged('agent', alice, BILLING, { agent: 'claude', model: 'anthropic/fable-5' }, usage, TODAY, undefined, store);
    expect(poolsOf(answer)).toEqual(['policy:A3/usd', 'policy:A2/usd', 'policy:A3/tokens']);
  });

  it('an `each` limit names the person, and a `pool` row uses the pool key', async () => {
    const store = await storeOf(
      { id: 'P1', scope: 'user:alice', kind: 'model', effect: 'allow', match: { model: ['anthropic/*'] }, pool: 'fleet', limits: DAY(10, 'usd', 'week') },
      { id: 'P2', scope: 'all', kind: 'model', effect: 'allow', match: { model: ['anthropic/*'] }, pool: 'fleet', limits: DAY(10, 'usd', 'week') },
    );
    const under = memoryUsage({ 'pool:fleet/usd': { usd: 9 } });
    const answer = await charged('model', alice, undefined, { model: 'anthropic/fable-5' }, under, TODAY, undefined, store);
    expect(poolsOf(answer)).toEqual(['pool:fleet/usd']);

    // Two rows naming one pool read one total, so the same nine closes both.
    const rows = await store.list();
    const first = await limitsOf(rows[0] as Policy, under, 'UTC', TODAY);
    const second = await limitsOf(rows[1] as Policy, under, 'UTC', TODAY);
    expect(first[0]?.used).toBe(9);
    expect(second[0]?.used).toBe(9);
  });
});

describe('a measure this plan does not count', () => {
  it('an `hours` limit reads back as not counted and never closes its row', async () => {
    const usage = memoryUsage({ 'policy:A2/hours/user:alice': { hours: 100 } });
    const a2 = await rowOf('A2');
    const figures = await limitsOf(a2, usage, 'UTC', TODAY, alice);
    const hours = figures.find((figure) => figure.measure === 'hours');
    expect(hours?.counted).toBe(false);
    expect(hours?.used).toBeUndefined();
    const answer = await charged('agent', alice, BILLING, { agent: 'claude', model: 'anthropic/fable-5' }, usage);
    expect(answer.allowed).toBe(true);
  });
});

describe('limitsOf', () => {
  it('answers the from and resets of a week in America/Campo_Grande', async () => {
    const a3 = await rowOf('A3');
    const figures = await limitsOf(a3, memoryUsage(), 'America/Campo_Grande', new Date('2026-10-20T12:00:00.000Z'));
    expect(figures[0]?.from).toBe('2026-10-19T04:00:00.000Z');
    expect(figures[0]?.resets).toBe('2026-10-26T04:00:00.000Z');
  });

  it('answers a total with the row’s from, no resets, and the row’s until as ends', async () => {
    const a6 = await rowOf('A6');
    const figures = await limitsOf(a6, memoryUsage(), 'UTC', TODAY);
    expect(figures[0]).toMatchObject({
      from: '2026-10-22T00:00:00.000Z',
      ends: '2026-10-31T23:59:59.999Z',
      counted: true,
    });
    expect(figures[0]?.resets).toBeUndefined();
  });

  it('answers every member of an `each` limit when no person is asked', async () => {
    const usage = memoryUsage({
      'policy:M6/usd/user:bob': { usd: 3 },
      'policy:M6/usd/user:carol': { usd: 1 },
      'policy:M6/usd/user:frank': { usd: 8 },
    });
    const m6 = await rowOf('M6');
    const figures = await limitsOf(m6, usage, 'UTC', TODAY);
    expect(figures[0]?.used).toBeUndefined();
    expect(figures[0]?.members).toEqual([
      { user: 'bob', used: 3 },
      { user: 'carol', used: 1 },
      { user: 'frank', used: 8 },
    ]);
  });
});

describe('a key\'s own row', () => {
  /** A person carrying the limits of the key they signed in with. */
  const keyed = (who: Principal, id: string, limits: PolicyLimit[]): Principal =>
    ({ ...who, token: id, keyLimits: limits });

  it('is walked first, adds its keys, and the team row still pays', async () => {
    const answer = await charged('model', keyed(carol, 'k1', DAY(100, 'calls', 'day')), SEARCH, { model: 'anthropic/sonnet-5' }, memoryUsage());
    expect(poolsOf(answer)).toEqual(['policy:M2/usd', 'policy:M5/tokens', 'pool:token:k1/calls']);
  });

  it('refuses before the project row that would otherwise pay', async () => {
    const usage = memoryUsage({ 'pool:token:k1/usd': { usd: 5 } });
    const refusal = refusalOf(await charged('model', keyed(alice, 'k1', DAY(5, 'usd', 'day')), BILLING, { model: 'anthropic/fable-5' }, usage));
    expect(refusal.policy).toBe('token:k1');
    expect(refusal.message).toBe('token:k1 has no room: 5 / 5 usd this day');
  });

  it('out of room in another measure, refuses with that measure\'s sentence', async () => {
    const usage = memoryUsage({ 'pool:token:k1/calls': { calls: 2 } });
    const refusal = refusalOf(await charged('model', keyed(alice, 'k1', DAY(2, 'calls', 'day')), BILLING, { model: 'anthropic/fable-5' }, usage));
    expect(refusal.measure).toBe('calls');
    expect(refusal.message).toBe('token:k1 has no room: 2 / 2 calls this day');
  });

  it('is the only row a `*:*` holder\'s key gets, and holds them too', async () => {
    const usage = memoryUsage({ 'pool:token:k1/calls': { calls: 2 } });
    const refusal = refusalOf(await charged('model', keyed(dave, 'k1', DAY(2, 'calls', 'day')), BILLING, { model: 'anthropic/fable-5' }, usage));
    expect(refusal.message).toBe('token:k1 has no room: 2 / 2 calls this day');

    // With room it adds its key, and nothing else was asked of it.
    const answer = await charged('model', keyed(dave, 'k1', DAY(100, 'calls', 'day')), BILLING, { model: 'anthropic/fable-5' }, memoryUsage());
    expect(poolsOf(answer)).toEqual(['pool:token:k1/calls']);
  });
});

describe('a minute limit', () => {
  /** Alice's row with a limit of two calls a minute. */
  const BURST = async (): Promise<Policies> => storeOf({
    id: 'R1', scope: 'user:alice', kind: 'model', effect: 'allow', match: { model: ['anthropic/*'] },
    limits: [{ amount: 2, measure: 'calls', period: 'minute', pool: 'shared' }],
  });

  const aMinuteLater = new Date(TODAY.getTime() + 60_000);

  it('allows two calls and refuses the third with this minute', async () => {
    const store = await BURST();
    const meter = createMinuteMeter();
    const call = async (): Promise<Charge> => charged('model', alice, undefined, { model: 'anthropic/sonnet-5' }, memoryUsage(), TODAY, undefined, store, meter);
    expect(poolsOf(await call())).toEqual(['policy:R1/calls']);
    expect(poolsOf(await call())).toEqual(['policy:R1/calls']);
    const refusal = refusalOf(await call());
    expect(refusal.period).toBe('minute');
    expect(refusal.message).toBe('R1 has no room: 2 / 2 calls this minute');
  });

  it('allows a call in the next minute', async () => {
    const store = await BURST();
    const meter = createMinuteMeter();
    for (let one = 0; one < 2; one += 1) {
      await charged('model', alice, undefined, { model: 'anthropic/sonnet-5' }, memoryUsage(), TODAY, undefined, store, meter);
    }
    const answer = await charged('model', alice, undefined, { model: 'anthropic/sonnet-5' }, memoryUsage(), aMinuteLater, undefined, store, meter);
    expect(poolsOf(answer)).toEqual(['policy:R1/calls']);
  });

  it('allows every call when the walk has no meter, because the store keeps no minute', async () => {
    const store = await BURST();
    for (let one = 0; one < 3; one += 1) {
      const answer = await charged('model', alice, undefined, { model: 'anthropic/sonnet-5' }, memoryUsage(), TODAY, undefined, store);
      expect(poolsOf(answer)).toEqual(['policy:R1/calls']);
    }
  });

  it('reads a tokens limit from the meter rather than the day total', async () => {
    const store = await storeOf({
      id: 'T1', scope: 'user:alice', kind: 'model', effect: 'allow', match: { model: ['anthropic/*'] },
      limits: [{ amount: 100, measure: 'tokens', period: 'minute', pool: 'shared' }],
    });
    const meter = createMinuteMeter();
    // The store's day total would say this row is out; the minute says it is not.
    const usage = memoryUsage({ 'policy:T1/tokens': { tokens: 5000 } });
    expect(poolsOf(await charged('model', alice, undefined, { model: 'anthropic/sonnet-5' }, usage, TODAY, undefined, store, meter)))
      .toEqual(['policy:T1/tokens']);
    meter.add('policy:T1/tokens', 100, TODAY);
    expect(refusalOf(await charged('model', alice, undefined, { model: 'anthropic/sonnet-5' }, usage, TODAY, undefined, store, meter)).message)
      .toBe('T1 has no room: 100 / 100 tokens this minute');
  });

  it('does not count a walk, and counts a key named twice once', async () => {
    const store = await BURST();
    const meter = createMinuteMeter();
    const decision = await decide(store, alice, undefined, 'model', { model: 'anthropic/sonnet-5' }, TODAY);
    if (!decision.allowed) throw new Error(decision.refusal.message);
    const walked = await chargeFor(decision, 'model', alice, undefined, memoryUsage(), { zone: 'UTC', at: TODAY, meter });
    const pools = poolsOf(walked);
    expect(pools).toEqual(['policy:R1/calls']);
    // The walk only reads the minute: one piece of work may walk more than once.
    expect(meter.sum('policy:R1/calls', TODAY)).toBe(0);
    // One count, though the caller names the key twice.
    countCall([...pools, ...pools], meter, TODAY);
    expect(meter.sum('policy:R1/calls', TODAY)).toBe(1);
  });

  it('counts a limit for each person under each person\'s key', async () => {
    const store = await storeOf({
      id: 'E1', scope: 'all', kind: 'model', effect: 'allow', match: { model: ['anthropic/*'] },
      limits: [{ amount: 2, measure: 'calls', period: 'minute', pool: 'each' }],
    });
    const meter = createMinuteMeter();
    const call = async (who: Principal): Promise<Charge> =>
      charged('model', who, undefined, { model: 'anthropic/sonnet-5' }, memoryUsage(), TODAY, undefined, store, meter);
    expect(poolsOf(await call(alice))).toEqual(['policy:E1/calls/user:alice']);
    expect(poolsOf(await call(alice))).toEqual(['policy:E1/calls/user:alice']);
    expect(refusalOf(await call(alice)).message).toBe('E1 has no room: 2 / 2 calls this minute');
    // Bob has a minute of his own.
    expect(poolsOf(await call(bob))).toEqual(['policy:E1/calls/user:bob']);
  });

  it('answers a minute figure with where it begins and resets, in UTC', async () => {
    const store = await BURST();
    const row = await store.get('R1') as Policy;
    const figures = await limitsOf(row, memoryUsage(), 'America/Campo_Grande', TODAY);
    expect(figures[0]).toMatchObject({
      used: 0,
      from: '2026-10-20T00:00:00.000Z',
      resets: '2026-10-20T00:01:00.000Z',
    });
  });
});

describe('step 1', () => {
  it('allows a `*:*` holder at once, with no keys', async () => {
    const answer = await charged('model', dave, BILLING, { model: 'anthropic/fable-5' }, memoryUsage());
    expect(poolsOf(answer)).toEqual([]);
  });
});
