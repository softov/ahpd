import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { ModelAdapter } from '@cofold/agents';
import type { AgentView, Bag, Engine, PluginHost, Start } from '@ahpd/sdk';
import { createHost } from '../../sdk/src/host.js';
import { EFFORT_LEVELS, cofoldAgent, modelOf } from '../src/index.js';
import { apply } from '../src/plugin.js';
import { startedNow } from '../../sdk/test/support/started.js';
import type { Peer } from '../../sdk/src/types/rpc.js';

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
  home = mkdtempSync(join(tmpdir(), 'ahpd-cofold-models-'));
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

/** Who a model call says it comes from, as this package's plugin names ahpd. */
const APP = { name: 'ahpd', version: '1.2.3', url: 'https://ahpio.com' };

const put = (value: unknown): void => {
  mkdirSync(join(home, 'copapo'), { recursive: true });
  writeFileSync(join(home, 'copapo', 'config.json'), JSON.stringify(value));
};

/** What an OpenAI-compatible endpoint answers for a model list. */
const LISTED = [
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini' },
  { id: 'qwen/qwen3-8b' },
];

/** An entry as OpenRouter publishes one: its limits, its price and what it takes. */
const PUBLISHED = {
  data: [
    {
      id: 'deepseek/deepseek-chat',
      name: 'DeepSeek V3',
      context_length: 65536,
      top_provider: { max_completion_tokens: 8192 },
      pricing: { prompt: '0.000003', completion: '0.000015' },
      supported_parameters: ['tools', 'reasoning'],
    },
    { id: 'qwen/qwen3-8b', name: 'Qwen3 8B' },
  ],
};

/** Stand in for the endpoint, recording what it was asked. */
const answering = (body: unknown, status = 200): { seen: { url: unknown; authorization: unknown; calls: number }; headersOf: () => Record<string, string> } => {
  const seen = { url: undefined as unknown, authorization: undefined as unknown, calls: 0 };
  let asked: Record<string, string> = {};
  globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    seen.calls += 1;
    seen.url = input;
    asked = init?.headers ?? {};
    seen.authorization = init?.headers?.authorization;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { seen, headersOf: () => asked };
};

const refusing = (): { calls: () => number } => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error('connection refused');
  }) as typeof fetch;
  return { calls: () => calls };
};

/** A harness file with two providers and no configured model. */
const TWO = {
  providers: [
    { id: 'open_router', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k-open' },
    { id: 'moonshot', baseUrl: 'https://api.moonshot.ai/v1', apiKey: 'k-moon' },
  ],
};

/** Stand in for several endpoints, answering each and recording what it was asked. */
const answeringEach = (bodies: Record<string, unknown>): {
  seen: { url: string; authorization: unknown }[];
  asked: { url: string; headers: Record<string, string> }[];
} => {
  const seen: { url: string; authorization: unknown }[] = [];
  const asked: { url: string; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    const headers = init?.headers ?? {};
    seen.push({ url, authorization: headers.authorization });
    asked.push({ url, headers });
    const body = bodies[new URL(url).host];
    if (body === undefined) throw new Error(`no endpoint for ${url}`);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { seen, asked };
};

/** Stand in for an endpoint that takes the connection and never answers it. */
const hanging = (): { calls: () => number } => {
  let calls = 0;
  globalThis.fetch = ((_input: unknown, init?: { signal?: AbortSignal }) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')); });
    });
  }) as unknown as typeof fetch;
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
  const offered = await cofoldAgent({}).probe?.();
  expect(seen.url).toBe('https://openrouter.ai/api/v1/models');
  expect(seen.authorization).toBe('Bearer k');
  expect(offered?.models).toEqual([
    { id: 'open_router/deepseek/deepseek-chat', name: 'DeepSeek V3' },
    { id: 'open_router/openai/gpt-4o-mini', name: 'GPT-4o mini' },
    // A row with no name of its own is offered under its id rather than dropped.
    { id: 'open_router/qwen/qwen3-8b', name: 'qwen/qwen3-8b' },
  ]);
});

