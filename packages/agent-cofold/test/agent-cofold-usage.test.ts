import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createFakeModel } from '@cofold/agents/testing';
import type { ModelAdapter } from '@cofold/agents';
import { createHost } from '../../sdk/src/host.js';
import { cofoldAgent } from '../src/index.js';
import { metaKeys } from '../../../tools/wire.mjs';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { HostTool } from '../../sdk/src/types/host.js';

/*
 * What a cofold turn says it used, as the steps of that turn go by.
 *
 * A turn that runs a tool is two model steps, and each is a call of its own
 * with its own counts. So the usage a turn reports is the sum over the steps,
 * sent after every one of them and once more as the run finishes, with the
 * price cofold put on the run. Driven through a host, as the turn cases in
 * `agent-cofold-turn.test.ts` are.
 */

/*
 * The last three cases run against an endpoint rather than an adapter: the
 * model is chosen from the catalogue an OpenAI-compatible `GET /models`
 * published, and the price travels from that list into the turn's adapter, so
 * what the turn cost is the endpoint's own number rather than a stub's.
 */
let home: string;
let had: string | undefined;
let real: typeof fetch;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-cofold-usage-'));
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  real = globalThis.fetch;
});

afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
  globalThis.fetch = real;
  rmSync(home, { recursive: true, force: true });
});

