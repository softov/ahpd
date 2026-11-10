import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { splitModel } from '@cofold/model-openai-compat';
import { createHost } from '../../sdk/src/host.js';
import { cofoldAgent, harnessConfig, harnessConfigPath, modelOf, resourceOf } from '../src/index.js';

/*
 * The harness's own configuration, read by the backend.
 *
 * cofold's app, copapo, already has a file a person writes once, and the point
 * of reading it is that a key does not have to be lent or repeated: a daemon
 * whose bridge names no model still runs on the provider the harness was
 * pointed at. Every case here owns its own `XDG_CONFIG_HOME` and starts with
 * no `COPAPO_CONFIG`, so nothing reads the real one.
 */

let home: string;
/** The variables the harness reads on top of its files, copapo's own and the family's. */
const VARIABLES = [
  'COPAPO_CONFIG', 'COPAPO_BASE_URL', 'COPAPO_API_KEY', 'COPAPO_MODEL', 'COFOLD_BASE_URL', 'COFOLD_API_KEY', 'COFOLD_MODEL',
];
let had: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-cofold-config-'));
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
  for (const name of VARIABLES) delete process.env[name];
});

afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
  for (const name of VARIABLES) delete process.env[name];
  rmSync(home, { recursive: true, force: true });
});

/** The harness file, as the harness itself writes it. */
const CONFIG = {
  providers: [{ id: 'open_router', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' }],
  reasoning: 'off',
  instructions: 'Be careful.',
  theme: 'paper',
  model: 'open_router/~deepseek/deepseek-flash-latest',
};

const put = (value: unknown): void => {
  mkdirSync(join(home, 'copapo'), { recursive: true });
  writeFileSync(join(home, 'copapo', 'config.json'), JSON.stringify(value));
};

it('reads the file the harness reads, and only the parts a backend needs', () => {
  put(CONFIG);
  const found = harnessConfig();
  expect(found.path).toBe(join(home, 'copapo', 'config.json'));
  expect(found.providers).toEqual([{ id: 'open_router', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' }]);
  expect(found.model).toBe('open_router/~deepseek/deepseek-flash-latest');
  expect(found.instructions).toBe('Be careful.');
});

it('takes the file COPAPO_CONFIG names before the folder the harness itself would use', () => {
  // What a machine sets: the configuration is mounted at a fixed target and
  // the variable points at that file, so it is read wherever the image's user
  // would otherwise look.
  const elsewhere = join(home, 'elsewhere', 'config.json');
  mkdirSync(join(home, 'elsewhere'), { recursive: true });
  writeFileSync(elsewhere, JSON.stringify({ model: 'open_router/named' }));
  put(CONFIG);
  process.env.COPAPO_CONFIG = elsewhere;
  expect(harnessConfigPath()).toBe(elsewhere);
  expect(harnessConfig().model).toBe('open_router/named');

  delete process.env.COPAPO_CONFIG;
  expect(harnessConfigPath()).toBe(join(home, 'copapo', 'config.json'));
});

/*
 * copapo's layers, read with cofold's own resolver under copapo's name: the
 * person's file, then the nearest `.copapo.json` at or above the folder, each
 * merging over the one before.
 * https://github.com/softov/cofold/blob/ee4819644696b88e83e63c56ed7bdf426d32cfb9/packages/papo/src/config.ts#L83-L124
 */
it('reads a project\'s .copapo.json over the person\'s file, as copapo does in that folder', () => {
  put(CONFIG);
  const project = join(home, 'project');
  const nested = join(project, 'src', 'deep');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(project, '.copapo.json'), JSON.stringify({ model: 'open_router/project-model', instructions: 'Project rules.' }));
  const found = harnessConfig(process.env, home, nested);
  expect(found.model).toBe('open_router/project-model');
  expect(found.instructions).toBe('Project rules.');
  // The person's providers stay, the project naming none of its own.
  expect(found.providers.map((one) => one.id)).toEqual(['open_router']);
  // Outside the project, the person's own.
  expect(harnessConfig(process.env, home, home).model).toBe('open_router/~deepseek/deepseek-flash-latest');
});

it('reads copapo\'s own variables over the family\'s', () => {
  process.env.COFOLD_BASE_URL = 'https://family.example/v1';
  process.env.COPAPO_BASE_URL = 'https://copapo.example/v1';
  process.env.COFOLD_API_KEY = 'family-key';
  process.env.COPAPO_API_KEY = 'copapo-key';
  process.env.COFOLD_MODEL = 'family-model';
  process.env.COPAPO_MODEL = 'copapo-model';
  expect(harnessConfig()).toMatchObject({
    providers: [{ id: 'default', baseUrl: 'https://copapo.example/v1', apiKey: 'copapo-key' }],
    model: 'default/copapo-model',
  });
});

it('answers nothing rather than failing when the file is absent or partly wrong', () => {
  expect(harnessConfig().providers).toEqual([]);
  put({ providers: [{ id: 'no-url' }, 7, { baseUrl: 'https://has-no-id/v1' }] });
  expect(harnessConfig().providers).toEqual([]);
});

it('reads a provider called default from the variables the harness reads, on top of the file', () => {
  // No file at all: the variables alone are a provider, which is how a machine
  // gets a key from the vault with no file holding it.
  process.env.COFOLD_BASE_URL = 'https://openrouter.ai/api/v1';
  process.env.COFOLD_API_KEY = 'v';
  process.env.COFOLD_MODEL = 'qwen3';
  expect(harnessConfig()).toMatchObject({
    providers: [{ id: 'default', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'v' }],
    model: 'default/qwen3',
  });

  // With a file, the variables replace its `default` and keep its others, and
  // a model with a slash is taken as it is.
  put({ ...CONFIG, providers: [{ id: 'default', baseUrl: 'http://old/v1' }, ...CONFIG.providers] });
  process.env.COFOLD_MODEL = 'open_router/x';
  const found = harnessConfig();
  expect(found.providers.map((one) => [one.id, one.baseUrl])).toEqual([
    ['default', 'https://openrouter.ai/api/v1'],
    ['open_router', 'https://openrouter.ai/api/v1'],
  ]);
  expect(found.model).toBe('open_router/x');

  // A key with no URL names no provider.
  delete process.env.COFOLD_BASE_URL;
  delete process.env.COFOLD_MODEL;
  expect(harnessConfig().providers.map((one) => one.id)).toEqual(['default', 'open_router']);
  expect(harnessConfig().providers[0]?.baseUrl).toBe('http://old/v1');
});

it('splits a model reference on the first slash, never the last', () => {
  // cofold's own splitter, which is the one this backend resolves a reference
  // with: the cases are here to hold the two answers together.
  expect(splitModel('open_router/~deepseek/deepseek-chat')).toEqual({ provider: 'open_router', modelId: '~deepseek/deepseek-chat' });
  expect(splitModel('deepseek-chat')).toBeUndefined();
  expect(splitModel('/model')).toBeUndefined();
  expect(splitModel('provider/')).toBeUndefined();
});

it('runs on the model the harness named, with that provider endpoint and key', async () => {
  put(CONFIG);
  const real = globalThis.fetch;
  const seen: { url: unknown; authorization: unknown } = { url: undefined, authorization: undefined };
  globalThis.fetch = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    seen.url = input;
    seen.authorization = init?.headers?.authorization;
    return new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  try {
    await modelOf({}, {}, {}).complete({ instructions: 'x', messages: [], tools: [] } as never);
  }
  finally {
    globalThis.fetch = real;
  }
  expect(String(seen.url)).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(seen.authorization).toBe('Bearer k');
});

it('advertises the endpoint the harness named, and runs on its model without a session setting', () => {
  put(CONFIG);
  const agent = cofoldAgent({});
  expect(resourceOf({})).toBe('https://openrouter.ai');
  expect(agent.protectedResources).toEqual([{ resource: 'https://openrouter.ai', resource_name: 'Cofold', required: false }]);
  // The model is the turn's choice, so it is not a session default; a turn
  // that names none still reaches the harness model through `modelOf`.
  expect(agent.defaults()).not.toHaveProperty('model');
  expect(modelOf({}).modelId).toBe('~deepseek/deepseek-flash-latest');
});

it('runs a session in a project on that project\'s .copapo.json', async () => {
  put(CONFIG);
  const project = join(home, 'project');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, '.copapo.json'), JSON.stringify({
    providers: [{ id: 'local', baseUrl: 'https://local.example/v1', apiKey: 'k-local' }],
    model: 'local/project-model',
  }));
  const real = globalThis.fetch;
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    sent.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  try {
    const host = createHost({ path: mkdtempSync(join(tmpdir(), 'ahpd-cofold-project-')), agents: [cofoldAgent({ memory: true })] });
    const notes: { method: string; params: unknown }[] = [];
    const client = host.accept({
      send: () => {}, notify: (method, params) => notes.push({ method, params }), request: async () => ({}), answered: () => {}, close: () => {},
    });
    await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/project', provider: 'cofold', workingDirectories: [`file://${project}`] },
    });
    // The default chat the host minted for the session.
    const chat = ((await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/project' } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
    });
    for (let i = 0; i < 400 && sent.length === 0; i++) await new Promise((r) => { setTimeout(r, 0); });
    expect(sent.at(-1)?.url).toBe('https://local.example/v1/chat/completions');
    expect(sent.at(-1)?.body.model).toBe('project-model');
  }
  finally {
    globalThis.fetch = real;
  }
});

it('lets the plugin and the session win over the harness, and refuses a provider it does not carry', () => {
  put(CONFIG);
  expect(modelOf({ model: 'mine' }, { baseUrl: 'https://mine.example/v1' }).modelId).toBe('mine');
  expect(() => modelOf({ model: 'absent/model' })).toThrow(/configures open_router/);
});
