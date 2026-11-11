/*
 * A call is held to the `model` policies, and each answered call is recorded
 * against the caller's pools.
 *
 * The providers are fakes on loopback, the policies and the usage store are in
 * memory, and the people are a users file in a temporary folder.
 */

import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMinuteMeter, memoryPolicies, type MinuteMeter, type ModelUse, type Policies, type Policy, type PolicyLimit, type Usage, type UsageTotal } from '@ahpd/sdk';
import {
  answerJson, fakeProvider, isAnthropicError, isOpenAiError, MARKER, memoryUsage, pause, people, ROOT_TOKEN, send, serveProxy,
  type FakeProvider, type People, type ProviderFixture, type Served, type ServeOptions,
} from './fixtures/proxy-harness.js';
import type { ProxySetting } from '../src/proxy/providers.js';

let folder: string;
let who: People;
const open: Served[] = [];
const fakes: FakeProvider[] = [];

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'ahpd-proxy-policy-'));
  who = await people(folder);
});

afterEach(async () => {
  for (const one of open.splice(0)) await one.close();
  for (const one of fakes.splice(0)) await one.close();
  rmSync(folder, { recursive: true, force: true });
});

const CHAT = '/v1/chat/completions';
const MESSAGES = '/v1/messages';

/** A store holding these rows. */
const rows = async (...given: Policy[]): Promise<Policies> => {
  const store = memoryPolicies();
  for (const one of given) await store.put(one);
  return store;
};

const ALLOW_ALL: Policy = { id: 'everyone', scope: 'all', kind: 'model', effect: 'allow', match: { model: ['*'] } };
const DENY_OPENAI: Policy = { id: 'no-openai', scope: 'all', kind: 'model', effect: 'deny', match: { model: ['openai/*'] } };
const LOCAL_ONLY: Policy = { id: 'local-only', scope: 'team:backend', kind: 'model', effect: 'allow', match: { proxy: ['local'] } };
/** A row everybody's calls may use, for a week's `usd` that the store says how much of is spent. */
const LIMITED: Policy = {
  id: 'budget',
  scope: 'all',
  kind: 'model',
  effect: 'allow',
  match: { model: ['*'] },
  limits: [{ measure: 'usd', period: 'week', amount: 4, pool: 'shared' }],
};

/** A usage store answering these totals, and keeping every record written. */
const keeping = (totals: Record<string, UsageTotal> = {}): Usage & { entries: ModelUse[] } => {
  const entries: ModelUse[] = [];
  return {
    entries,
    record: async (entry) => { entries.push(entry as ModelUse); },
    total: async (key) => totals[key] ?? {},
    pools: async () => Object.keys(totals),
    records: async () => [],
    groups: async () => [],
  };
};

/**
 * Softov's model names, with every connector pointed at fakes: `openrouter` and
 * `anthropic` at `remote`, `local` at `local`, each answering its own dialect.
 */
const softov = (remote: string, local: string): { proxy: ProxySetting; providers: ProviderFixture[] } => ({
  proxy: {
    models: {
      'anthropic/claude-sonnet-5-5': [
        { provider: 'anthropic', id: 'claude-sonnet-5-5' },
        { provider: 'openrouter', id: 'anthropic/claude-sonnet-5.5', price: { input: 2, output: 10 } },
      ],
      'openai/gpt-5.5': [{ provider: 'openrouter', id: 'openai/gpt-5.5', price: { input: 5, output: 30 } }],
      'local/default': [{ provider: 'local', id: 'local-model' }],
      // A price with one side only, and a price of nothing at all.
      'local/output-only': [{ provider: 'local', id: 'local-model', price: { output: 2 } }],
      'local/free': [{ provider: 'local', id: 'local-model', price: { input: 0, output: 0 } }],
    },
  },
  providers: [
    { id: 'openrouter', adapter: 'openrouter', endpoint: remote, accepts: ['openai-chat'] },
    { id: 'anthropic', adapter: 'anthropic', endpoint: remote, accepts: ['anthropic-messages'] },
    { id: 'local', adapter: 'openai-compatible', endpoint: local, key: null },
  ],
});

/** An OpenAI chat completion reporting usage. */
const COMPLETION = {
  id: 'c', object: 'chat.completion', choices: [],
  usage: { prompt_tokens: 1200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 200 } },
};

