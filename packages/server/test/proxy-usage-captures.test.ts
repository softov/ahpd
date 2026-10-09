/*
 * The tokens and the cost the proxy reads out of an answer, checked against
 * answers the providers really sent.
 *
 * Every file in `fixtures/proxy-usage/` is one such answer with the ids the
 * provider gave it taken out. A fake provider replays it byte for byte over the
 * proxy's own socket, and what is asserted is the record written for the call:
 * the tokens the answer reported - the cache counted once - and the cost beside
 * them.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Cost, ModelUse } from '@ahpd/sdk';
import {
  fakeProvider, memoryUsage, pause, people, send, serveProxy,
  type FakeProvider, type People, type Served,
} from './fixtures/proxy-harness.js';
import type { ProxySetting } from '../src/proxy/providers.js';

const CAPTURES = join(import.meta.dirname, 'fixtures', 'proxy-usage');
const MESSAGES = '/v1/messages';
const CHAT = '/v1/chat/completions';

let folder: string;
let who: People;
const open: Served[] = [];
const fakes: FakeProvider[] = [];

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'ahpd-proxy-usage-'));
  who = await people(folder);
});

afterEach(async () => {
  for (const one of open.splice(0)) await one.close();
  for (const one of fakes.splice(0)) await one.close();
  rmSync(folder, { recursive: true, force: true });
});

/**
 * Both providers answer at the fake, and no entry carries a price, so what a
 * record is charged is what the answer itself reported.
 */
const table = (endpoint: string): ProxySetting => ({
  providers: {
    openrouter: { endpoint, accepts: ['anthropic-messages', 'openai-chat'] },
    deepseek: { endpoint, accepts: ['anthropic-messages', 'openai-chat'] },
  },
  models: {
    'anthropic/claude-sonnet-4': [{ provider: 'openrouter', id: 'anthropic/claude-sonnet-4' }],
    'deepseek/deepseek-flash': [{ provider: 'deepseek', id: 'deepseek-flash' }],
  },
});

/** The tokens a record keeps of an answer. */
interface Tokens {
  input?: number;
  output?: number;
  cache?: { read?: number; write?: number };
}

/** One captured answer, and what the record of it must say. */
interface Case {
  /** Its file in `fixtures/proxy-usage/`. */
  file: string;
  /** The path the caller posts to, which is the dialect the answer is read as. */
  at: string;
  /** The `<maker>/<name>` the caller asks for. */
  name: string;
  /** The provider entry that serves that name. */
  provider: string;
  /** What the answer reported using. */
  tokens: Tokens;
  /** What it reported costing, when it reported that. */
  cost?: Cost;
}

/**
 * Each capture once. Anthropic's `input_tokens` already leaves the cache out,
 * so a token is in `input` or in `cache` and never in both; OpenAI's
 * `prompt_tokens` counts the cached ones, which the reader takes out.
 */
