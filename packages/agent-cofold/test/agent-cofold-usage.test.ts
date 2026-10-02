import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFakeModel } from '@cofold/agents/testing';
import type { ModelAdapter } from '@cofold/agents';
import { createHost } from '../../sdk/src/host.js';
import { cofoldAgent } from '../src/index.js';
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
async function talking(model: ModelAdapter, tools: HostTool[] = []) {
  const host = createHost({
    path: mkdtempSync(join(tmpdir(), 'ahpd-cofold-usage-')),
    agents: [cofoldAgent({ adapter: model, memory: true })],
    ...(tools.length > 0 ? { tools } : {}),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/one';
  const chatUri = 'ahp-chat:/one';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'cofold' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { client, peer: p, uri, chatUri };
}

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
  const writes = totals(p, chatUri).map((one) => (one._meta as { cacheWriteTokens?: number } | undefined)?.cacheWriteTokens);
  expect(writes).toEqual([undefined, 7, 7]);
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
  expect(last?._meta).toEqual({ cost: { amount: 0.0009, currency: 'USD' } });
  expect((totals(p, chatUri)[0]?._meta as Record<string, unknown> | undefined)?.cost).toBeUndefined();
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
