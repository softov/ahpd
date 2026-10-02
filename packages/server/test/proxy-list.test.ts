/*
 * `ahpd proxy list`, run in this process.
 *
 * The configuration is a temporary directory, so every case writes the file it
 * reads and no case sees the configuration of whoever runs the suite. What is
 * pinned here is the promise the listing makes about a key: the providers and
 * the model names are there, and the key is only ever said to be set or not.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Output } from '@cofold/commands';
import { optionsFrom } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';
import { apiOrigins } from '../src/commands/run.js';
import { servedRegistry, type ServedFacts } from '../src/commands/served.js';
import { apiHandler } from '../src/http.js';

const AUTHORITY = '127.0.0.1:9351';
/** The variables the built-in providers read, which whoever runs the suite may well have set. */
const BUILT_IN_KEYS = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

let home: string;
let config: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-proxy-list-'));
  config = join(home, 'config.json');
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const put = (held: unknown): void => { writeFileSync(config, `${JSON.stringify(held, null, 2)}\n`); };

/** What the terminal command answered. */
const run = async (): Promise<Output> => {
  const registry = cliRegistry();
  const command = registry.find('proxy.list');
  if (command === undefined) throw new Error('no proxy.list');
  const output = await registry.execute(command, { surface: 'cli', input: { configFile: config } });
  if (output === null) throw new Error('proxy.list answered nothing');
  return output;
};

/** The listing with these variables unset, whatever the machine holds. */
const without = async (names: readonly string[]): Promise<Output> => {
  const had = names.map((name) => [name, process.env[name]] as const);
  names.forEach((name) => { delete process.env[name]; });
  try { return await run(); }
  finally { for (const [name, value] of had) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
};

describe('proxy list at the terminal', () => {
  it('lists the built-in providers with no configuration at all', async () => {
    put({});
    const said = await without(BUILT_IN_KEYS);
    expect(said.data).toEqual({
      providers: [
        { id: 'openrouter', endpoint: 'https://openrouter.ai/api/v1', accepts: ['openai-chat'], key: { env: 'OPENROUTER_API_KEY' }, keySet: false },
        { id: 'anthropic', endpoint: 'https://api.anthropic.com', accepts: ['anthropic-messages'], key: { env: 'ANTHROPIC_API_KEY' }, keySet: false },
        { id: 'openai', endpoint: 'https://api.openai.com/v1', accepts: ['openai-chat'], key: { env: 'OPENAI_API_KEY' }, keySet: false },
      ],
      models: [],
    });
    expect(said.plain).toContain('providers:\n');
    expect(said.plain).toContain('models:\n  (none named)\n');
  });

  it('says key set: false for a variable that is not set, and which variable it would read', async () => {
    put({});
    expect((await without(BUILT_IN_KEYS)).plain).toContain('key set: false (ANTHROPIC_API_KEY)');
  });

  it('adds a provider the configuration names, with its model names', async () => {
    put({
      proxy: {
        providers: { 'local-vllm': { endpoint: 'http://localhost:8000/v1', accepts: ['openai-chat'] } },
        models: {
          'anthropic/fable-5': [
            { provider: 'anthropic', id: 'fable-5', price: { input: 3, output: 15 } },
            { provider: 'local-vllm', id: 'Fable-5-4B' },
          ],
        },
      },
    });
    const said = await run();
    expect(said.data).toMatchObject({
      providers: [
        { id: 'openrouter', key: { env: 'OPENROUTER_API_KEY' } },
        { id: 'anthropic', key: { env: 'ANTHROPIC_API_KEY' } },
        { id: 'openai', key: { env: 'OPENAI_API_KEY' } },
        { id: 'local-vllm', endpoint: 'http://localhost:8000/v1', accepts: ['openai-chat'] },
      ],
      models: [{ name: 'anthropic/fable-5', providers: [
        { provider: 'anthropic', id: 'fable-5', price: { input: 3, output: 15 } },
        { provider: 'local-vllm', id: 'Fable-5-4B' },
      ] }],
    });
    // A provider with no key says so, rather than a `key set: false` naming nothing.
    expect(said.plain).toContain('local-vllm  http://localhost:8000/v1  [openai-chat]  no key\n');
    expect(said.plain).toContain('  anthropic/fable-5\n    anthropic: fable-5 ($3 in, $15 out per Mtok)\n    local-vllm: Fable-5-4B\n');
  });

  it('never prints a key, only that the variable is set', async () => {
    const had = process.env['LOCAL_VLLM_KEY'];
    process.env['LOCAL_VLLM_KEY'] = 'sk-should-never-appear';
    try {
      put({ proxy: { providers: { 'local-vllm': { endpoint: 'http://localhost:8000/v1', accepts: ['openai-chat'], key: { env: 'LOCAL_VLLM_KEY' } } } } });
      const said = await run();
      expect(said.plain).toContain('key set: true (LOCAL_VLLM_KEY)');
      expect(said.plain).not.toContain('sk-should-never-appear');
      expect(JSON.stringify(said.data)).not.toContain('sk-should-never-appear');
    }
    finally {
      if (had === undefined) delete process.env['LOCAL_VLLM_KEY']; else process.env['LOCAL_VLLM_KEY'] = had;
    }
  });
});

describe('proxy list, served', () => {
  /** The daemon's own answer to a path under the API. */
  const get = async (path: string): Promise<Response> => {
    const facts: ServedFacts = {
      options: optionsFrom({ configFile: config }),
      configFile: config,
      running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9351, paths: [], startedAt: '' }),
      turning: () => [],
      restart: () => {},
    };
    const handler = apiHandler({
      registry: servedRegistry(facts),
      token: 'root-secret',
      program: { name: 'ahpd', version: '0.0.0' },
      origins: () => apiOrigins('127.0.0.1', undefined, 9351),
    });
    return handler(new Request(`http://${AUTHORITY}/api${path}`, {
      headers: { host: AUTHORITY, authorization: 'Bearer root-secret' },
    }));
  };

  it('answers the daemon\'s own providers and model names', async () => {
    put({
      proxy: {
        providers: { 'local-vllm': { endpoint: 'http://localhost:8000/v1', accepts: ['openai-chat'] } },
        models: { 'deepseek/deepseek-v4.1-flash': [{ provider: 'local-vllm', id: 'deepseek-v4.1-flash' }] },
      },
    });
    const answered = await get('/proxy/list');
    expect(answered.status).toBe(200);
    const body = await answered.json() as { providers: { id: string }[]; models: { name: string }[] };
    expect(body.providers.map((row) => row.id)).toEqual(['openrouter', 'anthropic', 'openai', 'local-vllm']);
    expect(body.models).toEqual([{ name: 'deepseek/deepseek-v4.1-flash', providers: [
      { provider: 'local-vllm', id: 'deepseek-v4.1-flash' },
    ] }]);
  });
});
