import { describe, expect, it } from 'vitest';
import type { Adapter, Connector } from '@ahpd/sdk';
import { hostAdapters } from '../src/proxy/adapters.js';

/*
 * The four provider adapters the host ships.
 *
 * They are the seam a model provider is a connector through: the schema a
 * person fills in, the `provider` that tells the proxy where to call, the check
 * that proves the key, and the icon a client draws. No network is touched: each
 * check goes out through the `fetch` a test hands over.
 */

/** What one fake `fetch` was asked, and the answer or throw it gives. */
const fake = (answer: Response | Error) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof fetch;
  return { fetch: fetcher, calls };
};

/** What one fake `fetch` was asked, answering the n-th call with the n-th answer. */
const sequence = (answers: (Response | Error)[]) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
    const answer = answers[calls.length - 1];
    if (answer === undefined) throw new Error(`one call too many: ${String(url)}`);
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof fetch;
  return { fetch: fetcher, calls };
};

/** A JSON answer, as a provider sends one. */
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** The four adapters, with a check that would answer 500 if it were reached. */
const four = (fetcher?: typeof fetch): Record<string, Adapter> =>
  hostAdapters({ ...(fetcher === undefined ? {} : { fetch: fetcher }) });

/** One connector of an adapter, as `open` and `check` are handed it. */
const connector = (adapter: string, config: Record<string, unknown>): Connector => ({ id: 'one', adapter, owner: 'host', config });

/** The form of an adapter, as its schema writes it. */
const formOf = (adapter: Adapter): { properties: Record<string, Record<string, unknown>>; required?: string[] } =>
  adapter.schema as { properties: Record<string, Record<string, unknown>>; required?: string[] };

const HEADERS = (init: RequestInit | undefined): Headers => new Headers(init?.headers);

