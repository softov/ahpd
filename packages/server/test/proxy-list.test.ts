/*
 * `ahpd proxy list`, run in this process.
 *
 * The configuration is a temporary directory, so every case writes the file it
 * reads and no case sees the configuration of whoever runs the suite. A
 * provider is a connector now, so what is pinned here is the split the listing
 * makes: the model names and the entries that serve each are the file's, and a
 * connector's endpoint and key are the connectors store's, never this listing's.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

let home: string;
let config: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-proxy-list-'));
  config = join(home, 'config.json');
});
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const put = (held: unknown): void => { writeFileSync(config, `${JSON.stringify(held, null, 2)}\n`); };

/** One connector kept where the daemon reads them, so a case can show the listing does not read it. */
const putConnector = (held: unknown): void => {
  const dir = join(home, 'ahpd', 'connectors');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${String((held as { id: string }).id)}.json`), `${JSON.stringify(held, null, 2)}\n`);
};

/** What the terminal command answered. */
const run = async (): Promise<Output> => {
  const registry = cliRegistry();
  const command = registry.find('proxy.list');
  if (command === undefined) throw new Error('no proxy.list');
  const output = await registry.execute(command, { surface: 'cli', input: { configFile: config } });
  if (output === null) throw new Error('proxy.list answered nothing');
  return output;
};

describe('proxy list at the terminal', () => {
  it('lists no model name with no configuration at all', async () => {
    put({});
    const said = await run();
    expect(said.data).toEqual({ models: [] });
    expect(said.plain).toContain('models:\n  (none named)\n');
  });

  it('lists each model name with the providers its entries name', async () => {
    put({
      modelProxy: {
        models: {
          'anthropic/fable-5': [
            { provider: 'anthropic', id: 'fable-5', price: { input: 3, output: 15 } },
            { provider: 'local-vllm', id: 'Fable-5-4B' },
          ],
        },
      },
    });
    const said = await run();
    expect(said.data).toEqual({
      models: [{ name: 'anthropic/fable-5', providers: [
        { provider: 'anthropic', id: 'fable-5', price: { input: 3, output: 15 } },
        { provider: 'local-vllm', id: 'Fable-5-4B' },
      ] }],
    });
    expect(said.plain).toContain('  anthropic/fable-5\n    anthropic: fable-5 ($3 in, $15 out per Mtok)\n    local-vllm: Fable-5-4B\n');
  });

  it('says nothing about a connector: no endpoint and no key', async () => {
    put({ modelProxy: { models: { 'anthropic/fable-5': [{ provider: 'anthropic', id: 'fable-5' }] } } });
    putConnector({
      id: 'anthropic', adapter: 'anthropic', owner: 'host',
      config: { endpoint: 'https://gateway.test', key: { fromEnv: 'ANTHROPIC_API_KEY' } },
    });
    const had = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'sk-should-never-appear';
    try {
      const said = await run();
      expect(said.data).toEqual({
        models: [{ name: 'anthropic/fable-5', providers: [{ provider: 'anthropic', id: 'fable-5' }] }],
      });
      for (const word of ['gateway.test', 'sk-should-never-appear', 'ANTHROPIC_API_KEY']) {
        expect(said.plain).not.toContain(word);
        expect(JSON.stringify(said.data)).not.toContain(word);
      }
    }
    finally {
      if (had === undefined) delete process.env['ANTHROPIC_API_KEY']; else process.env['ANTHROPIC_API_KEY'] = had;
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
      restart: () => ({ restartDelayMs: 0 }),
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

  it('answers the daemon\'s own model names', async () => {
    put({
      modelProxy: {
        models: { 'deepseek/deepseek-v4.1-flash': [{ provider: 'local-vllm', id: 'deepseek-v4.1-flash' }] },
      },
    });
    const answered = await get('/proxy/list');
    expect(answered.status).toBe(200);
    const body = await answered.json() as { models: { name: string }[] };
    expect(body.models).toEqual([{ name: 'deepseek/deepseek-v4.1-flash', providers: [
      { provider: 'local-vllm', id: 'deepseek-v4.1-flash' },
    ] }]);
  });
});