const CASES: Case[] = [
  {
    file: 'openrouter-anthropic-1.json',
    at: MESSAGES,
    name: 'anthropic/claude-sonnet-4',
    provider: 'openrouter',
    // The prompt was written to the cache and nothing was read from it.
    tokens: { input: 10, output: 6, cache: { read: 0, write: 5602 } },
    cost: { amount: 0.0211275, currency: 'usd', from: 'harness', input: 0.0210375, output: 0.00009 },
  },
  {
    file: 'openrouter-anthropic-1.sse',
    at: MESSAGES,
    name: 'anthropic/claude-sonnet-4',
    provider: 'openrouter',
    tokens: { input: 10, output: 6, cache: { read: 5602, write: 0 } },
    cost: { amount: 0.0018006, currency: 'usd', from: 'harness', input: 0.0017106, output: 0.00009 },
  },
  {
    file: 'openrouter-anthropic-2.json',
    at: MESSAGES,
    name: 'anthropic/claude-sonnet-4',
    provider: 'openrouter',
    tokens: { input: 10, output: 6, cache: { read: 5602, write: 0 } },
    cost: { amount: 0.0018006, currency: 'usd', from: 'harness', input: 0.0017106, output: 0.00009 },
  },
  {
    file: 'openrouter-anthropic-2.sse',
    at: MESSAGES,
    name: 'anthropic/claude-sonnet-4',
    provider: 'openrouter',
    tokens: { input: 10, output: 6, cache: { read: 5602, write: 0 } },
    cost: { amount: 0.0018006, currency: 'usd', from: 'harness', input: 0.0017106, output: 0.00009 },
  },
  {
    file: 'deepseek-anthropic-1.json',
    at: MESSAGES,
    name: 'deepseek/deepseek-flash',
    provider: 'deepseek',
    // DeepSeek reports tokens and no cost.
    tokens: { input: 242, output: 16, cache: { read: 4992, write: 0 } },
  },
  {
    file: 'deepseek-anthropic-1.sse',
    at: MESSAGES,
    name: 'deepseek/deepseek-flash',
    provider: 'deepseek',
    tokens: { input: 242, output: 16, cache: { read: 4992, write: 0 } },
  },
  {
    file: 'deepseek-anthropic-2.json',
    at: MESSAGES,
    name: 'deepseek/deepseek-flash',
    provider: 'deepseek',
    tokens: { input: 242, output: 16, cache: { read: 4992, write: 0 } },
  },
  {
    file: 'deepseek-anthropic-2.sse',
    at: MESSAGES,
    name: 'deepseek/deepseek-flash',
    provider: 'deepseek',
    tokens: { input: 242, output: 16, cache: { read: 4992, write: 0 } },
  },
  {
    file: 'deepseek-openai-1.json',
    at: CHAT,
    name: 'deepseek/deepseek-flash',
    provider: 'deepseek',
    // Nothing was cached, so the whole prompt is input and there is no cache.
    tokens: { input: 5234, output: 16 },
  },
  {
    file: 'deepseek-openai-1.sse',
    at: CHAT,
    name: 'deepseek/deepseek-flash',
    provider: 'deepseek',
    tokens: { input: 242, output: 16, cache: { read: 4992 } },
  },
  {
    file: 'deepseek-openai-2.json',
    at: CHAT,
    name: 'deepseek/deepseek-flash',
    provider: 'deepseek',
    tokens: { input: 242, output: 16, cache: { read: 4992 } },
  },
  {
    file: 'deepseek-openai-2.sse',
    at: CHAT,
    name: 'deepseek/deepseek-flash',
    provider: 'deepseek',
    tokens: { input: 242, output: 16, cache: { read: 4992 } },
  },
];

/** A capture's bytes as the file holds them. */
const bytesOf = (file: string): Buffer => readFileSync(join(CAPTURES, file));

/** The capture's file as text. */
const textOf = (file: string): string => bytesOf(file).toString('utf8');

