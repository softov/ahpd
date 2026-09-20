import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ModelAdapter } from '@facio/agents';
import type { Bag, Start } from '@ahpd/sdk';
import { createHost } from '../packages/sdk/src/host.js';
import { facioAgent, modelOf } from '../packages/agent-facio/src/index.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * The models the endpoint serves.
 *
 * The harness configuration's `model` is a default, not a constraint: the
 * picker is drawn from `probe`, so what is offered has to be the endpoint's own
 * catalogue, with the configured model first when that catalogue does not carry
 * it. Every id offered is a `<provider>/<model>` reference, which is what the
 * harness itself writes and what `modelOf` resolves, so a choice from the list
 * reaches the same endpoint, key and headers the list came from.
 */

let home: string;
let had: string | undefined;
let real: typeof fetch;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-facio-models-'));
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  real = globalThis.fetch;
});

afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
  globalThis.fetch = real;
  rmSync(home, { recursive: true, force: true });
});

/** A harness file with one OpenRouter provider and one configured model. */
const CONFIG = {
  providers: [{ id: 'open_router', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' }],
  model: 'open_router/deepseek/deepseek-chat',
};

const put = (value: unknown): void => {
  mkdirSync(join(home, 'facio'), { recursive: true });
  writeFileSync(join(home, 'facio', 'config.json'), JSON.stringify(value));
};

/** What an OpenAI-compatible endpoint answers for a model list. */
const LISTED = [
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
  { id: 'qwen/qwen3-8b' },
];

/** Stand in for the endpoint, recording what it was asked. */
const answering = (body: unknown, status = 200): { seen: { url: unknown; authorization: unknown; calls: number } } => {
  const seen = { url: undefined as unknown, authorization: undefined as unknown, calls: 0 };
  globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    seen.calls += 1;
    seen.url = input;
    seen.authorization = init?.headers?.authorization;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { seen };
};

const refusing = (): { calls: () => number } => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error('connection refused');
  }) as typeof fetch;
  return { calls: () => calls };
};

/** Let the probe's zero-delay work finish before reading what it learned. */
const untilAsync = async (check: () => Promise<boolean>, times = 400): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (await check()) return;
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

it('offers every model the endpoint serves, under the provider it was read from', async () => {
  put(CONFIG);
  const { seen } = answering({ data: LISTED });
  const offered = await facioAgent({}).probe?.();
  expect(seen.url).toBe('https://openrouter.ai/api/v1/models');
  expect(seen.authorization).toBe('Bearer k');
  expect(offered?.models).toEqual([
    { id: 'open_router/deepseek/deepseek-chat', name: 'DeepSeek V3' },
    { id: 'open_router/openai/gpt-4o-mini', name: 'GPT-4o mini' },
    // A row with no name of its own is offered under its id rather than dropped.
    { id: 'open_router/qwen/qwen3-8b', name: 'qwen/qwen3-8b' },
  ]);
});

it('offers the configured default first when the list does not carry it, and once when it does', async () => {
  put({ ...CONFIG, model: 'open_router/deepseek/deepseek-v3.1' });
  answering({ data: LISTED });
  const missing = await facioAgent({}).probe?.();
  expect(missing?.models[0]).toEqual({ id: 'open_router/deepseek/deepseek-v3.1', name: 'open_router/deepseek/deepseek-v3.1' });
  expect(missing?.models).toHaveLength(LISTED.length + 1);

  put(CONFIG);
  // A fresh backend: the catalogue is cached per endpoint, not across probes.
  const carried = await facioAgent({}).probe?.();
  expect(carried?.models.filter((model) => model.id === 'open_router/deepseek/deepseek-chat')).toHaveLength(1);
  expect(carried?.models).toHaveLength(LISTED.length);
});

it('offers the configured model alone when the endpoint cannot be asked', async () => {
  put(CONFIG);
  const refused = refusing();
  const offered = await facioAgent({}).probe?.();
  expect(offered?.models).toEqual([{ id: 'open_router/deepseek/deepseek-chat', name: 'open_router/deepseek/deepseek-chat' }]);
  // Nothing was cached, so a later probe asks the endpoint again rather than
  // remembering it as one that serves no models.
  await facioAgent({}).probe?.();
  expect(refused.calls()).toBeGreaterThanOrEqual(2);
});

it('answers the configured model alone for a status or a shape that is not a catalogue', async () => {
  put(CONFIG);
  for (const body of [undefined, { data: 'nope' }, {}, { data: [7, null, { name: 'no id' }] }]) {
    const { seen } = answering(body, body === undefined ? 500 : 200);
    const offered = await facioAgent({}).probe?.();
    expect(seen.url).toBe('https://openrouter.ai/api/v1/models');
    expect(offered?.models).toEqual([{ id: 'open_router/deepseek/deepseek-chat', name: 'open_router/deepseek/deepseek-chat' }]);
  }
});