/** The usage OpenRouter reports: a cost, and the two sides it is made of. */
const REPORTED_USAGE = {
  prompt_tokens: 1200,
  completion_tokens: 300,
  prompt_tokens_details: { cached_tokens: 200 },
  cost: 0.000204,
  cost_details: { upstream_inference_prompt_cost: 0.000104, upstream_inference_completions_cost: 0.0001 },
};

/** The same answer, reporting a cost. */
const REPORTED = { ...COMPLETION, usage: REPORTED_USAGE };

/** What a record keeps of that report: the amount, and the split it came in. */
const REPORTED_COST = { amount: 0.000204, currency: 'usd', from: 'harness', input: 0.000104, output: 0.0001 };

/** A row of two calls a minute, which is the rate limit of a proxy. */
const MINUTE_CALLS: Policy = {
  id: 'burst',
  scope: 'all',
  kind: 'model',
  effect: 'allow',
  match: { model: ['*'] },
  limits: [{ measure: 'calls', period: 'minute', amount: 2, pool: 'shared' }],
};

/**
 * A meter whose clock does not move.
 *
 * The proxy reads the meter at the time of the call, so a test that ran across
 * a minute boundary would see the count start again. One instant, so the three
 * calls are always in one minute.
 */
const pinned = (): MinuteMeter => {
  const at = new Date('2026-10-20T12:00:00.000Z');
  const meter = createMinuteMeter();
  return {
    add: (key, amount) => { meter.add(key, amount, at); },
    sum: (key) => meter.sum(key, at),
  };
};

/** Two fakes answering a chat completion, and the proxy over them with Softov's table. */
const setup = async (options: ServeOptions = {}, answer: unknown = COMPLETION) => {
  const remote = await fakeProvider(answerJson(200, answer));
  const local = await fakeProvider(answerJson(200, answer));
  fakes.push(remote, local);
  const usage = memoryUsage();
  const served = await serveProxy({ users: who.users, ...softov(remote.endpoint, local.endpoint), usage: () => usage, ...options });
  open.push(served);
  return { remote, local, usage, served };
};

/** The records written, once their writes have settled. */
const settled = async (usage: { entries: unknown[] }, count: number): Promise<ModelUse[]> => {
  const until = Date.now() + WAIT_MS;
  while (usage.entries.length < count && Date.now() < until) await pause(10);
  await pause(20);
  return usage.entries as ModelUse[];
};