/*
 * Every model call names ahpd to its endpoint. OpenRouter also gets the two
 * headers its app attribution reads, so the usage appears on ahpd's page
 * rather than on the transport's.
 * https://openrouter.ai/docs/app-attribution
 */
it('names ahpd on every model call, and OpenRouter as its app', async () => {
  put(TWO);
  let engine: Engine | undefined;
  apply({ version: '1.2.3', registerEngine: (one: Engine) => { engine = one; } } as unknown as PluginHost, {});
  const { asked } = answeringEach({
    'openrouter.ai': { data: [] },
    'api.moonshot.ai': { data: [] },
  });
  const record: AgentView = {
    id: 'open_router',
    engine: 'cofold',
    owner: 'host',
    name: 'OpenRouter',
    description: undefined,
    icon: undefined,
    model: undefined,
    config: { memory: true },
  };
  await engine?.open(record).probe?.();

  const headersOf = (host: string): Record<string, string> =>
    asked.find((one) => new URL(one.url).host === host)?.headers ?? {};
  expect(headersOf('openrouter.ai')['user-agent']).toBe('ahpd/1.2.3');
  expect(headersOf('openrouter.ai')['http-referer']).toBe('https://ahpio.com');
  expect(headersOf('openrouter.ai')['x-openrouter-title']).toBe('ahpd');

  // Another host gets the name alone: the other two headers are OpenRouter's.
  expect(headersOf('api.moonshot.ai')['user-agent']).toBe('ahpd/1.2.3');
  expect(headersOf('api.moonshot.ai')['http-referer']).toBeUndefined();
  expect(headersOf('api.moonshot.ai')['x-openrouter-title']).toBeUndefined();
});

it('names ahpd on a turn that builds its own transport', async () => {
  put({ providers: [] });
  const { headersOf } = answering({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: {} });
  await modelOf({ baseUrl: 'https://api.example.com/v1', model: 'm', apiKey: 'k', app: APP })
    .complete({ instructions: 'x', messages: [], tools: [] } as never);
  expect(headersOf()['user-agent']).toBe('ahpd/1.2.3');
  expect(headersOf()['http-referer']).toBeUndefined();
  expect(headersOf()['x-openrouter-title']).toBeUndefined();
});

it('lets a provider keep its own user-agent header', async () => {
  put({
    providers: [{
      id: 'mine',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      headers: { 'user-agent': 'mine/9' },
    }],
  });
  const { headersOf } = answering({ data: [] });
  await cofoldAgent({ app: APP }).probe?.();
  expect(headersOf()['user-agent']).toBe('mine/9');
});

it('offers every provider in the file, each under its own id', async () => {
  put(TWO);
  answeringEach({
    'openrouter.ai': { data: LISTED },
    'api.moonshot.ai': { data: [{ id: 'moonshotai/kimi-k3.1-pro', name: 'Kimi K3.1 Pro' }] },
  });
  const offered = await cofoldAgent({}).probe?.();
  // The rows are merged in the order the file lists the providers.
  expect(offered?.models).toEqual([
    { id: 'open_router/deepseek/deepseek-chat', name: 'DeepSeek V3' },
    { id: 'open_router/openai/gpt-4o-mini', name: 'GPT-4o mini' },
    { id: 'open_router/qwen/qwen3-8b', name: 'qwen/qwen3-8b' },
    { id: 'moonshot/moonshotai/kimi-k3.1-pro', name: 'Kimi K3.1 Pro' },
  ]);
});

