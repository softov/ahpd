import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { AGENT_SECRETS, resolved } from '../../sdk/src/channels/owners.js';
import { modelsProblem, offeredModels, ownModels, sourcesProblem } from '../src/models.js';
import type { ModelEntry, ModelSource } from '../src/models.js';
import type { AgentView, Bag, Engine, Start } from '@ahpd/sdk';

/*
 * The models a Claude harness offers when its operator names them: written by
 * id in `models`, or fetched from an endpoint's model list in `modelSources`
 * and filtered, in place of the CLI's list or added to it. And the model a
 * session starts on: the record's own, when its settings name none.
 */

const CLI = [{ id: 'default', name: 'Default' }, { id: 'opus', name: 'Opus' }];

/** What the host's probe learned this variant offers, handed to a session as `seedModels`. */
const OFFERED = [{ id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }];

/*
 * The CLI, replaced so a session can be started without one: each query is
 * recorded with the options it was built from, and its stream stays open with
 * nothing in it.
 */
const sdk = vi.hoisted(() => ({ built: [] as (string | undefined)[] }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: (given: { options: { model?: string } }) => {
    sdk.built.push(given.options.model);
    return {
      async *[Symbol.asyncIterator]() { /* a CLI that stays up and says nothing */ await new Promise(() => {}); },
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

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-claude/src/index.ts';

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** The `claude` engine one load registered. */
const engineOf = async (): Promise<Engine> => {
  const { problems, options: served } = await loadPlugins([{ name: SOURCE, options: {} }], {
    base: { path: '/tmp/ahpd-record-model', agents: [echo({ path: '/tmp/ahpd-record-model' })] },
    configDir: REPO,
    cwd: REPO,
    log: () => {},
  });
  expect(problems).toEqual([]);
  const engine = served.engines?.['claude'];
  if (engine === undefined) throw new Error('no claude engine was registered');
  return engine;
};

/**
 * One session of a record that names `model`, and what it starts on.
 *
 * `offered` is what the host's probe learned this variant offers, handed to a
 * new session as `seedModels`. The settings a session stored go over it.
 */
const opened = async (model: string | undefined, settings: Bag = {}, offered = OFFERED) => {
  sdk.built = [];
  const view: AgentView = {
    id: 'model',
    engine: 'claude',
    owner: 'host',
    name: 'Model',
    description: undefined,
    icon: undefined,
    model,
    config: {},
  };
  const start: Start = {
    uri: 'ahp-session:/record-model',
    chatUri: 'ahp-chat:/record-model',
    settings,
    clientToolTimeoutMs: 60_000,
    schema: () => ({ type: 'object', properties: {} }),
    emit: () => {},
    workingDirectory: mkdtempSync(join(tmpdir(), 'ahpd-record-model-')),
    seedModels: offered,
  };
  const session = await (await engineOf()).open(view).create(start);
  await settle();
  const state = session.sessionState();
  return { model: (state._meta as Bag | undefined)?.['ahpd.model'], built: sdk.built.at(0) };
};

/** An endpoint answering an OpenAI-shaped model list, and the requests it saw. */
const endpoint = (data: unknown[], status = 200) => {
  const seen: { url: string; auth?: string }[] = [];
  const get = (async (url: string, init?: { headers?: Record<string, string> }) => {
    seen.push({ url, ...(init?.headers?.authorization === undefined ? {} : { auth: init.headers.authorization }) });
    return new Response(JSON.stringify({ data }), { status });
  }) as unknown as typeof fetch;
  return { get, seen };
};

it('offers written models, each once, in order', async () => {
  expect(await ownModels([
    { id: 'stealth/space-bunny-alpha' },
    { id: 'anthropic/fable-5', name: 'Fable 5' },
    { id: 'stealth/space-bunny-alpha' },
  ])).toEqual([{ id: 'stealth/space-bunny-alpha', name: 'stealth/space-bunny-alpha' }, { id: 'anthropic/fable-5', name: 'Fable 5' }]);
});

it('offers the written models first, then each source, each id once', async () => {
  const { get } = endpoint([{ id: 'anthropic/fable-5' }, { id: 'openai/gpt-5' }]);
  expect(await ownModels(
    [{ id: 'anthropic/fable-5', name: 'Fable 5' }],
    [{ fetch: 'https://models.test/v1/models' }],
    () => {},
    get,
  )).toEqual([{ id: 'anthropic/fable-5', name: 'Fable 5' }, { id: 'openai/gpt-5', name: 'openai/gpt-5' }]);
});

it('fetches an endpoint list and keeps the ids its pattern covers, with the key from the daemon', async () => {
  process.env.AHPD_MODELS_KEY = 'sk-test';
  const { get, seen } = endpoint([
    { id: 'stealth/space-bunny-alpha', name: 'Space Bunny' },
    { id: 'anthropic/fable-5' },
    { id: 'openai/gpt-5' },
  ]);
  const models = await ownModels([], [{ fetch: 'https://models.test/v1/models', match: 'stealth/*', key: { fromEnv: 'AHPD_MODELS_KEY' } }], () => {}, get);
  delete process.env.AHPD_MODELS_KEY;
  expect(models).toEqual([{ id: 'stealth/space-bunny-alpha', name: 'Space Bunny' }]);
  expect(seen).toEqual([{ url: 'https://models.test/v1/models', auth: 'Bearer sk-test' }]);
  // No pattern keeps every model, named by its id when the endpoint gives no name.
  expect((await ownModels([], [{ fetch: 'https://models.test/v1/models' }], () => {}, get)).map((one) => one.name))
    .toEqual(['Space Bunny', 'anthropic/fable-5', 'openai/gpt-5']);
});

it('sends the key a record resolved to text, whether it was fromEnv or a secret', async () => {
  process.env.AHPD_MODELS_KEY = 'sk-from-the-environment';
  const { get, seen } = endpoint([{ id: 'deepseek/deepseek-chat' }]);
  // The record holds `{ fromEnv }`, and the channel resolves a record's config
  // before the kind opens it, so the source entry the kind is handed carries
  // the key's text.
  const record = { modelSources: [{ fetch: 'https://models.test/v1/models', key: { fromEnv: 'AHPD_MODELS_KEY' } }] };
  const view = await resolved(record, 'host', undefined, AGENT_SECRETS);
  const sources = view['modelSources'] as ModelSource[];
  const models = await ownModels([], sources, () => {}, get);
  delete process.env.AHPD_MODELS_KEY;

  expect(models).toEqual([{ id: 'deepseek/deepseek-chat', name: 'deepseek/deepseek-chat' }]);
  expect(seen).toEqual([{ url: 'https://models.test/v1/models', auth: 'Bearer sk-from-the-environment' }]);
});

it('says so and offers the written models when a fetch fails', async () => {
  const said: string[] = [];
  const { get } = endpoint([], 503);
  const models = await ownModels(
    [{ id: 'anthropic/fable-5' }],
    [{ fetch: 'https://models.test/v1/models' }],
    (line) => said.push(line),
    get,
  );
  expect(models).toEqual([{ id: 'anthropic/fable-5', name: 'anthropic/fable-5' }]);
  expect(said).toEqual(['models from https://models.test/v1/models could not be read: HTTP 503']);
});

it('replaces the CLI list, adds to it with keepCliModels, and is the CLI list without either list', () => {
  const own = [{ id: 'stealth/space-bunny-alpha', name: 'Space Bunny' }, { id: 'opus', name: 'Opus again' }];
  expect(offeredModels(CLI, undefined, undefined)).toEqual(CLI);
  expect(offeredModels(CLI, own, undefined)).toEqual(own);
  expect(offeredModels(CLI, own, true)).toEqual([...CLI, { id: 'stealth/space-bunny-alpha', name: 'Space Bunny' }]);
});

it('names what is wrong with a models option', () => {
  expect(modelsProblem(undefined)).toBeUndefined();
  expect(modelsProblem([{ id: 'c/d', name: 'D' }])).toBeUndefined();
  // A string entry is the old shape, which the start rewrites rather than keeps.
  expect(modelsProblem(['a/b'])).toBe('options.models[0] is not an object with an id');
  expect(modelsProblem([{ name: 'x' }])).toBe('options.models[0] has no id');
  expect(modelsProblem([{ id: 'x', name: 5 }])).toBe('options.models[0].name is not a string');
  expect(modelsProblem('a/b')).toBe('options.models is not a list');
});

it('names what is wrong with a modelSources option', () => {
  expect(sourcesProblem(undefined)).toBeUndefined();
  expect(sourcesProblem([{ fetch: 'https://x', match: 'a/*', key: { fromEnv: 'K' } }])).toBeUndefined();
  // A record's key is the text the channel resolved, and a preset's is the
  // variable it is read from: both are keys.
  expect(sourcesProblem([{ fetch: 'https://x', key: 'a-token' }])).toBeUndefined();
  expect(sourcesProblem('https://x')).toBe('options.modelSources is not a list');
  expect(sourcesProblem([{}])).toBe('options.modelSources[0] has no fetch');
  expect(sourcesProblem([{ fetch: 'https://x', match: 5 }])).toBe('options.modelSources[0].match is not a string');
  expect(sourcesProblem([{ fetch: 'https://x', key: 5 }])).toBe('options.modelSources[0].key is not a string or { fromEnv }');
  expect(sourcesProblem([{ fetch: 'https://x', key: {} }])).toBe('options.modelSources[0].key is not a string or { fromEnv }');
});

it('reads back a stored record whose models were split into the two lists', () => {
  // The shape a start leaves behind: one written model and one source.
  const models: ModelEntry[] = [{ id: 'deepseek-flash' }];
  const sources: ModelSource[] = [{ fetch: 'https://models.test/v1/models', match: 'deepseek/*', key: { fromEnv: 'K' } }];
  expect(modelsProblem(models)).toBeUndefined();
  expect(sourcesProblem(sources)).toBeUndefined();
});

it('starts a session on the model its record names, when the agent offers it', async () => {
  const { model, built } = await opened('opus');
  expect(model).toBe('opus');
  // The half a client cannot see: the CLI was given it at startup.
  expect(built).toBe('opus');
});

it('leaves a session on the CLI\'s default for a record model the agent does not offer', async () => {
  const { model, built } = await opened('fable-9');
  expect(model).toBeUndefined();
  // Not even asked of the CLI: an id this variant cannot serve is not handed over.
  expect(built).toBeUndefined();
});

it('keeps the model a session stored over the record\'s', async () => {
  const { model, built } = await opened('opus', { model: 'sonnet' });
  expect(model).toBe('sonnet');
  expect(built).toBe('sonnet');
});