describe('a policy decides the model', () => {
  it('refuses a call a deny row names, naming the row, without touching a provider', async () => {
    const { served, remote } = await setup({ policies: await rows(ALLOW_ALL, DENY_OPENAI), policiesCheck: true });
    const got = await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5' } });
    expect(got.status).toBe(403);
    expect(isOpenAiError(got.json)).toBe(true);
    expect(got.json).toMatchObject({ error: { type: 'permission_error', message: 'no-openai refuses model openai/gpt-5.5 through proxy openrouter' } });
    expect(remote.received).toEqual([]);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default' } })).status).toBe(200);
  });

  it('goes only through a provider a row allows, and says no policy allows the rest', async () => {
    const { served, local, remote } = await setup({ policies: await rows(LOCAL_ONLY), policiesCheck: true });
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default' } })).status).toBe(200);
    expect(local.received).toHaveLength(1);
    const refused = await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5' } });
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ error: { message: 'no policy allows model openai/gpt-5.5 through proxy openrouter' } });
    const messages = await send(served.port, MESSAGES, { headers: { 'x-api-key': who.ana }, body: { model: 'anthropic/claude-sonnet-5-5' } });
    expect(messages.status).toBe(403);
    expect(isAnthropicError(messages.json)).toBe(true);
    expect(remote.received).toEqual([]);
  });

  it('does not check root, nor anybody with the checks off', async () => {
    const strict = await setup({ policies: await rows(DENY_OPENAI), policiesCheck: true });
    expect((await send(strict.served.port, CHAT, { headers: { authorization: `Bearer ${ROOT_TOKEN}` }, body: { model: 'openai/gpt-5.5' } })).status).toBe(200);
    const off = await setup({ policies: await rows(DENY_OPENAI), policiesCheck: false });
    expect((await send(off.served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5' } })).status).toBe(200);
  });

  it('refuses when the store cannot be read', async () => {
    const broken: Policies = { ...memoryPolicies(), list: async () => { throw new Error('the store is unreadable'); } };
    const { served, remote } = await setup({ policies: broken, policiesCheck: true });
    const got = await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default' } });
    expect(got.status).toBe(403);
    expect(got.json).toMatchObject({ error: { message: 'no policy could be read, so model is refused: the store is unreadable' } });
    expect(remote.received).toEqual([]);
  });
});

describe('a call at a limit', () => {
  /** Two fakes answering, and a proxy over them with the limited row and this usage store. */
  const limited = async (usage: Usage & { entries: ModelUse[] }) => {
    const remote = await fakeProvider(answerJson(200, COMPLETION));
    const local = await fakeProvider(answerJson(200, COMPLETION));
    fakes.push(remote, local);
    const served = await serveProxy({
      users: who.users, ...softov(remote.endpoint, local.endpoint),
      usage: () => usage, policies: await rows(LIMITED), policiesCheck: true,
    });
    open.push(served);
    return { remote, local, served };
  };

  it('refuses a call on a row at its amount, with the limit sentence, without touching a provider', async () => {
    const usage = keeping({ 'policy:budget/usd': { usd: 4 } });
    const { remote, local, served } = await limited(usage);
    const got = await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default' } });
    expect(got.status).toBe(403);
    expect(isOpenAiError(got.json)).toBe(true);
    expect(got.json).toMatchObject({ error: { type: 'permission_error', message: 'budget has no room: 4 / 4 usd this week' } });
    expect(remote.received).toEqual([]);
    expect(local.received).toEqual([]);
    expect(usage.entries).toEqual([]);
  });

  it('still lists a model at its limit, whose call is then refused', async () => {
    const usage = keeping({ 'policy:budget/usd': { usd: 4 } });
    const { served } = await limited(usage);
    const listed = await send(served.port, '/v1/models', { headers: { 'x-api-key': who.ana } });
    expect(listed.status).toBe(200);
    expect((listed.json as { data: { id: string }[] }).data.map((one) => one.id)).toContain('local/default');
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default' } })).status).toBe(403);
  });

  it('allows two calls a minute and refuses the third in the same minute', async () => {
    const { served } = await setup({ policies: await rows(MINUTE_CALLS), policiesCheck: true, meter: pinned() });
    const headers = { 'x-api-key': who.ana };
    const body = { model: 'local/default' };
    expect((await send(served.port, CHAT, { headers, body })).status).toBe(200);
    expect((await send(served.port, CHAT, { headers, body })).status).toBe(200);
    const third = await send(served.port, CHAT, { headers, body });
    expect(third.status).toBe(403);
    expect(isOpenAiError(third.json)).toBe(true);
    expect(third.json).toMatchObject({ error: { type: 'permission_error', message: 'burst has no room: 2 / 2 calls this minute' } });
  });

  it('counts one request once when a name is served by two connectors', async () => {
    const remote = await fakeProvider(answerJson(200, COMPLETION));
    fakes.push(remote);
    const meter = pinned();
    const served = await serveProxy({
      users: who.users,
      // One name, two connectors, so the policy walk judges two entries and the
      // request sends to the first of them. That is still one call.
      proxy: {
        models: { 'local/twin': [{ provider: 'one', id: 'twin' }, { provider: 'two', id: 'twin' }] },
      },
      providers: [
        { id: 'one', adapter: 'openai-compatible', endpoint: remote.endpoint, key: null },
        { id: 'two', adapter: 'openai-compatible', endpoint: remote.endpoint, key: null },
      ],
      usage: () => memoryUsage(),
      policies: await rows(MINUTE_CALLS),
      policiesCheck: true,
      meter,
    });
    open.push(served);
    const headers = { 'x-api-key': who.ana };
    const body = { model: 'local/twin' };
    expect((await send(served.port, CHAT, { headers, body })).status).toBe(200);
    // Two entries were walked and one candidate was sent to, so the count is 1.
    expect(meter.sum('policy:burst/calls')).toBe(1);
    expect((await send(served.port, CHAT, { headers, body })).status).toBe(200);
    expect(meter.sum('policy:burst/calls')).toBe(2);
    const third = await send(served.port, CHAT, { headers, body });
    expect(third.status).toBe(403);
    expect(isOpenAiError(third.json)).toBe(true);
    expect(third.json).toMatchObject({ error: { type: 'permission_error', message: 'burst has no room: 2 / 2 calls this minute' } });
  });

  it('writes the check\'s key on an allowed call\'s record, beside the owner, team and project', async () => {
    const usage = keeping({ 'policy:budget/usd': { usd: 1 } });
    const { served } = await limited(usage);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default' } })).status).toBe(200);
    const [entry] = await settled(usage, 1);
    expect(entry).toMatchObject({
      owner: 'user:ana',
      team: 'backend',
      project: 'billing',
      pools: ['user:ana', 'team:backend', 'project:backend:billing', 'policy:budget/usd'],
    });
  });

  // A name the table does not hold goes to the connector its prefix names, as
  // `openrouter/openai/gpt-4o` does on a host with no `models`.
  it('writes the check\'s key on the record of a fetched name', async () => {
    const usage = keeping({ 'policy:budget/usd': { usd: 1 } });
    const { served } = await limited(usage);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openrouter/meta/llama-4' } })).status).toBe(200);
    const [entry] = await settled(usage, 1);
    expect(entry?.model.name).toBe('openrouter/meta/llama-4');
    expect(entry?.pools).toEqual(['user:ana', 'team:backend', 'project:backend:billing', 'policy:budget/usd']);
  });

  it('writes a pooled row\'s key under its pool on the record of a fetched name', async () => {
    const usage = keeping();
    const remote = await fakeProvider(answerJson(200, COMPLETION));
    const local = await fakeProvider(answerJson(200, COMPLETION));
    fakes.push(remote, local);
    const served = await serveProxy({
      users: who.users, ...softov(remote.endpoint, local.endpoint),
      usage: () => usage, policies: await rows({ ...LIMITED, pool: 'xxx' }), policiesCheck: true,
    });
    open.push(served);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openrouter/meta/llama-4' } })).status).toBe(200);
    const [entry] = await settled(usage, 1);
    expect(entry?.pools).toContain('pool:xxx/usd');
  });

  it('counts a fetched name\'s calls, and refuses the third in the same minute', async () => {
    const { served } = await setup({ policies: await rows(MINUTE_CALLS), policiesCheck: true, meter: pinned() });
    const headers = { 'x-api-key': who.ana };
    const body = { model: 'openrouter/meta/llama-4' };
    expect((await send(served.port, CHAT, { headers, body })).status).toBe(200);
    expect((await send(served.port, CHAT, { headers, body })).status).toBe(200);
    const third = await send(served.port, CHAT, { headers, body });
    expect(third.status).toBe(403);
    expect(third.json).toMatchObject({ error: { type: 'permission_error', message: 'burst has no room: 2 / 2 calls this minute' } });
  });
});

describe('a key\'s own limit', () => {
  /**
   * Ana's key with `limits`, and the proxy over two fakes.
   *
   * The totals are built from the key's id, because that is what the key's pool
   * is named after: one key has one total of each measure.
   */
  const keyed = async (
    limits: PolicyLimit[],
    totals: (id: string) => Record<string, UsageTotal>,
    options: ServeOptions = {},
  ) => {
    const minted = await who.users.mintToken!('ana', { limits });
    const usage = keeping(totals(minted.id));
    const remote = await fakeProvider(answerJson(200, COMPLETION));
    const local = await fakeProvider(answerJson(200, COMPLETION));
    fakes.push(remote, local);
    const served = await serveProxy({
      users: who.users, ...softov(remote.endpoint, local.endpoint),
      usage: () => usage, ...options,
    });
    open.push(served);
    return { remote, local, served, usage, secret: minted.secret, key: minted.id };
  };

  const TWO_CALLS: PolicyLimit[] = [{ amount: 2, measure: 'calls', period: 'day', pool: 'shared' }];

  it('refuses a call of a key at its amount, without touching a provider', async () => {
    const { served, secret, key, remote, local } = await keyed(
      TWO_CALLS,
      (id) => ({ [`pool:token:${id}/calls`]: { calls: 2 } }),
      { policies: await rows(ALLOW_ALL), policiesCheck: true },
    );
    const got = await send(served.port, CHAT, { headers: { 'x-api-key': secret }, body: { model: 'local/default' } });
    expect(got.status).toBe(403);
    expect(isOpenAiError(got.json)).toBe(true);
    expect(got.json).toMatchObject({ error: { type: 'permission_error', message: `token:${key} has no room: 2 / 2 calls this day` } });
    expect(remote.received).toEqual([]);
    expect(local.received).toEqual([]);
  });

  it('holds with the policy switch off, where no store is read', async () => {
    const { served, secret, key } = await keyed(
      TWO_CALLS,
      (id) => ({ [`pool:token:${id}/calls`]: { calls: 2 } }),
      { policiesCheck: false },
    );
    const got = await send(served.port, CHAT, { headers: { 'x-api-key': secret }, body: { model: 'local/default' } });
    expect(got.status).toBe(403);
    expect(got.json).toMatchObject({ error: { message: `token:${key} has no room: 2 / 2 calls this day` } });
  });

  it('writes the key\'s pool on an allowed call, beside the person\'s', async () => {
    const { served, usage, secret, key } = await keyed(TWO_CALLS, () => ({}), { policies: await rows(ALLOW_ALL), policiesCheck: true });
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': secret }, body: { model: 'local/default' } })).status).toBe(200);
    const [entry] = await settled(usage, 1);
    expect(entry).toMatchObject({
      owner: 'user:ana',
      pools: ['user:ana', 'team:backend', 'project:backend:billing', `pool:token:${key}/calls`],
    });
  });
});

describe('a team key', () => {
  /** A key of the team this host names, and the proxy over two fakes. */
  const teamKey = async (policies?: Policies) => {
    const minted = await who.users.mintToken!(undefined, { team: 'backend', grants: ['proxy:call', 'proxy:models'], label: 'ci' });
    const usage = keeping();
    const remote = await fakeProvider(answerJson(200, COMPLETION));
    const local = await fakeProvider(answerJson(200, COMPLETION));
    fakes.push(remote, local);
    const served = await serveProxy({
      users: who.users, ...softov(remote.endpoint, local.endpoint), usage: () => usage,
      ...(policies === undefined ? {} : { policies, policiesCheck: true }),
    });
    open.push(served);
    return { remote, local, served, usage, secret: minted.secret, id: minted.id };
  };

  it('records a call as the team\'s, with one pool and no project', async () => {
    const { served, usage, secret, id } = await teamKey();
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': secret }, body: { model: 'local/default' } })).status).toBe(200);
    const [entry] = await settled(usage, 1);
    expect(entry).toMatchObject({ owner: 'team:backend', team: 'backend', token: id, pools: ['team:backend'] });
    expect(entry?.project).toBeUndefined();
  });

  it('holds a team key to the team\'s rows, and to no user: row', async () => {
    const store = await rows(
      { id: 'team-local', scope: 'team:backend', kind: 'model', effect: 'allow', match: { model: ['local/*'] } },
      // Spelled as a person's id, which is the one a team principal carries: a
      // `user:` row holds no team key, so this deny binds nobody here.
      { id: 'person-only', scope: 'user:team:backend', kind: 'model', effect: 'deny', match: { model: ['local/default'] } },
    );
    const { served, secret, local } = await teamKey(store);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': secret }, body: { model: 'local/default' } })).status).toBe(200);
    expect(local.received).toHaveLength(1);
  });

  it('refuses a name a team:backend deny row names', async () => {
    const store = await rows(
      { id: 'team-all', scope: 'team:backend', kind: 'model', effect: 'allow', match: { model: ['*'] } },
      { id: 'no-local', scope: 'team:backend', kind: 'model', effect: 'deny', match: { model: ['local/*'] } },
    );
    const { served, secret, local } = await teamKey(store);
    const got = await send(served.port, CHAT, { headers: { 'x-api-key': secret }, body: { model: 'local/default' } });
    expect(got.status).toBe(403);
    expect(isOpenAiError(got.json)).toBe(true);
    expect(got.json).toMatchObject({ error: { message: 'no-local refuses model local/default through proxy local' } });
    expect(local.received).toEqual([]);
  });
});

describe('the call is recorded', () => {
  it('writes one record for a JSON answer, with the tokens, the price cost and the person\'s pools', async () => {
    const { served, usage } = await setup();
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5' } })).status).toBe(200);
    const [entry, ...more] = await settled(usage, 1);
    expect(more).toEqual([]);
    expect(entry).toMatchObject({
      kind: 'model',
      source: 'proxy',
      owner: 'user:ana',
      team: 'backend',
      project: 'billing',
      model: { name: 'openai/gpt-5.5', provider: 'openrouter', connector: 'openrouter', input: 1000, output: 300, cache: { read: 200 } },
      pools: ['user:ana', 'team:backend', 'project:backend:billing'],
    });
    // (1000 + 200) * $5 + 300 * $30, per million, split into what was sent and
    // what came back. The provider reported no cost of its own.
    expect(entry?.cost?.currency).toBe('usd');
    expect(entry?.cost?.from).toBe('price');
    expect(entry?.cost?.amount).toBeCloseTo((1200 * 5 + 300 * 30) / 1_000_000, 12);
    expect(entry?.cost?.input).toBeCloseTo((1200 * 5) / 1_000_000, 12);
    expect(entry?.cost?.output).toBeCloseTo((300 * 30) / 1_000_000, 12);
    expect(entry?.providerCost).toBeUndefined();
    expect(Date.parse(entry?.at ?? '')).not.toBeNaN();
    expect(entry?.session).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain(MARKER);
  });

  it('writes one record for an Anthropic stream, from message_start and the last message_delta', async () => {
    const remote = await fakeProvider((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":40,"cache_read_input_tokens":7,"cache_creation_input_tokens":3,"output_tokens":1}}}\n\n');
      response.write('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n');
      response.write('event: message_delta\r\ndata: {"type":"message_delta","usage":{"output_tokens":9}}\r\n\r\n');
      response.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    });
    fakes.push(remote);
    const usage = memoryUsage();
    const served = await serveProxy({ users: who.users, ...softov(remote.endpoint, remote.endpoint), usage: () => usage });
    open.push(served);
    await send(served.port, MESSAGES, { headers: { 'x-api-key': who.ana, 'x-ahp-scope': 'backend:ahpd' }, body: { model: 'anthropic/claude-sonnet-5-5', stream: true } });
    const [entry] = await settled(usage, 1);
    expect(entry?.model).toEqual({ name: 'anthropic/claude-sonnet-5-5', provider: 'anthropic', connector: 'anthropic', input: 40, output: 9, cache: { read: 7, write: 3 } });
    expect(entry?.project).toBe('ahpd');
    // The anthropic entry has no price.
    expect(entry?.cost).toBeUndefined();
  });

  it('writes one record with no tokens for an OpenAI stream that did not ask for usage', async () => {
    const remote = await fakeProvider((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n');
    });
    fakes.push(remote);
    const usage = memoryUsage();
    const served = await serveProxy({ users: who.users, ...softov(remote.endpoint, remote.endpoint), usage: () => usage });
    open.push(served);
    await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5', stream: true } });
    const entries = await settled(usage, 1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.model).toEqual({ name: 'openai/gpt-5.5', provider: 'openrouter', connector: 'openrouter' });
    expect(entries[0]?.cost).toBeUndefined();
    expect(entries[0]?.providerCost).toBeUndefined();
    // Nothing was injected to ask for it.
    expect(JSON.parse(remote.received[0]?.body ?? '')).toEqual({ model: 'openai/gpt-5.5', stream: true });
  });

  it('writes one record with what was read when the stream is cut', async () => {
    const remote = await fakeProvider((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n', () => {
        setTimeout(() => { response.destroy(); }, 20);
      });
    });
    fakes.push(remote);
    const usage = memoryUsage();
    const served = await serveProxy({ users: who.users, ...softov(remote.endpoint, remote.endpoint), usage: () => usage });
    open.push(served);
    // The caller's connection is cut too, so the request fails rather than ending.
    await expect(send(served.port, MESSAGES, { headers: { 'x-api-key': who.ana }, body: { model: 'anthropic/claude-sonnet-5-5', stream: true } }))
      .rejects.toThrow(/aborted|ECONNRESET/u);
    const entries = await settled(usage, 1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.model).toMatchObject({ input: 12, output: 1 });
  });

  it('keeps the provider\'s own cost as both costs when the entry has no price', async () => {
    const { served, usage } = await setup({}, REPORTED);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default' } })).status).toBe(200);
    const [entry] = await settled(usage, 1);
    // Nothing prices the call, so what its pools are charged is what the
    // provider says it cost.
    expect(entry?.cost).toEqual(REPORTED_COST);
    expect(entry?.providerCost).toEqual(REPORTED_COST);
  });

  it('charges the entry\'s price and keeps the provider\'s figure beside it', async () => {
    const { served, usage } = await setup({}, REPORTED);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5' } })).status).toBe(200);
    const [entry] = await settled(usage, 1);
    expect(entry?.cost).toMatchObject({ from: 'price', currency: 'usd' });
    expect(entry?.cost?.amount).toBeCloseTo((1200 * 5 + 300 * 30) / 1_000_000, 12);
    expect(entry?.providerCost).toEqual(REPORTED_COST);
  });

  it('charges nothing for a side the price does not name when that side has tokens', async () => {
    const { served, usage } = await setup();
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/output-only' } })).status).toBe(200);
    const [entry] = await settled(usage, 1);
    // The call sent tokens and the price says nothing about them, so the cost
    // is not known - which is not the same as costing nothing.
    expect(entry?.model.input).toBe(1000);
    expect(entry?.cost).toBeUndefined();
    expect(entry?.providerCost).toBeUndefined();
  });

  it('charges a price of zero as zero, which is a free call and not an absent cost', async () => {
    const { served, usage } = await setup();
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/free' } })).status).toBe(200);
    const [entry] = await settled(usage, 1);
    expect(entry?.cost).toEqual({ amount: 0, currency: 'usd', from: 'price', input: 0, output: 0 });
  });

  it('reads the provider\'s cost from the last chunk of a streamed answer', async () => {
    const remote = await fakeProvider((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
      // OpenRouter reports the cost in the usage of the chunk that ends the
      // answer, not in the first one.
      response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 300, cost: 0.000204, cost_details: { upstream_inference_prompt_cost: 0.000104, upstream_inference_completions_cost: 0.0001 } } })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
    fakes.push(remote);
    const usage = memoryUsage();
    const served = await serveProxy({ users: who.users, ...softov(remote.endpoint, remote.endpoint), usage: () => usage });
    open.push(served);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default', stream: true } })).status).toBe(200);
    const [entry] = await settled(usage, 1);
    expect(entry?.model).toEqual({ name: 'local/default', provider: 'openai-compatible', connector: 'local', input: 1200, output: 300 });
    expect(entry?.providerCost).toEqual(REPORTED_COST);
    expect(entry?.cost).toEqual(REPORTED_COST);
  });

  it('charges root to root:<host>', async () => {
    const { served, usage } = await setup();
    await send(served.port, CHAT, { headers: { authorization: `Bearer ${ROOT_TOKEN}` }, body: { model: 'local/default' } });
    const [entry] = await settled(usage, 1);
    expect(entry?.owner).toBe('root:testbox');
    expect(entry?.pools).toEqual(['root:testbox']);
  });

  it('names the key a call was made with, and names none for a deployment token or a full sign-in', async () => {
    const { served, usage } = await setup();
    const key = await who.users.mintToken!('ana');
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': key.secret }, body: { model: 'local/default' } })).status).toBe(200);
    expect((await send(served.port, CHAT, { headers: { authorization: `Bearer ${ROOT_TOKEN}` }, body: { model: 'local/default' } })).status).toBe(200);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default' } })).status).toBe(200);
    const entries = await settled(usage, 3);
    expect(entries.map((entry) => entry.token)).toEqual([key.id, undefined, undefined]);
    // Nothing named a meta yet, so the record holds none.
    expect(entries[0]).not.toHaveProperty('meta');
  });

  it('writes the key\'s meta under the call\'s, so a name the key holds keeps its value', async () => {
    const { served, usage } = await setup();
    const key = await who.users.mintToken!('ana', { meta: { env: 'prod' } });
    const sent = await send(served.port, CHAT, {
      headers: { 'x-api-key': key.secret, 'x-ahp-meta': '{"env":"dev","client":"pi"}' },
      body: { model: 'local/default' },
    });
    expect(sent.status).toBe(200);
    const [entry] = await settled(usage, 1);
    expect(entry?.token).toBe(key.id);
    expect(entry?.meta).toEqual({ env: 'prod', client: 'pi' });
  });

  it('keeps answering when the store fails, and says so in the log', async () => {
    const remote = await fakeProvider(answerJson(200, COMPLETION));
    fakes.push(remote);
    const served = await serveProxy({
      users: who.users, ...softov(remote.endpoint, remote.endpoint),
      usage: () => ({ ...memoryUsage(), record: async () => { throw new Error('disk full'); } }),
    });
    open.push(served);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5' } })).status).toBe(200);
    await pause(30);
    expect(served.log.join('\n')).toContain('proxy: could not keep the record of a call to openai/gpt-5.5: disk full');
  });
});