it('asks each provider with its own key, and sends no other provider key', async () => {
  put(TWO);
  const { seen } = answeringEach({
    'openrouter.ai': { data: [{ id: 'one' }] },
    'api.moonshot.ai': { data: [{ id: 'two' }] },
  });
  await cofoldAgent({}).probe?.();
  expect(seen).toHaveLength(2);
  expect(seen).toEqual(expect.arrayContaining([
    { url: 'https://openrouter.ai/api/v1/models', authorization: 'Bearer k-open' },
    { url: 'https://api.moonshot.ai/v1/models', authorization: 'Bearer k-moon' },
  ]));

  /*
   * A plugin key belongs to the resource this backend advertised, which is the
   * endpoint the configured model names. It reaches that provider only: the
   * other one keeps its own key.
   */
  put({ ...TWO, model: 'open_router/deepseek/deepseek-chat' });
  const second = answeringEach({
    'openrouter.ai': { data: [{ id: 'one' }] },
    'api.moonshot.ai': { data: [{ id: 'two' }] },
  });
  await cofoldAgent({ apiKey: 'k-option' }).probe?.();
  expect(second.seen).toEqual(expect.arrayContaining([
    { url: 'https://openrouter.ai/api/v1/models', authorization: 'Bearer k-option' },
    { url: 'https://api.moonshot.ai/v1/models', authorization: 'Bearer k-moon' },
  ]));
});

it('sends the plugin own key to the endpoint it names, even without a resource', async () => {
  put({ providers: [] });
  const request = { instructions: 'x', messages: [], tools: [] } as never;
  const reply = { choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: {} };

  // An http endpoint publishes no protected resource, but the key the plugin
  // gave for it still belongs to it.
  const http = answering(reply);
  await modelOf({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'm', apiKey: 'x' }).complete(request);
  expect(http.seen.url).toBe('http://127.0.0.1:1234/v1/chat/completions');
  expect(http.seen.authorization).toBe('Bearer x');

  // A resource naming another origin does not take the key away from the
  // endpoint `baseUrl` names.
  const other = answering(reply);
  await modelOf({ baseUrl: 'http://127.0.0.1:1234/v1', resource: 'https://ahpd.dev/agent-cofold', model: 'm', apiKey: 'x' }).complete(request);
  expect(other.seen.authorization).toBe('Bearer x');
});

it('gives a turn the key of the provider its reference names when two share an endpoint', async () => {
  put({
    providers: [
      { id: 'first', baseUrl: 'https://shared.example/v1', apiKey: 'k-first' },
      { id: 'second', baseUrl: 'https://shared.example/v1', apiKey: 'k-second' },
    ],
  });
  const { seen } = answering({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: {} });
  await modelOf({}, { model: 'second/some-model' }).complete({ instructions: 'x', messages: [], tools: [] } as never);
  expect(seen.url).toBe('https://shared.example/v1/chat/completions');
  // The listing asked the second provider with its own key, and the turn runs
  // on that one rather than on the first entry for the same endpoint.
  expect(seen.authorization).toBe('Bearer k-second');
});

/*
 * An endpoint is cofold's provider options, named by the provider id a
 * reference names, as cofold's `providersOf` names each provider of a file:
 * two entries on one endpoint and key are two catalogues, each under its id.
 * https://github.com/softov/cofold/blob/ee4819644696b88e83e63c56ed7bdf426d32cfb9/packages/model-openai-compat/src/config.ts#L20-L30
 */
it('keeps a catalogue for each provider of an endpoint two share with one key', async () => {
  put({
    providers: [
      { id: 'first', baseUrl: 'https://shared.example/v1', apiKey: 'k' },
      { id: 'second', baseUrl: 'https://shared.example/v1', apiKey: 'k' },
    ],
  });
  answering({ data: [{ id: 'm', name: 'M' }] });
  const agent = cofoldAgent({});
  await agent.probe?.();
  const session = startedNow(agent.create({
    uri: 'ahp-session:/shared',
    chatUri: 'ahp-chat:/shared',
    settings: agent.defaults(),
    schema: () => agent.schema(),
    emit: () => {},
  } as unknown as Start));
  expect(session.models().map((one) => one.id)).toEqual(['first/m', 'second/m']);
});