/** A harness file naming one provider, whose model is what a session starts on. */
const CONFIG = {
  providers: [{ id: 'open_router', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' }],
  model: 'open_router/deepseek/deepseek-chat',
};

const put = (value: unknown): void => {
  mkdirSync(join(home, 'cofold'), { recursive: true });
  writeFileSync(join(home, 'cofold', 'config.json'), JSON.stringify(value));
};

/** OpenRouter's price for `deepseek/deepseek-chat`, per token as it publishes it. */
const PRICE = { prompt: '0.000003', completion: '0.000015' };

/** One step of a streamed reply, carrying the counts `include_usage` asks for. */
const CHUNK = {
  choices: [{ delta: { content: 'hello back' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 20 },
};

/** Server-sent events, as an OpenAI-compatible endpoint frames them. */
const sse = (chunk: unknown): string => `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`;

/**
 * Stand in for the endpoint's two routes, recording both.
 *
 * The provider captures the `fetch` it was built with, so a stub swapped in
 * later is one a provider built after it would use: what a stub sees is what
 * the transport that reached it was.
 */
const serving = (listed: unknown): { calls: string[]; chat: () => number } => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/models')) {
      return new Response(JSON.stringify(listed), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(sse(CHUNK), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return { calls, chat: () => calls.filter((one) => one.endsWith('/chat/completions')).length };
};

/** What the endpoint says it serves, with the price it published for the model. */
const WITH_PRICE = { data: [{ id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', pricing: PRICE }] };

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

/** Let the run's zero-delay work finish, up to a point; no wall-clock waiting on a real model. */
const until = async (check: () => boolean, times = 400): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

type Note = { channel: string; action: Record<string, unknown> };

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type));

/** The usages a turn sent, in the order it sent them. */
const totals = (p: ReturnType<typeof peer>, chatUri: string): Record<string, unknown>[] => actions(p, chatUri)
  .filter((e) => e.action.type === 'chat/usage')
  .map((e) => e.action.usage as Record<string, unknown>);

const ended = (p: ReturnType<typeof peer>, chatUri: string): boolean =>
  types(p, chatUri).some((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled');

/** A connected client with one cofold session, watching both its channels. */
async function watching(host: ReturnType<typeof createHost>) {
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/one';
  const chatUri = 'ahp-chat:/one';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'cofold' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { client, peer: p, uri, chatUri };
}

/** The same, over an adapter rather than an endpoint. */
async function talking(model: ModelAdapter, tools: HostTool[] = []) {
  return watching(createHost({
    path: mkdtempSync(join(tmpdir(), 'ahpd-cofold-usage-')),
    agents: [cofoldAgent({ adapter: model, memory: true })],
    ...(tools.length > 0 ? { tools } : {}),
  }));
}

/**
 * The same, over the configured endpoint.
 *
 * The catalogue is read before any turn runs, as the daemon reads it at boot:
 * a turn takes the price and the context size from what the list already said
 * rather than waiting for it.
 */
async function online() {
  const agent = cofoldAgent({ memory: true });
  await agent.probe?.();
  return watching(createHost({
    path: mkdtempSync(join(tmpdir(), 'ahpd-cofold-usage-')),
    agents: [agent],
  }));
}

/** The action a turn began with, dispatched the way a client dispatches it. */
const begin = (
  client: Awaited<ReturnType<typeof watching>>['client'],
  chatUri: string,
  turnId: string,
  text: string,
): void => {
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text } } },
  });
};

/** A model priced per million, so the run's tally carries a cost. */
const PRICING = { inputPerMillion: 3, outputPerMillion: 15, currency: 'USD' } as const;

const lookup: HostTool = {
  definition: {
    name: 'lookup',
    title: 'Look something up',
    description: 'Looks a word up.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  run: (input) => `found ${String((input as { query?: unknown }).query)}`,
};

it('grows the total it sends with every step, and ends on the run\'s own tally', async () => {
  const model = createFakeModel({
    script: [
      { toolCalls: [{ name: 'lookup', input: { query: 'x' } }], usage: { inputTokens: 100, outputTokens: 20 } },
      { text: 'done', usage: { inputTokens: 50, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 7 } },
    ],
    stream: true,
    pricing: PRICING,
  });
  const { client, peer: p, chatUri } = await talking(model, [lookup]);
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'find x' } } },
  });
  await until(() => ended(p, chatUri));

  // One total per step and one for the run, each the sum of the steps up to it.
  expect(totals(p, chatUri).map((one) => [one.inputTokens, one.outputTokens, one.cacheReadTokens])).toEqual([
    [100, 20, undefined],
    [150, 30, 5],
    [150, 30, 5],
  ]);
  // The cache write rides `_meta`, summed as the counts beside it are.
  const writes = totals(p, chatUri).map((one) => (one._meta as { 'ahpd.cacheWriteTokens'?: number } | undefined)?.['ahpd.cacheWriteTokens']);
  expect(writes).toEqual([undefined, 7, 7]);
  // The census the wire test runs, over every report: no bare usage key.
  expect([...new Set(totals(p, chatUri).flatMap((one) => metaKeys(one).map(({ key }) => key)))].sort())
    .toEqual(['ahpd.cacheWriteTokens', 'ahpd.cost']);
  // Every total went out before the turn ended, or a client hangs it on a turn
  // that has already left the running list.
  const chat = types(p, chatUri);
  expect(chat.lastIndexOf('chat/usage')).toBeLessThan(chat.indexOf('chat/turnComplete'));
});

it('sends the run\'s cost, in dollars, with the total that ends the turn', async () => {
  const model = createFakeModel({
    script: [
      { toolCalls: [{ name: 'lookup', input: { query: 'x' } }], usage: { inputTokens: 100, outputTokens: 20 } },
      { text: 'done', usage: { inputTokens: 50, outputTokens: 10 } },
    ],
    stream: true,
    pricing: PRICING,
  });
  const { client, peer: p, chatUri } = await talking(model, [lookup]);
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'find x' } } },
  });
  await until(() => ended(p, chatUri));

  // The steps sent counts; only the run's tally carries what they cost, because
  // only the run knows the adapter's price. Both steps at the rates above,
  // which is what `costOf` rounds to micro-dollars.
  const last = totals(p, chatUri).at(-1);
  expect(last?._meta).toEqual({ 'ahpd.cost': { amount: 0.0009, currency: 'USD' } });
  expect((totals(p, chatUri)[0]?._meta as Record<string, unknown> | undefined)?.['ahpd.cost']).toBeUndefined();
});

