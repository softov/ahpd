/*
 * The four steps a check runs, over the draft's own store.
 *
 * The setup is the draft's, written as data: the same fifteen rows, the same
 * people and the same today. The limits are here because the rows carry them,
 * and nothing below reads one - which is the point. A policy that has already
 * spent what it had still allows, and that is policy/02's work, not this.
 *
 * What is left is steps 1 to 4. Which row pays, and in what unit, is step 5 and
 * is not here either, so a candidate list is a list of rows that allowed it and
 * not an answer to "who pays".
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { decide } from '../src/decide.js';
import { memoryPolicies } from '../src/policies.js';
import type { Scope } from '../src/scopes.js';
import type { Policies, Policy, PolicyLimit } from '../src/types/policies.js';
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
  policies = memoryPolicies();
  for (const row of ROWS) await policies.put(row);
});

/** Somebody who holds the grants written, which is all `decide` ever asks. */
const person = (id: string, grants: Grant[] = ['session:*']): Principal => ({
  id,
  roles: grants,
  can: (grant) => grants.includes(grant),
});

const alice = person('alice');
const bob = person('bob');
const carol = person('carol');
/** Holds `*:*`, which is step 1 and nothing else. */
const dave = person('dave', ['*:*']);
/** In no team and no project, so nothing but an `all` row holds her. */
const erin = person('erin');

/** The scope the draft's people work under, `billing` being alice's and bob's default. */
const BILLING: Scope = { team: 'backend', project: 'billing' };
const SEARCH: Scope = { team: 'backend', project: 'search' };

/** The draft's today. */
const TODAY = new Date('2026-10-20T00:00:00.000Z');

const at = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

const ids = (decision: { candidates: Policy[] }): string[] => decision.candidates.map((row) => row.id);

/** The refusal, once the answer is known to be one. */
const refusalOf = (decision: Awaited<ReturnType<typeof decide>>): NonNullable<typeof decision.refusal> => {
  expect(decision.allowed).toBe(false);
  if (decision.allowed) throw new Error('the check allowed it');
  return decision.refusal;
};

describe('the model kind, which is the proxy', () => {
  it('allows example 1: only M1 matches a deepseek call', async () => {
    const decision = await decide(policies, alice, BILLING, 'model', { model: 'deepseek/deepseek-v4.1-flash' }, TODAY);
    expect(decision.allowed).toBe(true);
    expect(ids(decision)).toEqual(['M1']);
  });

  it('allows example 2 and answers with every row that had room, which is not who pays', async () => {
    // M2 pays and M4 also matched: which of them a call is charged to is the
    // draft's step 5, and this answers only that both held it.
    const decision = await decide(policies, alice, BILLING, 'model', { model: 'anthropic/fable-5' }, TODAY);
    expect(decision.allowed).toBe(true);
    expect(ids(decision)).toEqual(['M2', 'M4']);
  });

  it('refuses example 9: erin is in no team, and M1 does not match a sonnet', async () => {
    const refusal = refusalOf(await decide(policies, erin, undefined, 'model', { model: 'anthropic/sonnet-5' }, TODAY));
    expect(refusal.policy).toBeUndefined();
    expect(refusal.message).toContain('no policy allows');
  });

  it('allows example 10: an `all` row covers a person with no team', async () => {
    const decision = await decide(policies, erin, undefined, 'model', { model: 'qwen/qwen3-8b' }, TODAY);
    expect(decision.allowed).toBe(true);
    expect(ids(decision)).toEqual(['M1']);
  });

  it('refuses example 35 through openrouter where the same call through local-vllm is allowed', async () => {
    // M1 is the only row that matches the model, and it names one provider.
    const allowed = await decide(policies, alice, BILLING, 'model', { model: 'deepseek/deepseek-v4.1-flash', proxy: 'local-vllm' }, TODAY);
    expect(allowed.allowed).toBe(true);
    const refused = await decide(policies, alice, BILLING, 'model', { model: 'deepseek/deepseek-v4.1-flash', proxy: 'openrouter' }, TODAY);
    expect(ids(refused)).toEqual([]);
    expect(refusalOf(refused).message).toContain('no policy allows');
  });

  it('allows example 37: a row naming no provider leaves the provider unconstrained', async () => {
    const decision = await decide(policies, alice, BILLING, 'model', { model: 'anthropic/sonnet-5', proxy: 'openrouter' }, TODAY);
    expect(decision.allowed).toBe(true);
    expect(ids(decision)).toEqual(['M2', 'M4']);
  });
});