it('offers ids that resolve back to the endpoint they were read from', async () => {
  put(CONFIG);
  answering({ data: LISTED });
  const offered = await facioAgent({}).probe?.();
  for (const model of offered?.models ?? []) {
    expect(modelOf({}, { model: model.id }).modelId).toBe(model.id.replace('open_router/', ''));
  }

  // And the chosen model is asked for on the provider's endpoint with its key.
  const { seen } = answering({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: {} });
  await modelOf({}, { model: 'open_router/openai/gpt-4o-mini' }).complete({ instructions: 'x', messages: [], tools: [] } as never);
  expect(seen.url).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(seen.authorization).toBe('Bearer k');
});

it('offers an endpoint no harness entry owns under this backend own provider id', async () => {
  put({ providers: [] });
  answering({ data: [{ id: 'qwen/qwen3-8b', name: 'Qwen3 8B' }] });
  const agent = facioAgent({ baseUrl: 'https://local.example/v1', model: 'qwen3-8b' });
  const offered = await agent.probe?.();
  expect(offered?.models).toEqual([
    { id: 'qwen3-8b', name: 'qwen3-8b' },
    { id: 'facio/qwen/qwen3-8b', name: 'Qwen3 8B' },
  ]);
  // The prefix is a name this backend accepts for its own endpoint, so the list
  // is selectable even though the harness file carries no provider.
  const resolved = modelOf({ baseUrl: 'https://local.example/v1' }, { model: 'facio/qwen/qwen3-8b' });
  expect(resolved.modelId).toBe('qwen/qwen3-8b');
});

it('never asks the network for a caller that passed an adapter', async () => {
  put(CONFIG);
  const { seen } = answering({ data: LISTED });
  const adapter = { id: 'stub', modelId: 'stub', features: {} } as unknown as ModelAdapter;
  const offered = await facioAgent({ adapter, model: 'open_router/m' }).probe?.();
  expect(seen.calls).toBe(0);
  expect(offered?.models).toEqual([{ id: 'open_router/m', name: 'open_router/m' }]);
});

it('answers a session with the same catalogue, and its own model until then', async () => {
  put(CONFIG);
  answering({ data: LISTED });
  const agent = facioAgent({});
  const offered = await agent.probe?.();
  const session = agent.create({
    uri: 'ahp-session:/models',
    chatUri: 'ahp-chat:/models',
    settings: agent.defaults(),
    schema: () => agent.schema(),
    emit: () => {},
  } as unknown as Start);

  // A session whose endpoint the probe already asked answers the catalogue, so
  // it cannot shrink the list the picker was drawn from.
  expect(session.models()).toEqual(offered?.models);

  // A backend whose endpoint has not answered yet still names the model the
  // session would run on rather than nothing at all.
  const refused = refusing();
  const quiet = facioAgent({ baseUrl: 'https://never.example/v1', model: 'open_router/deepseek/deepseek-chat' });
  const silent = quiet.create({
    uri: 'ahp-session:/quiet',
    chatUri: 'ahp-chat:/quiet',
    settings: quiet.defaults(),
    schema: () => quiet.schema(),
    emit: () => {},
  } as unknown as Start);
  expect(silent.models()).toEqual([{ id: 'open_router/deepseek/deepseek-chat', name: 'open_router/deepseek/deepseek-chat' }]);
  expect(refused.calls()).toBeGreaterThanOrEqual(1);
});

it('advertises the whole catalogue on the root channel, which is what a picker reads', async () => {
  put(CONFIG);
  answering({ data: LISTED });
  const host = createHost({ path: mkdtempSync(join(tmpdir(), 'ahpd-facio-models-root-')), agents: [facioAgent({ memory: true })] });
  const notes: { method: string; params: unknown }[] = [];
  const peer: Peer = {
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
  const client = host.accept(peer);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
  });

  /** The root agent list as a client subscribing right now would see it. */
  const models = async (): Promise<Bag[]> => {
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { agents: { models: Bag[] }[] } };
    }).snapshot.state;
    return state.agents[0]?.models ?? [];
  };
  // The boot probe is fire-and-forget, so the first snapshot may still be empty.
  await untilAsync(async () => (await models()).length === LISTED.length);
  expect(await models()).toEqual([
    { id: 'open_router/deepseek/deepseek-chat', name: 'DeepSeek V3', provider: 'facio' },
    { id: 'open_router/openai/gpt-4o-mini', name: 'GPT-4o mini', provider: 'facio' },
    { id: 'open_router/qwen/qwen3-8b', name: 'qwen/qwen3-8b', provider: 'facio' },
  ]);
});