it('sends no cost for a model with no price row', async () => {
  const model = createFakeModel({
    script: [{ text: 'hi', usage: { inputTokens: 12, outputTokens: 3 } }],
    stream: true,
  });
  const { client, peer: p, chatUri } = await talking(model);
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
  });
  await until(() => ended(p, chatUri));

  // An unpriced adapter is not a zero-cost one: there is no number to send, and
  // sending zero would read as the call having been free.
  for (const total of totals(p, chatUri)) {
    expect(total._meta).toBeUndefined();
  }
});

it('counts the second turn from nothing, rather than on what the first used', async () => {
  const model = createFakeModel({
    script: [
      { text: 'first', usage: { inputTokens: 100, outputTokens: 20 } },
      { text: 'second', usage: { inputTokens: 7, outputTokens: 3 } },
    ],
    stream: true,
  });
  const { client, peer: p, chatUri } = await talking(model);
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'one' } } },
  });
  await until(() => types(p, chatUri).filter((type) => type === 'chat/turnComplete').length === 1);
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't2', message: { text: 'two' } } },
  });
  await until(() => types(p, chatUri).filter((type) => type === 'chat/turnComplete').length === 2);

  expect(totals(p, chatUri).map((one) => one.inputTokens)).toEqual([100, 100, 7, 7]);
});

it('prices a real endpoint\'s turn from the price its catalogue published', async () => {
  put(CONFIG);
  const endpoint = serving(WITH_PRICE);
  const { client, peer: p, chatUri } = await online();
  begin(client, chatUri, 't1', 'hello');
  await until(() => ended(p, chatUri));

  expect(endpoint.calls).toEqual([
    'https://openrouter.ai/api/v1/models',
    'https://openrouter.ai/api/v1/chat/completions',
  ]);
  // The counts are the endpoint's answer, and the money is cofold's own tally
  // at the rates the list gave: 100 input at 3 and 20 output at 15 per million,
  // which `costOf` rounds to micro-dollars.
  const last = totals(p, chatUri).at(-1);
  expect(last).toMatchObject({ inputTokens: 100, outputTokens: 20 });
  expect(last?._meta).toEqual({ 'ahpd.cost': { amount: 0.0006, currency: 'USD' } });
});

it('sends no cost for a listed model the endpoint published no price for', async () => {
  put(CONFIG);
  serving({ data: [{ id: 'deepseek/deepseek-chat', name: 'DeepSeek V3' }] });
  const { client, peer: p, chatUri } = await online();
  begin(client, chatUri, 't1', 'hello');
  await until(() => ended(p, chatUri));

  // An unpriced model is not a free one: there is no number to send, and a zero
  // would read as the call having cost nothing.
  expect(totals(p, chatUri)).toHaveLength(2);
  for (const total of totals(p, chatUri)) {
    expect(total._meta).toBeUndefined();
  }
});

it('holds one provider for an endpoint and key, so a later turn keeps its transport', async () => {
  put(CONFIG);
  const first = serving(WITH_PRICE);
  const { client, peer: p, chatUri } = await online();
  begin(client, chatUri, 't1', 'hello');
  await until(() => types(p, chatUri).filter((type) => type === 'chat/turnComplete').length === 1);

  /*
   * The provider is built once and captures the `fetch` it was built with, so a
   * stub swapped in now is one only a provider built after it could reach: the
   * second turn going to the first stub is the two turns sharing one transport.
   */
  const second = serving(WITH_PRICE);
  begin(client, chatUri, 't2', 'again');
  await until(() => types(p, chatUri).filter((type) => type === 'chat/turnComplete').length === 2);

  expect(first.chat()).toBe(2);
  expect(second.chat()).toBe(0);
  expect(second.calls).toEqual([]);
});