describe('a session\'s call', () => {
  /** A `whose` answering `session-token` as a session Ana runs, in backend:billing. */
  const session = async () => {
    const ana = await who.users.verify(who.ana);
    if (ana === undefined) throw new Error('ana is not verified');
    return (token: string) => (token === 'session-token'
      ? { session: 's-1', chat: 'c-1', turn: 't-7', owner: 'user:ana' as const, principal: ana, scope: { team: 'backend', project: 'billing' } }
      : undefined);
  };

  it('is checked and recorded with its session, chat and turn when sessionCalls is record, or absent', async () => {
    for (const sessionCalls of ['record', undefined] as const) {
      const remote = await fakeProvider(answerJson(200, COMPLETION));
      fakes.push(remote);
      const usage = memoryUsage();
      const { proxy, providers } = softov(remote.endpoint, remote.endpoint);
      const table: ProxySetting = { ...proxy, ...(sessionCalls === undefined ? {} : { sessionCalls }) };
      const served = await serveProxy({
        users: who.users, proxy: table, providers, usage: () => usage,
        whose: await session(), policies: await rows(ALLOW_ALL, DENY_OPENAI), policiesCheck: true,
      });
      open.push(served);
      const denied = await send(served.port, CHAT, { headers: { 'x-api-key': 'session-token' }, body: { model: 'openai/gpt-5.5' } });
      expect(denied.status).toBe(403);
      expect(denied.json).toMatchObject({ error: { message: 'no-openai refuses model openai/gpt-5.5 through proxy openrouter' } });

      expect((await send(served.port, CHAT, { headers: { 'x-api-key': 'session-token' }, body: { model: 'local/default' } })).status).toBe(200);
      const [entry, ...more] = await settled(usage, 1);
      expect(more).toEqual([]);
      expect(entry).toMatchObject({
        source: 'proxy', session: 's-1', chat: 'c-1', turn: 't-7', owner: 'user:ana', team: 'backend', project: 'billing',
        pools: ['user:ana', 'team:backend', 'project:backend:billing'],
      });
    }
  });

  it('is neither checked nor recorded when sessionCalls is skip', async () => {
    const remote = await fakeProvider(answerJson(200, COMPLETION));
    fakes.push(remote);
    const usage = memoryUsage();
    const { proxy, providers } = softov(remote.endpoint, remote.endpoint);
    const served = await serveProxy({
      users: who.users, proxy: { ...proxy, sessionCalls: 'skip' }, providers, usage: () => usage,
      whose: await session(), policies: await rows(ALLOW_ALL, DENY_OPENAI), policiesCheck: true,
    });
    open.push(served);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': 'session-token' }, body: { model: 'openai/gpt-5.5' } })).status).toBe(200);
    await pause(50);
    expect(usage.entries).toEqual([]);
    // A person is still checked and recorded.
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5' } })).status).toBe(403);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default' } })).status).toBe(200);
    expect(await settled(usage, 1)).toHaveLength(1);
  });

  it('is not checked when whose names nobody, as on a host with no directory, and is still recorded', async () => {
    const remote = await fakeProvider(answerJson(200, COMPLETION));
    fakes.push(remote);
    const usage = memoryUsage();
    const served = await serveProxy({
      ...softov(remote.endpoint, remote.endpoint), usage: () => usage,
      whose: (token) => (token === 'session-token' ? { session: 's-2' } : undefined),
      policies: await rows(DENY_OPENAI), policiesCheck: true,
    });
    open.push(served);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': 'session-token' }, body: { model: 'openai/gpt-5.5' } })).status).toBe(200);
    const [entry] = await settled(usage, 1);
    expect(entry).toMatchObject({ session: 's-2', pools: [] });
    expect(entry?.owner).toBeUndefined();
  });
});