describe('the host provider adapters', () => {
  it('ships the four adapters, each with the models capability and an icon', () => {
    const adapters = four();
    expect(Object.keys(adapters).sort()).toEqual(['anthropic', 'openai', 'openai-compatible', 'openrouter']);
    for (const adapter of Object.values(adapters)) {
      expect(adapter.capabilities).toContainEqual(expect.objectContaining({ type: 'models' }));
      expect(adapter.icons?.length).toBeGreaterThan(0);
      expect(adapter.provider).toBeTypeOf('function');
      expect(adapter.models).toBeTypeOf('function');
      expect(adapter.check).toBeTypeOf('function');
    }
    // OpenRouter is the one with a variant for each theme.
    expect(adapters['openrouter']?.icons?.map((one) => one.theme)).toEqual(['light', 'dark']);
  });

  it('requires a key for the three vendor providers and keeps it in the vault', () => {
    const adapters = four();
    const defaults: Record<string, string> = {
      openrouter: 'https://openrouter.ai/api/v1',
      anthropic: 'https://api.anthropic.com',
      openai: 'https://api.openai.com/v1',
    };
    for (const [name, endpoint] of Object.entries(defaults)) {
      const form = formOf(adapters[name]!);
      expect(form.required).toEqual(['key']);
      expect(form.properties['key']).toMatchObject({ type: 'string', writeOnly: true });
      expect(form.properties['endpoint']).toMatchObject({ type: 'string', default: endpoint });
    }
  });

  it('requires an endpoint for an OpenAI-compatible server, with an optional key and the chat dialect by default', () => {
    const form = formOf(four()['openai-compatible']!);
    expect(form.required).toEqual(['endpoint']);
    expect(form.properties['endpoint']).toMatchObject({ type: 'string' });
    expect(form.properties['endpoint']).not.toHaveProperty('default');
    expect(form.properties['key']).toMatchObject({ type: 'string', writeOnly: true });
    expect(form.properties['accepts']).toMatchObject({ type: 'array', default: ['openai-chat'] });
  });

  it('answers provider from the connector config, defaulting the vendor endpoint', () => {
    const adapters = four();
    expect(adapters['openrouter']!.provider!(connector('openrouter', { key: 'sk-or' }))).toEqual({
      endpoint: 'https://openrouter.ai/api/v1',
      accepts: ['openai-chat'],
      key: 'sk-or',
    });
    expect(adapters['anthropic']!.provider!(connector('anthropic', { key: 'sk-an' }))).toEqual({
      endpoint: 'https://api.anthropic.com',
      accepts: ['anthropic-messages'],
      key: 'sk-an',
    });
    expect(adapters['openai']!.provider!(connector('openai', { key: 'sk-oa', endpoint: 'https://gateway.test/v1/' }))).toEqual({
      endpoint: 'https://gateway.test/v1',
      accepts: ['openai-chat'],
      key: 'sk-oa',
    });
  });

  it('answers provider for an OpenAI-compatible endpoint from its own config, with no key when there is none', () => {
    const provider = four()['openai-compatible']!.provider!;
    expect(provider(connector('openai-compatible', { endpoint: 'http://127.0.0.1:1234/v1' }))).toEqual({
      endpoint: 'http://127.0.0.1:1234/v1',
      accepts: ['openai-chat'],
      prefix: 'one',
    });
    expect(provider(connector('openai-compatible', {
      endpoint: 'http://127.0.0.1:1234/v1', key: 'local', accepts: ['anthropic-messages'],
    }))).toEqual({
      endpoint: 'http://127.0.0.1:1234/v1',
      accepts: ['anthropic-messages'],
      prefix: 'one',
      key: 'local',
    });
  });

  it('refuses to answer provider without what its form requires', () => {
    const adapters = four();
    expect(() => adapters['openrouter']!.provider!(connector('openrouter', {}))).toThrow('one names no key');
    expect(() => adapters['openai-compatible']!.provider!(connector('openai-compatible', {}))).toThrow('one names no endpoint');
  });

  it('checks OpenRouter at /key with the key as a bearer token', async () => {
    const probe = fake(new Response(null, { status: 200 }));
    const adapter = four(probe.fetch)['openrouter']!;
    expect(await adapter.check!(connector('openrouter', { key: 'sk-or' }))).toEqual({ result: 'ok' });
    expect(probe.calls).toHaveLength(1);
    expect(probe.calls[0]!.url).toBe('https://openrouter.ai/api/v1/key');
    expect(HEADERS(probe.calls[0]!.init).get('authorization')).toBe('Bearer sk-or');
  });

  it('checks Anthropic at /v1/models with its key header and version', async () => {
    const probe = fake(new Response(null, { status: 200 }));
    const adapter = four(probe.fetch)['anthropic']!;
    expect(await adapter.check!(connector('anthropic', { key: 'sk-an' }))).toEqual({ result: 'ok' });
    expect(probe.calls[0]!.url).toBe('https://api.anthropic.com/v1/models');
    expect(HEADERS(probe.calls[0]!.init).get('x-api-key')).toBe('sk-an');
    expect(HEADERS(probe.calls[0]!.init).get('anthropic-version')).toBe('2023-06-01');
  });

  it('checks OpenAI and an OpenAI-compatible endpoint at /models, with no auth when there is no key', async () => {
    const openai = fake(new Response(null, { status: 200 }));
    expect(await four(openai.fetch)['openai']!.check!(connector('openai', { key: 'sk-oa' }))).toEqual({ result: 'ok' });
    expect(openai.calls[0]!.url).toBe('https://api.openai.com/v1/models');
    expect(HEADERS(openai.calls[0]!.init).get('authorization')).toBe('Bearer sk-oa');

    const local = fake(new Response(null, { status: 200 }));
    expect(await four(local.fetch)['openai-compatible']!.check!(connector('openai-compatible', { endpoint: 'http://127.0.0.1:1234/v1' })))
      .toEqual({ result: 'ok' });
    expect(local.calls[0]!.url).toBe('http://127.0.0.1:1234/v1/models');
    expect(HEADERS(local.calls[0]!.init).has('authorization')).toBe(false);
  });

  it('maps 401 and 403 to denied, and any other answer to failed with its status', async () => {
    const adapter = (status: number) => four(fake(new Response('no', { status })).fetch)['openai']!;
    expect(await adapter(401).check!(connector('openai', { key: 'k' }))).toEqual({ result: 'denied', message: 'HTTP 401' });
    expect(await adapter(403).check!(connector('openai', { key: 'k' }))).toEqual({ result: 'denied', message: 'HTTP 403' });
    expect(await adapter(429).check!(connector('openai', { key: 'k' }))).toEqual({ result: 'failed', message: 'HTTP 429' });
    expect(await adapter(500).check!(connector('openai', { key: 'k' }))).toEqual({ result: 'failed', message: 'HTTP 500' });
  });

  it('maps a call that does not connect to unreachable', async () => {
    const probe = fake(new Error('connect ECONNREFUSED'));
    expect(await four(probe.fetch)['openai']!.check!(connector('openai', { key: 'k' }))).toEqual({ result: 'unreachable' });
  });

  it('gives each check an abort signal of its own', async () => {
    const probe = fake(new Response(null, { status: 200 }));
    await four(probe.fetch)['openai']!.check!(connector('openai', { key: 'k' }));
    expect(probe.calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('lists OpenRouter\'s models with the name, the window and the price it gives', async () => {
    const probe = fake(json({
      data: [
        {
          id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', context_length: 200000,
          pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { modality: 'text' },
        },
        { name: 'no id at all' },
      ],
    }));
    const models = await four(probe.fetch)['openrouter']!.models!(connector('openrouter', { key: 'sk-or' }));
    expect(models).toEqual([{
      id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', context_length: 200000,
      pricing: { prompt: '0.000003', completion: '0.000015' },
    }]);
    expect(probe.calls[0]!.url).toBe('https://openrouter.ai/api/v1/models');
    expect(HEADERS(probe.calls[0]!.init).get('authorization')).toBe('Bearer sk-or');
  });

  it('lists Anthropic\'s models a page at a time, with display_name and max_input_tokens', async () => {
    const probe = sequence([
      json({ data: [{ id: 'claude-a', display_name: 'Claude A', max_input_tokens: 200000 }], has_more: true, last_id: 'claude-a' }),
      json({ data: [{ id: 'claude-b', display_name: 'Claude B' }], has_more: false, first_id: 'claude-a', last_id: 'claude-b' }),
    ]);
    const models = await four(probe.fetch)['anthropic']!.models!(connector('anthropic', { key: 'sk-an' }));
    expect(models).toEqual([
      { id: 'claude-a', name: 'Claude A', context_length: 200000 },
      { id: 'claude-b', name: 'Claude B' },
    ]);
    expect(probe.calls.map((one) => one.url)).toEqual([
      'https://api.anthropic.com/v1/models?limit=1000',
      'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-a',
    ]);
    expect(HEADERS(probe.calls[1]!.init).get('x-api-key')).toBe('sk-an');
    expect(HEADERS(probe.calls[1]!.init).get('anthropic-version')).toBe('2023-06-01');
  });

  it('stops paging Anthropic when it says there is more but names no last id', async () => {
    const probe = fake(json({ data: [{ id: 'claude-a' }], has_more: true }));
    expect(await four(probe.fetch)['anthropic']!.models!(connector('anthropic', { key: 'sk-an' })))
      .toEqual([{ id: 'claude-a' }]);
    expect(probe.calls).toHaveLength(1);
  });

  it('lists OpenAI\'s models as ids alone', async () => {
    const probe = fake(json({ object: 'list', data: [{ id: 'gpt-5.5', object: 'model' }, { object: 'model' }] }));
    expect(await four(probe.fetch)['openai']!.models!(connector('openai', { key: 'sk-oa' })))
      .toEqual([{ id: 'gpt-5.5' }]);
    expect(probe.calls[0]!.url).toBe('https://api.openai.com/v1/models');
  });

  it('lists an OpenAI-compatible endpoint\'s models, with a name and a window when it gives them', async () => {
    const probe = fake(json({ data: [{ id: 'llama-3', name: 'Llama 3', context_length: 8192 }, { no: 'id' }] }));
    const models = await four(probe.fetch)['openai-compatible']!.models!(connector('openai-compatible', {
      endpoint: 'http://127.0.0.1:1234/v1', key: 'local',
    }));
    expect(models).toEqual([{ id: 'llama-3', name: 'Llama 3', context_length: 8192 }]);
    expect(probe.calls[0]!.url).toBe('http://127.0.0.1:1234/v1/models');
    expect(HEADERS(probe.calls[0]!.init).get('authorization')).toBe('Bearer local');
  });

  it('calls an OpenAI-compatible list with no auth when the connector has no key', async () => {
    const probe = fake(json({ data: [] }));
    await four(probe.fetch)['openai-compatible']!.models!(connector('openai-compatible', { endpoint: 'http://127.0.0.1:1234/v1' }));
    expect(HEADERS(probe.calls[0]!.init).has('authorization')).toBe(false);
  });

  it('refuses a list with its HTTP status, and never follows a redirect', async () => {
    const refused = fake(new Response('no', { status: 401 }));
    await expect(four(refused.fetch)['openai']!.models!(connector('openai', { key: 'k' }))).rejects.toThrow('HTTP 401');

    const probe = fake(json({ data: [] }));
    await four(probe.fetch)['openai']!.models!(connector('openai', { key: 'k' }));
    expect(probe.calls[0]!.init?.redirect).toBe('error');
    expect(probe.calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reads each icon into a data: URI under the size limit, with no script and a colour', () => {
    for (const adapter of Object.values(four())) {
      for (const icon of adapter.icons ?? []) {
        expect(icon.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
        const source = Buffer.from(icon.src.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
        expect(Buffer.byteLength(source)).toBeLessThanOrEqual(32 * 1024);
        expect(source).not.toMatch(/<script/iu);
        expect(source).not.toMatch(/\son[a-z]+\s*=/iu);
        expect(source).toMatch(/#[0-9A-Fa-f]{6}/u);
      }
    }
  });
});