/** The `data:` payloads of a captured stream, as the file holds them. */
const eventsOf = (file: string): Record<string, unknown>[] =>
  textOf(file)
    .split('\n')
    .filter((line) => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map((line) => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>);

/** The case one file is. */
const caseOf = (file: string): Case => {
  const found = CASES.find((one) => one.file === file);
  if (found === undefined) throw new Error(`${file} is not one of the captures`);
  return found;
};

/** The usage one fixture's answer reports, as it is written in the file. */
const usageOf = (file: string): Record<string, unknown> => {
  const answer = JSON.parse(textOf(file)) as { usage: Record<string, unknown> };
  return answer.usage;
};

/** One fixture replayed by a fake provider over a proxy, and the records it wrote. */
const replay = async (one: Case): Promise<{ answers: ModelUse[]; sent: number }> => {
  const streamed = one.file.endsWith('.sse');
  const bytes = bytesOf(one.file);
  const provider = await fakeProvider((_request, response) => {
    response.writeHead(200, { 'content-type': streamed ? 'text/event-stream' : 'application/json' });
    response.end(bytes);
  });
  fakes.push(provider);
  const usage = memoryUsage();
  const served = await serveProxy({ users: who.users, env: {}, proxy: table(provider.endpoint), usage: () => usage });
  open.push(served);
  const answered = await send(served.port, one.at, {
    headers: { 'x-api-key': who.ana },
    body: { model: one.name, ...(streamed ? { stream: true } : {}) },
  });
  expect(answered.status).toBe(200);
  expect(answered.text).toBe(textOf(one.file));
  const until = Date.now() + 1000;
  while (usage.entries.length < 1 && Date.now() < until) await pause(10);
  await pause(20);
  return { answers: usage.entries as ModelUse[], sent: usage.entries.length };
};

describe('a captured answer', () => {
  it('has one fixture and one case for each of the twelve', () => {
    expect(readdirSync(CAPTURES).sort()).toEqual(CASES.map((one) => one.file).sort());
  });

  for (const one of CASES) {
    it(`is read as the record of ${one.file}`, async () => {
      const { answers, sent } = await replay(one);
      expect(sent).toBe(1);
      const [entry] = answers;
      expect(entry?.source).toBe('proxy');
      // The tokens the answer reported, with the cache counted once.
      expect(entry?.model).toEqual({ name: one.name, provider: one.provider, ...one.tokens });
      // No entry carries a price, so the pools are charged what the answer
      // reported - the same figure kept beside it as the provider's cost.
      expect(entry?.providerCost).toEqual(one.cost);
      expect(entry?.cost).toEqual(one.cost);
    });
  }

  it('holds none of the ids the providers gave their answers', () => {
    for (const one of CASES) {
      const text = textOf(one.file);
      expect(text).not.toMatch(/"id"\s*:/u);
      expect(text).not.toMatch(/"system_fingerprint"\s*:/u);
      expect(text).not.toMatch(/"signature"\s*:\s*"[^"]+"/u);
    }
  });
});

describe('a token is counted once', () => {
  it('takes an Anthropic-dialect stream\'s input from message_start and its output from the last message_delta', async () => {
    const events = eventsOf('deepseek-anthropic-1.sse');
    const start = events.find((event) => event['type'] === 'message_start') as { message: { usage: Record<string, number> } };
    const deltas = events.filter((event) => event['type'] === 'message_delta') as { usage: Record<string, number> }[];
    const last = deltas[deltas.length - 1];
    // message_start is where the input is, and it says nothing about the output
    // an answer that was still running would have.
    expect(start.message.usage['output_tokens']).toBe(0);
    expect(last?.usage['output_tokens']).toBe(16);
    const { answers } = await replay(caseOf('deepseek-anthropic-1.sse'));
    expect(answers[0]?.model.input).toBe(start.message.usage['input_tokens']);
    expect(answers[0]?.model.output).toBe(last?.usage['output_tokens']);
  });

  it('takes the DeepSeek OpenAI reply\'s cache read from cached_tokens, and leaves it out of the input', async () => {
    const usage = usageOf('deepseek-openai-2.json');
    const details = usage['prompt_tokens_details'] as Record<string, number>;
    const prompt = usage['prompt_tokens'] as number;
    const cached = details['cached_tokens'] as number;
    // DeepSeek's own `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`
    // say the same split, and the reader does not need them for it.
    expect(usage['prompt_cache_hit_tokens']).toBe(cached);
    expect(usage['prompt_cache_miss_tokens']).toBe(prompt - cached);
    const { answers } = await replay(caseOf('deepseek-openai-2.json'));
    expect(answers[0]?.model.cache).toEqual({ read: cached });
    expect(answers[0]?.model.input).toBe(prompt - cached);
    // The reply that read nothing from the cache is all input, and has no cache.
    expect(usageOf('deepseek-openai-1.json')['prompt_tokens_details']).toEqual({ cached_tokens: 0 });
    const plain = await replay(caseOf('deepseek-openai-1.json'));
    expect(plain.answers[0]?.model.cache).toBeUndefined();
    expect(plain.answers[0]?.model.input).toBe(5234);
  });

  it('keeps the OpenRouter answer\'s cost as the provider cost, whole and streamed', async () => {
    const whole = usageOf('openrouter-anthropic-2.json');
    const details = whole['cost_details'] as Record<string, number>;
    const { answers } = await replay(caseOf('openrouter-anthropic-2.json'));
    const expected = {
      amount: whole['cost'],
      currency: 'usd',
      from: 'harness',
      input: details['upstream_inference_prompt_cost'],
      output: details['upstream_inference_completions_cost'],
    };
    expect(answers[0]?.providerCost).toEqual(expected);
    expect(answers[0]?.cost).toEqual(expected);

    // In the stream the same figure arrives in the last message_delta rather
    // than in the whole answer.
    const events = eventsOf('openrouter-anthropic-2.sse') as { type?: string; usage?: Record<string, unknown> }[];
    const last = events.filter((event) => event.type === 'message_delta').pop()?.usage;
    expect(last?.['cost']).toBe(whole['cost']);
    const streamed = await replay(caseOf('openrouter-anthropic-2.sse'));
    expect(streamed.answers[0]?.providerCost).toEqual(expected);
  });
});