it('keeps the other providers listing when one fails', async () => {
  put(TWO);
  globalThis.fetch = (async (input: unknown) => {
    if (String(input).startsWith('https://api.moonshot.ai')) throw new Error('connection refused');
    return new Response(JSON.stringify({ data: LISTED }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const offered = await cofoldAgent({}).probe?.();
  expect(offered?.models.map((model) => model.id)).toEqual([
    'open_router/deepseek/deepseek-chat',
    'open_router/openai/gpt-4o-mini',
    'open_router/qwen/qwen3-8b',
  ]);
});

it('offers the configured default first when the list does not carry it, and once when it does', async () => {
  put({ ...CONFIG, model: 'open_router/deepseek/deepseek-v3.1' });
  answering({ data: LISTED });
  const missing = await cofoldAgent({}).probe?.();
  expect(missing?.models[0]).toEqual({ id: 'open_router/deepseek/deepseek-v3.1', name: 'open_router/deepseek/deepseek-v3.1' });
  expect(missing?.models).toHaveLength(LISTED.length + 1);

  put(CONFIG);
  // A fresh backend: the catalogue is cached per endpoint, not across probes.
  const carried = await cofoldAgent({}).probe?.();
  expect(carried?.models.filter((model) => model.id === 'open_router/deepseek/deepseek-chat')).toHaveLength(1);
  expect(carried?.models).toHaveLength(LISTED.length);
});

it('offers the configured model alone when the endpoint cannot be asked', async () => {
  put(CONFIG);
  const refused = refusing();
  const offered = await cofoldAgent({}).probe?.();
  expect(offered?.models).toEqual([{ id: 'open_router/deepseek/deepseek-chat', name: 'open_router/deepseek/deepseek-chat' }]);
  // Nothing was cached, so a later probe asks the endpoint again rather than
  // remembering it as one that serves no models.
  await cofoldAgent({}).probe?.();
  expect(refused.calls()).toBeGreaterThanOrEqual(2);
});

it('answers the configured model alone for a status or a shape that is not a catalogue', async () => {
  put(CONFIG);
  for (const body of [undefined, { data: 'nope' }, {}, { data: [7, null, { name: 'no id' }] }]) {
    const { seen } = answering(body, body === undefined ? 500 : 200);
    const offered = await cofoldAgent({}).probe?.();
    expect(seen.url).toBe('https://openrouter.ai/api/v1/models');
    expect(offered?.models).toEqual([{ id: 'open_router/deepseek/deepseek-chat', name: 'open_router/deepseek/deepseek-chat' }]);
  }
});

/*
 * A model that can be told how hard to think carries that as its own
 * `configSchema`, cofold's four levels under `thinkingLevel`, where the catalogue
 * lists `reasoning` among its parameters; one the catalogue says nothing of
 * takes none, cofold's own default.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md#L858
 */
it('offers the limits the endpoint published and a thinking level where it lists reasoning, and neither its price nor its features', async () => {
  put(CONFIG);
  answering(PUBLISHED);
  const offered = await cofoldAgent({}).probe?.();

  /*
   * `toEqual` is exact, so a row carrying a `pricing` or a `features` key would
   * not match. Only the two limits and the model's own form travel beside the
   * id and the name: a row is what a picker draws, and the price is what a
   * turn is built from.
   */
  expect(offered?.models).toEqual([
    {
      id: 'open_router/deepseek/deepseek-chat',
      name: 'DeepSeek V3',
      maxContextWindow: 65536,
      maxOutputTokens: 8192,
      configSchema: {
        type: 'object',
        properties: { thinkingLevel: expect.objectContaining({ type: 'string', enum: [...EFFORT_LEVELS], default: 'off' }) as unknown },
      },
    },
    // A row the endpoint published neither limit nor parameters for carries none.
    { id: 'open_router/qwen/qwen3-8b', name: 'Qwen3 8B' },
  ]);
});

/*
 * A model's level in the property VS Code's agent host draws, its words and
 * each level's label and description from VS Code's shared helpers, `off`
 * taking the helpers' label for a level they do not name, and `off`, cofold's
 * own default, its default.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L4536-L4553
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/reasoningEffort.ts#L46-L82
 */
it('offers a model\'s thinking level in the words of VS Code\'s shared helpers, off labelled Off', async () => {
  put(CONFIG);
  answering(PUBLISHED);
  const offered = await cofoldAgent({}).probe?.();
  const chat = offered?.models.find((one) => one.id === 'open_router/deepseek/deepseek-chat');
  expect((chat?.configSchema?.properties as Record<string, unknown>).thinkingLevel).toEqual({
    type: 'string',
    title: 'Effort Level',
    description: 'Controls how much reasoning effort the model uses.',
    enum: ['off', 'low', 'medium', 'high'],
    enumLabels: ['Off', 'Low', 'Medium', 'High'],
    enumDescriptions: ['', 'Faster responses with less reasoning', 'Balanced reasoning and speed', 'Greater reasoning depth but slower'],
    default: 'off',
  });
});

/*
 * The levels the operator declares for a model of the agent's own endpoint, as
 * VS Code's Custom Endpoint models declare `supportsReasoningEffort`, whatever
 * the catalogue says of it; a model neither names takes none.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/extensions/copilot/package.json#L2043-L2049
 */
it('offers the levels the agent declares for a model of its endpoint, and none where nothing says', async () => {
  answering({ data: [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }] });
  const agent = cofoldAgent({
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    // A level cofold does not have is declared as VS Code's setting takes any
    // string, and left out when the model is offered.
    models: [{ id: 'deepseek-reasoner', supportsReasoningEffort: ['high', 'xhigh', 'low'] }],
  });
  const offered = await agent.probe?.();

  const reasoner = offered?.models.find((one) => one.id === 'cofold/deepseek-reasoner');
  // In cofold's own order, and with no `off` the operator did not name, in
  // the words of VS Code's shared helpers.
  expect(reasoner?.configSchema).toMatchObject({
    properties: {
      thinkingLevel: {
        enum: ['low', 'high'],
        enumLabels: ['Low', 'High'],
        enumDescriptions: ['Faster responses with less reasoning', 'Greater reasoning depth but slower'],
      },
    },
  });
  expect((reasoner?.configSchema?.properties as Record<string, Record<string, unknown>>).thinkingLevel).not.toHaveProperty('default');
  expect(offered?.models.find((one) => one.id === 'cofold/deepseek-chat')).not.toHaveProperty('configSchema');
});

/*
 * A probe lists the endpoint again, as VS Code's agents list their models again
 * when their host refreshes a catalogue, and one whose listing fails answers
 * the last good list, as VS Code's Claude agent keeps its last known-good
 * catalogue so a failed refresh never wipes the picker.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentModelRefreshScheduler.ts#L106-L125
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L918-L924
 */
it('lists the endpoint again at each probe, and keeps the last good list when a listing fails', async () => {
  put(CONFIG);
  /*
   * One endpoint whose answer moves: cofold's provider keeps the `fetch` it
   * was built with, so the endpoint changes behind one function.
   */
  let answer: unknown = { data: LISTED.slice(0, 1) };
  globalThis.fetch = (async () => {
    if (answer === undefined) throw new Error('connection refused');
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const agent = cofoldAgent({});
  expect((await agent.probe?.())?.models.map((one) => one.id)).toEqual(['open_router/deepseek/deepseek-chat']);

  // A model the endpoint added since is offered at the next probe.
  answer = { data: LISTED };
  const every = LISTED.map((one) => `open_router/${one.id}`);
  expect((await agent.probe?.())?.models.map((one) => one.id)).toEqual(every);

  // A probe whose listing fails answers what the last one read.
  answer = undefined;
  expect((await agent.probe?.())?.models.map((one) => one.id)).toEqual(every);
});

it('lists the endpoint a record names after an edit, with the record\'s key', async () => {
  // No harness file: the record is the only source of an endpoint.
  const { seen } = answeringEach({ 'models.example.com': { data: LISTED } });
  let record: Record<string, unknown> = {};
  const agent = cofoldAgent({ provider: 'mine', recordOf: () => ({ provider: 'mine', ...record }) });
  expect((await agent.probe?.())?.models).toEqual([]);

  // The edit keeps this backend; the next probe reads the record as it is now.
  record = { baseUrl: 'https://models.example.com/v1', apiKey: 'k-record' };
  const offered = await agent.probe?.();
  expect(seen).toEqual([{ url: 'https://models.example.com/v1/models', authorization: 'Bearer k-record' }]);
  expect(offered?.models.map((one) => one.id)).toEqual(LISTED.map((one) => `mine/${one.id}`));
});

it('offers the configured model alone once the record\'s catalogueTimeoutMs has passed with no answer', async () => {
  put(CONFIG);
  const hung = hanging();
  const began = Date.now();
  const offered = await cofoldAgent({ catalogueTimeoutMs: 100 }).probe?.();
  expect(offered?.models).toEqual([{ id: 'open_router/deepseek/deepseek-chat', name: 'open_router/deepseek/deepseek-chat' }]);
  expect(hung.calls()).toBe(1);
  // Well inside the 15 s a record that names none gives the endpoint.
  expect(Date.now() - began).toBeLessThan(2_000);
});

it('offers ids that resolve back to the endpoint they were read from', async () => {
  // The file names a provider but no model, so the prefix is the provider the
  // rows were read from rather than the one a configured model would name.
  put({ providers: CONFIG.providers });
  answering({ data: LISTED });
  const offered = await cofoldAgent({}).probe?.();
  expect(offered?.models.map((model) => model.id)).toEqual([
    'open_router/deepseek/deepseek-chat',
    'open_router/openai/gpt-4o-mini',
    'open_router/qwen/qwen3-8b',
  ]);
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
  const agent = cofoldAgent({ baseUrl: 'https://local.example/v1', model: 'qwen3-8b' });
  const offered = await agent.probe?.();
  expect(offered?.models).toEqual([
    { id: 'qwen3-8b', name: 'qwen3-8b' },
    { id: 'cofold/qwen/qwen3-8b', name: 'Qwen3 8B' },
  ]);
  // The prefix is a name this backend accepts for its own endpoint, so the list
  // is selectable even though the harness file carries no provider.
  const resolved = modelOf({ baseUrl: 'https://local.example/v1' }, { model: 'cofold/qwen/qwen3-8b' });
  expect(resolved.modelId).toBe('qwen/qwen3-8b');
});

it('refuses this backend own prefix for a provider the file carries', () => {
  put(CONFIG);
  /*
   * The file has open_router, so `cofold/...` names no endpoint of its own: it
   * is a provider reference like any other, and the error names what the file
   * configures.
   */
  expect(() => modelOf({}, { model: 'cofold/qwen/qwen3-8b' })).toThrow(/configures open_router/);
});

/*
 * A turn with nothing to name an endpoint, no `baseUrl` and no provider in the
 * file, refused as a turn with no model is: cofold's model adapter takes its
 * target server from configuration alone.
 * https://www.npmjs.com/package/@cofold/model-openai-compat
 */
it('refuses a turn nothing names an endpoint for, as a turn with no model is', () => {
  put({ providers: [] });
  expect(() => modelOf({}, { model: 'cofold/qwen/qwen3-8b' })).toThrow(/no endpoint is configured and this backend has no default/);
});

it('refuses a named provider when the file carries none', () => {
  put({ providers: [] });
  expect(() => modelOf({}, { model: 'absent/model' })).toThrow(/configures none/);
});

it('never asks the network for a caller that passed an adapter', async () => {
  put(CONFIG);
  const { seen } = answering({ data: LISTED });
  const adapter = { id: 'stub', modelId: 'stub', features: {} } as unknown as ModelAdapter;
  const offered = await cofoldAgent({ adapter, model: 'open_router/m' }).probe?.();
  expect(seen.calls).toBe(0);
  expect(offered?.models).toEqual([{ id: 'open_router/m', name: 'open_router/m' }]);
});

/*
 * The endpoint is the agent's configuration, as VS Code keeps a provider's
 * settings in the host's root configuration, so a session asks the agent's
 * endpoint whatever endpoint a value it carries names.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1319-L1338
 */
it('asks the agent\'s own endpoint for a session\'s catalogue, whatever endpoint its values carry', async () => {
  const { seen } = answeringEach({ 'api.deepseek.com': { data: LISTED } });
  const agent = cofoldAgent({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' });
  const session = startedNow(agent.create({
    uri: 'ahp-session:/endpoint',
    chatUri: 'ahp-chat:/endpoint',
    settings: { baseUrl: 'https://elsewhere.example/v1' },
    schema: () => agent.schema(),
    emit: () => {},
  } as unknown as Start));
  session.models();
  await untilAsync(async () => seen.length >= 1);
  expect([...new Set(seen.map((one) => new URL(one.url).host))]).toEqual(['api.deepseek.com']);
});

it('answers a session with the same catalogue, and its own model until then', async () => {
  put(CONFIG);
  answering({ data: LISTED });
  const agent = cofoldAgent({});
  const offered = await agent.probe?.();
  const session = startedNow(agent.create({
    uri: 'ahp-session:/models',
    chatUri: 'ahp-chat:/models',
    settings: agent.defaults(),
    schema: () => agent.schema(),
    emit: () => {},
  } as unknown as Start));

  // A session whose endpoint the probe already asked answers the catalogue, so
  // it cannot shrink the list the picker was drawn from.
  expect(session.models()).toEqual(offered?.models);

  // A backend whose endpoint has not answered yet still names the model the
  // session would run on rather than nothing at all.
  const refused = refusing();
  const quiet = cofoldAgent({ baseUrl: 'https://never.example/v1', model: 'open_router/deepseek/deepseek-chat' });
  const silent = startedNow(quiet.create({
    uri: 'ahp-session:/quiet',
    chatUri: 'ahp-chat:/quiet',
    settings: quiet.defaults(),
    schema: () => quiet.schema(),
    emit: () => {},
  } as unknown as Start));
  expect(silent.models()).toEqual([{ id: 'open_router/deepseek/deepseek-chat', name: 'open_router/deepseek/deepseek-chat' }]);
  // The ask is in the background, so it lands a tick after `models()` answered;
  // cofold's provider reads its headers before it fetches.
  await untilAsync(async () => refused.calls() >= 1);
  expect(refused.calls()).toBeGreaterThanOrEqual(1);
});

it('advertises the whole catalogue on the root channel, which is what a picker reads', async () => {
  put(CONFIG);
  answering({ data: LISTED });
  const host = createHost({ path: mkdtempSync(join(tmpdir(), 'ahpd-cofold-models-root-')), agents: [cofoldAgent({ memory: true })] });
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
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
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
    { id: 'open_router/deepseek/deepseek-chat', name: 'DeepSeek V3', provider: 'cofold' },
    { id: 'open_router/openai/gpt-4o-mini', name: 'GPT-4o mini', provider: 'cofold' },
    { id: 'open_router/qwen/qwen3-8b', name: 'qwen/qwen3-8b', provider: 'cofold' },
  ]);
});

it('offers cofold\'s slash commands, which a session completes after a slash', async () => {
  put(CONFIG);
  answering({ data: LISTED });
  const offered = await cofoldAgent({ memory: true }).probe?.();
  expect(offered?.commands).toContainEqual({ name: 'compact', description: expect.any(String) as string });

  const path = mkdtempSync(join(tmpdir(), 'ahpd-cofold-models-slash-'));
  const host = createHost({ path, agents: [cofoldAgent({ memory: true })] });
  const peer: Peer = {
    send: () => {},
    notify: () => {},
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
  const client = host.accept(peer);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  /** What a composer is offered after a bare slash on a channel. */
  const completed = async (channel: string): Promise<string[]> => (await client.handle({
    method: 'completions',
    params: { channel, kind: 'userMessage', text: '/', offset: 1 },
  }) as { items: { insertText: string }[] }).items.map((one) => one.insertText);
  // The boot probe is fire-and-forget, so the root may not have the list yet.
  await untilAsync(async () => (await completed('ahp-root://')).includes('/compact'));

  await client.handle({ method: 'createSession', params: { channel: `ahp-session:${path}/slash`, provider: 'cofold' } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: `ahp-session:${path}/slash` } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  expect(await completed(opened.snapshot.state.defaultChat)).toContain('/compact');
});
