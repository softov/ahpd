import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { facioAgent, harnessConfig, modelOf, resourceOf, splitModel } from '../packages/agent-facio/src/index.js';

/*
 * The harness's own configuration, read by the backend.
 *
 * facio already has a file a person writes once, and the point of reading it
 * is that a key does not have to be lent or repeated: a daemon whose bridge
 * names no model still runs on the provider the harness was pointed at. Every
 * case here owns its own `XDG_CONFIG_HOME`, so nothing reads the real one.
 */

let home: string;
let had: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-facio-config-'));
  had = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = home;
});

afterEach(() => {
  if (had === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = had;
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
  mkdirSync(join(home, 'facio'), { recursive: true });
  writeFileSync(join(home, 'facio', 'config.json'), JSON.stringify(value));
};

it('reads the file the harness reads, and only the parts a backend needs', () => {
  put(CONFIG);
  const found = harnessConfig();
  expect(found.path).toBe(join(home, 'facio', 'config.json'));
  expect(found.providers).toEqual([{ id: 'open_router', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' }]);
  expect(found.model).toBe('open_router/~deepseek/deepseek-flash-latest');
  expect(found.instructions).toBe('Be careful.');
});

it('answers nothing rather than failing when the file is absent or partly wrong', () => {
  expect(harnessConfig().providers).toEqual([]);
  put({ providers: [{ id: 'no-url' }, 7, { baseUrl: 'https://has-no-id/v1' }] });
  expect(harnessConfig().providers).toEqual([]);
});

it('splits a model reference on the first slash, never the last', () => {
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

it('advertises the endpoint the harness named and defaults to its model', () => {
  put(CONFIG);
  const agent = facioAgent({});
  expect(resourceOf({})).toBe('https://openrouter.ai');
  expect(agent.protectedResources).toEqual([{ resource: 'https://openrouter.ai', resource_name: 'Facio', required: false }]);
  expect(agent.defaults()).toMatchObject({ model: 'open_router/~deepseek/deepseek-flash-latest' });
});

it('lets the plugin and the session win over the harness, and refuses a provider it does not carry', () => {
  put(CONFIG);
  expect(modelOf({ model: 'mine' }, { baseUrl: 'https://mine.example/v1' }).modelId).toBe('mine');
  expect(() => modelOf({ model: 'absent/model' })).toThrow(/configures open_router/);
});