describe('the agent kind, which is a harness ahpd runs', () => {
  it('allows example 15, where the model is checked per turn and so not yet', async () => {
    const decision = await decide(policies, alice, BILLING, 'agent', { agent: 'claude', computer: 'sandbox-alice' }, TODAY);
    expect(decision.allowed).toBe(true);
    // A1 and A2 name `model:` values the request does not, so those are not
    // checked at a session's creation - which is what makes them candidates.
    expect(ids(decision)).toEqual(['A1', 'A2', 'A3']);
  });

  it('allows example 19, where A3 does not match a sonnet and A2 does', async () => {
    const decision = await decide(policies, alice, BILLING, 'agent', { agent: 'claude', model: 'anthropic/sonnet-5' }, TODAY);
    expect(decision.allowed).toBe(true);
    expect(ids(decision)).toEqual(['A2']);
  });

  it('refuses example 21 by A5, and names the row that refused it', async () => {
    const refusal = refusalOf(await decide(policies, bob, BILLING, 'agent', { agent: 'claude', model: 'anthropic/fable-5' }, TODAY));
    expect(refusal.policy).toBe('A5');
    // The row is a named part of the answer, so the test holds the id and not
    // the sentence: policy/02 adds a limit to what is left.
    expect(refusal.message).toContain('A5');
    expect(refusal.message).toContain('anthropic/fable-5');
  });

  it('leaves A5 out of the same check on a request that named no model', async () => {
    // What a session's creation looks like. A5 names a model and the request
    // does not, so it binds on nothing and bob can start - while A1 and A2,
    // which name a model too, are still candidates because an allow is one on
    // what was asked.
    const decision = await decide(policies, bob, BILLING, 'agent', { agent: 'claude', computer: 'kvm-shared' }, TODAY);
    expect(decision.allowed).toBe(true);
    expect(ids(decision)).toEqual(['A1', 'A2']);
  });

  it('allows example 26, whose refusal is the machine and not a policy', async () => {
    const decision = await decide(policies, alice, BILLING, 'agent', { agent: 'cofold', computer: 'sandbox-alice' }, TODAY);
    expect(decision.allowed).toBe(true);
    expect(ids(decision)).toEqual(['A1']);
    // `sandbox-alice` carries no cofold. That is a fact about the machine, so
    // nothing in this store refuses it and the check is right to allow.
  });

  it('allows example 25 for carol in project search', async () => {
    const decision = await decide(policies, carol, SEARCH, 'agent', { agent: 'cofold', model: 'anthropic/sonnet-5' }, TODAY);
    expect(decision.allowed).toBe(true);
    expect(ids(decision)).toEqual(['A4']);
  });
});

describe('the computer kind, which is where a session runs', () => {
  it('refuses example 16: no computer row gives alice the host', async () => {
    const refusal = refusalOf(await decide(policies, alice, BILLING, 'computer', { computer: 'host' }, TODAY));
    expect(refusal.policy).toBeUndefined();
    expect(refusal.message).toContain('computer host');
  });

  it('refuses example 22: C1 is alice and C2 is the shared machine', async () => {
    const refusal = refusalOf(await decide(policies, bob, BILLING, 'computer', { computer: 'sandbox-alice' }, TODAY));
    expect(refusal.message).toContain('no policy allows computer sandbox-alice');
  });

  it('refuses example 27 at the computer only, after allowing the agent', async () => {
    const agent = await decide(policies, erin, undefined, 'agent', { agent: 'pi', model: 'qwen/qwen3-8b' }, TODAY);
    expect(agent.allowed).toBe(true);
    expect(ids(agent)).toEqual(['A1']);
    const refusal = refusalOf(await decide(policies, erin, undefined, 'computer', { computer: 'kvm-shared' }, TODAY));
    expect(refusal.message).toContain('no policy allows computer kvm-shared');
  });
});

describe('step 1', () => {
  it('allows a `*:*` holder at once, with nothing read', async () => {
    const decision = await decide(policies, dave, BILLING, 'model', { model: 'anthropic/fable-5' }, TODAY);
    expect(decision.allowed).toBe(true);
    expect(decision.candidates).toEqual([]);
  });
});

describe('the match, as the draft writes its globs', () => {
  it('matches a value whole, with `*` standing for any run within it', async () => {
    // `agent:*` holds `acp:something`, and A1's `model:` values hold qwen.
    const decision = await decide(policies, carol, SEARCH, 'agent', { agent: 'acp:something', model: 'qwen/qwen3-8b' }, TODAY);
    expect(decision.allowed).toBe(true);
    expect(ids(decision)).toEqual(['A1']);
    // And `deepseek/*` is not `anthropic/fable-5`, which is example 21's shape.
    const other = await decide(policies, alice, BILLING, 'agent', { agent: 'claude', model: 'deepseek/deepseek-v4.1-flash' }, TODAY);
    expect(ids(other)).toEqual(['A1']);
  });
});

describe('the windows, example 28 and 30 without their limits', () => {
  const turn = (day: string) => decide(policies, alice, BILLING, 'agent', { agent: 'claude', model: 'anthropic/fable-5' }, at(day));

  it('leaves A6 out before it starts, and the answer is the same', async () => {
    const decision = await turn('2026-10-20');
    expect(decision.allowed).toBe(true);
    expect(ids(decision)).toEqual(['A2', 'A3']);
  });

  it('has A6 as a candidate once it starts', async () => {
    const decision = await turn('2026-10-23');
    expect(decision.allowed).toBe(true);
    expect(ids(decision)).toEqual(['A2', 'A3', 'A6']);
  });

  it('leaves A6 out again once its `until` has passed', async () => {
    const decision = await turn('2026-11-01');
    expect(decision.allowed).toBe(true);
    expect(ids(decision)).toEqual(['A2', 'A3']);
  });
});