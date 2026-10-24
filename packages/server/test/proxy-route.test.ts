/*
 * Which connector a model name is called on.
 *
 * `route` is a function of the table, the caller's dialect, the open provider
 * connectors, the caller and a policy, so it is checked here without a
 * listener: the connectors are plain fixtures, so no key and no socket is
 * involved.
 */

import { describe, expect, it } from 'vitest';
import type { Principal, ProviderConnector } from '@ahpd/sdk';
import type { ProxyCaller } from '../src/proxy/caller.js';
import { modelCatalog } from '../src/proxy/catalog.js';
import { proxyConfiguration, type ModelEntry } from '../src/proxy/providers.js';
import { route, upstreamUrl, type RouteOptions, type Routed } from '../src/proxy/route.js';

/** A key nobody has, so a refusal or a log that held it is found by looking for it. */
const MARKER = 'sk-marker-0f9e8d7c6b5a';

/** Softov's configuration's model names, as they were on 2026-10-06. */
const TABLE = proxyConfiguration({
  models: {
    'anthropic/claude-sonnet-5-5': [
      { provider: 'anthropic', id: 'claude-sonnet-5-5' },
      { provider: 'openrouter', id: 'anthropic/claude-sonnet-5.5', price: { input: 2, output: 10 } },
    ],
    'anthropic/claude-opus-5-5': [{ provider: 'anthropic', id: 'claude-opus-5-5' }],
    'openai/gpt-5.5': [{ provider: 'openrouter', id: 'openai/gpt-5.5', price: { input: 5, output: 30 } }],
    'local/default': [{ provider: 'local', id: 'local-model' }],
  },
});

/** The host's three connectors: two vendors and a local endpoint named by its id. */
const CONNECTORS: ProviderConnector[] = [
  {
    id: 'openrouter-main', adapter: 'openrouter', owner: 'host',
    provider: { endpoint: 'https://openrouter.ai/api/v1', accepts: ['openai-chat'], key: MARKER },
    models: async () => [
      {
        id: 'anthropic/claude-sonnet-5.5',
        name: 'Anthropic: Claude Sonnet 5.5',
        context_length: 200_000,
        pricing: { prompt: '0.000003', completion: '0.000015' },
      },
    ],
  },
  {
    id: 'anthropic-main', adapter: 'anthropic', owner: 'host',
    provider: { endpoint: 'https://api.anthropic.com', accepts: ['anthropic-messages'], key: MARKER },
    models: async () => [{ id: 'claude-sonnet-5-5', context_length: 200_000 }],
  },
  {
    // An openai-compatible endpoint names itself, so its models are `local/<id>`.
    id: 'local', adapter: 'openai-compatible', owner: 'host',
    provider: { endpoint: 'http://127.0.0.1:1234/v1', accepts: ['openai-chat'], prefix: 'local' },
    models: async () => [{ id: 'llama-3' }],
  },
];

/** A caller who is that person, holding every grant. */
const person = (id: string, team?: string): ProxyCaller => ({
  kind: 'person',
  principal: { id, roles: [], can: () => true } as unknown as Principal,
  ...(team === undefined ? {} : { scope: { team } }),
});

/** The candidates of an answer that routed, or a failure naming the refusal. */
const routed = (answer: Routed) => {
  if ('refusal' in answer) throw new Error(`refused: ${answer.refusal.message}`);
  return answer.candidates;
};

/** The refusal of an answer that did not route. */
const refused = (answer: Routed) => {
  if (!('refusal' in answer)) throw new Error('it routed');
  return answer.refusal;
};

/** A route over the host's connectors. */
const over = (name: string, dialect: 'openai-chat' | 'anthropic-messages', options: Partial<RouteOptions> = {}) =>
  route(TABLE, name, dialect, { providers: CONNECTORS, ...options });

describe('route', () => {
  it('sends a name to the entry that takes the caller\'s dialect, on that connector\'s endpoint and key', async () => {
    const openai = routed(await over('anthropic/claude-sonnet-5-5', 'openai-chat'));
    expect(openai.map((one) => [one.connector, one.provider, one.entry.id])).toEqual([['openrouter-main', 'openrouter', 'anthropic/claude-sonnet-5.5']]);
    expect(openai[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(openai[0]?.key).toBe(MARKER);

    const anthropic = routed(await over('anthropic/claude-sonnet-5-5', 'anthropic-messages'));
    expect(anthropic.map((one) => [one.connector, one.provider, one.entry.id])).toEqual([['anthropic-main', 'anthropic', 'claude-sonnet-5-5']]);
    expect(anthropic[0]?.url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('calls a connector that has no key with none', async () => {
    const [local] = routed(await over('local/default', 'openai-chat'));
    expect(local?.connector).toBe('local');
    expect(local?.provider).toBe('openai-compatible');
    expect(local?.entry.id).toBe('local-model');
    expect(local?.url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect(local?.key).toBeUndefined();
  });

  it('keeps every candidate in the file\'s order, for the fallback', async () => {
    const table = proxyConfiguration({
      models: { 'maker/model': [{ provider: 'openrouter', id: 'one' }, { provider: 'anthropic', id: 'skipped' }, { provider: 'gateway', id: 'two' }] },
    });
    const providers: ProviderConnector[] = [
      ...CONNECTORS,
      { id: 'gateway', adapter: 'gateway', owner: 'host', provider: { endpoint: 'http://127.0.0.1:9/v1', accepts: ['openai-chat'], key: MARKER } },
    ];
    const candidates = routed(await route(table, 'maker/model', 'openai-chat', { providers }));
    expect(candidates.map((one) => one.connector)).toEqual(['openrouter-main', 'gateway']);
  });

  it('refuses a name nobody serves without reading anything else', async () => {
    const refusal = refused(await route(TABLE, 'nobody/nothing', 'openai-chat', {
      providers: CONNECTORS,
      allowed: () => { throw new Error('the policy was asked'); },
    }));
    expect(refusal).toEqual({ status: 404, message: 'model nobody/nothing is not served here', code: 'model_not_found' });
  });

  it('answers 503 naming the provider when no open connector serves the entry', async () => {
    const refusal = refused(await route(TABLE, 'openai/gpt-5.5', 'openai-chat', { providers: [] }));
    expect(refusal.status).toBe(503);
    expect(refusal.message).toBe('model openai/gpt-5.5 has no open connector for openrouter');
    expect(JSON.stringify(refusal)).not.toContain(MARKER);
  });

  it('refuses a name served only in the other dialect, naming where to call it', async () => {
    const refusal = refused(await over('openai/gpt-5.5', 'anthropic-messages'));
    expect(refusal.status).toBe(404);
    expect(refusal.code).toBe('model_not_found');
    expect(refusal.message).toBe('model openai/gpt-5.5 is served in openai-chat, not anthropic-messages: call POST /v1/chat/completions');
  });

  it('passes over an entry with no usable connector, and answers the next one', async () => {
    const table = proxyConfiguration({ models: { 'm/x': [{ provider: 'openai', id: 'a' }, { provider: 'openrouter', id: 'b' }] } });
    const [only] = routed(await route(table, 'm/x', 'openai-chat', { providers: CONNECTORS }));
    expect(only?.connector).toBe('openrouter-main');
  });

  it('passes over an entry the policy refuses, and answers the first refusal when none is left', async () => {
    const refusal = refused(await over('openai/gpt-5.5', 'openai-chat', {
      allowed: (entry) => `deny-openai refuses model openai/gpt-5.5 through ${entry.provider}`,
    }));
    expect(refusal).toEqual({ status: 403, message: 'deny-openai refuses model openai/gpt-5.5 through openrouter' });
  });

  it('asks the policy before the caller\'s connectors, so a refused entry is a 403 whatever they may use', async () => {
    const refusal = refused(await over('openai/gpt-5.5', 'openai-chat', { caller: person('gus'), allowed: () => 'refused' }));
    expect(refusal.status).toBe(403);
  });

  it('names one connector by its id, and no other connector of its adapter', async () => {
    const table = proxyConfiguration({ models: { 'm/x': [{ provider: 'anthropic-main', id: 'a' }] } });
    const providers: ProviderConnector[] = [
      ...CONNECTORS,
      { id: 'anthropic-spare', adapter: 'anthropic', owner: 'host', provider: { endpoint: 'https://spare.test', accepts: ['anthropic-messages'], key: MARKER } },
    ];
    const candidates = routed(await route(table, 'm/x', 'anthropic-messages', { providers }));
    expect(candidates.map((one) => one.connector)).toEqual(['anthropic-main']);
  });

  it('takes a person\'s own connector before the host\'s for the same entry, even when its id sorts later', async () => {
    const table = proxyConfiguration({ models: { 'm/x': [{ provider: 'openrouter', id: 'a' }] } });
    const providers: ProviderConnector[] = [
      { id: 'aaa-host', adapter: 'openrouter', owner: 'host', provider: { endpoint: 'https://host.test/v1', accepts: ['openai-chat'], key: MARKER } },
      { id: 'work', adapter: 'openrouter', owner: 'user:ana', provider: { endpoint: 'https://ana.test/v1', accepts: ['openai-chat'], key: 'ana-key' } },
    ];
    expect(routed(await route(table, 'm/x', 'openai-chat', { providers, caller: person('ana') })).map((one) => one.connector))
      .toEqual(['work', 'aaa-host']);
    // Somebody else's connector is not this caller's, so only the host's is left.
    expect(routed(await route(table, 'm/x', 'openai-chat', { providers, caller: person('gus') })).map((one) => one.connector))
      .toEqual(['aaa-host']);
  });

  it('serves a team connector only under that team\'s scope, between the caller\'s own and the host\'s', async () => {
    const table = proxyConfiguration({ models: { 'm/x': [{ provider: 'openrouter', id: 'a' }] } });
    const providers: ProviderConnector[] = [
      { id: 'host-one', adapter: 'openrouter', owner: 'host', provider: { endpoint: 'https://host.test/v1', accepts: ['openai-chat'], key: MARKER } },
      { id: 'backend', adapter: 'openrouter', owner: 'team:backend', provider: { endpoint: 'https://team.test/v1', accepts: ['openai-chat'], key: MARKER } },
      { id: 'mine', adapter: 'openrouter', owner: 'user:ana', provider: { endpoint: 'https://ana.test/v1', accepts: ['openai-chat'], key: MARKER } },
    ];
    expect(routed(await route(table, 'm/x', 'openai-chat', { providers, caller: person('ana', 'backend') })).map((one) => one.connector))
      .toEqual(['mine', 'backend', 'host-one']);
    expect(routed(await route(table, 'm/x', 'openai-chat', { providers, caller: person('ana', 'other') })).map((one) => one.connector))
      .toEqual(['mine', 'host-one']);
    expect(routed(await route(table, 'm/x', 'openai-chat', { providers, caller: person('gus') })).map((one) => one.connector))
      .toEqual(['host-one']);
  });

  it('uses a team connector for nobody when the only connector of the entry is not the caller\'s', async () => {
    const table = proxyConfiguration({ models: { 'm/x': [{ provider: 'openrouter', id: 'a' }] } });
    const providers: ProviderConnector[] = [
      { id: 'backend', adapter: 'openrouter', owner: 'team:backend', provider: { endpoint: 'https://team.test/v1', accepts: ['openai-chat'], key: MARKER } },
    ];
    expect(routed(await route(table, 'm/x', 'openai-chat', { providers, caller: person('ana', 'backend') })).map((one) => one.connector))
      .toEqual(['backend']);
    const refusal = refused(await route(table, 'm/x', 'openai-chat', { providers, caller: person('gus') }));
    expect(refusal.status).toBe(503);
    expect(refusal.message).toBe('model m/x has no connector this caller may use for openrouter');
  });

  it('serves a session the connector of the person whose work it is', async () => {
    const table = proxyConfiguration({ models: { 'm/x': [{ provider: 'openrouter', id: 'a' }] } });
    const providers: ProviderConnector[] = [
      { id: 'mine', adapter: 'openrouter', owner: 'user:ana', provider: { endpoint: 'https://ana.test/v1', accepts: ['openai-chat'], key: MARKER } },
    ];
    const caller: ProxyCaller = { kind: 'session', session: 's-1', owner: 'user:ana', scope: { team: 'backend' } };
    expect(routed(await route(table, 'm/x', 'openai-chat', { providers, caller })).map((one) => one.connector)).toEqual(['mine']);
  });

  it('orders two connectors of one tier by id, and keeps the second as the fallback', async () => {
    const table = proxyConfiguration({ models: { 'm/x': [{ provider: 'openrouter', id: 'a' }] } });
    const providers: ProviderConnector[] = [
      { id: 'zulu', adapter: 'openrouter', owner: 'host', provider: { endpoint: 'https://zulu.test/v1', accepts: ['openai-chat'], key: MARKER } },
      { id: 'alpha', adapter: 'openrouter', owner: 'host', provider: { endpoint: 'https://alpha.test/v1', accepts: ['openai-chat'], key: MARKER } },
    ];
    expect(routed(await route(table, 'm/x', 'openai-chat', { providers })).map((one) => one.connector)).toEqual(['alpha', 'zulu']);
  });

  it('leaves out a connector whose provider does not speak the caller\'s dialect', async () => {
    const table = proxyConfiguration({ models: { 'm/x': [{ provider: 'openrouter', id: 'a' }] } });
    const providers: ProviderConnector[] = [
      { id: 'chat', adapter: 'openrouter', owner: 'host', provider: { endpoint: 'https://chat.test/v1', accepts: ['openai-chat'], key: MARKER } },
      { id: 'messages', adapter: 'openrouter', owner: 'host', provider: { endpoint: 'https://messages.test', accepts: ['anthropic-messages'], key: MARKER } },
    ];
    expect(routed(await route(table, 'm/x', 'anthropic-messages', { providers })).map((one) => one.connector)).toEqual(['messages']);
  });
});

describe('a name the file does not hold', () => {
  it('routes it by its provider prefix, with the rest as the provider\'s own id', async () => {
    const [one] = routed(await over('openrouter/anthropic/claude-sonnet-5.5', 'openai-chat'));
    expect(one?.connector).toBe('openrouter-main');
    expect(one?.provider).toBe('openrouter');
    expect(one?.entry).toEqual({ provider: 'openrouter', id: 'anthropic/claude-sonnet-5.5' });
    expect(one?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(one?.key).toBe(MARKER);
  });

  it('routes an openai-compatible connector\'s models by that connector\'s id', async () => {
    const [one] = routed(await over('local/llama-3', 'openai-chat'));
    expect(one?.connector).toBe('local');
    expect(one?.entry.id).toBe('llama-3');
    expect(one?.key).toBeUndefined();
  });

  it('sends a name the list does not hold yet, so the provider answers it', async () => {
    const [one] = routed(await over('openrouter/brand-new', 'openai-chat'));
    expect(one?.connector).toBe('openrouter-main');
    expect(one?.entry).toEqual({ provider: 'openrouter', id: 'brand-new' });
    expect(one?.model).toBeUndefined();
  });

  it('keeps a name in the file over a fetched name of the same spelling', async () => {
    const table = proxyConfiguration({
      models: { 'openrouter/anthropic/claude-sonnet-5.5': [{ provider: 'anthropic', id: 'mine' }] },
    });
    const [one] = routed(await route(table, 'openrouter/anthropic/claude-sonnet-5.5', 'anthropic-messages', { providers: CONNECTORS }));
    expect(one?.connector).toBe('anthropic-main');
    expect(one?.entry.id).toBe('mine');
    // And the fetched route is not a fallback when the table names nothing that speaks.
    const refusal = refused(await route(table, 'openrouter/anthropic/claude-sonnet-5.5', 'openai-chat', { providers: CONNECTORS }));
    expect(refusal.status).toBe(404);
  });

  it('gives a fetched name the provider\'s price and its own row', async () => {
    const catalogue = modelCatalog({ providers: () => CONNECTORS });
    try {
      await catalogue.refresh();
      const [one] = routed(await over('openrouter/anthropic/claude-sonnet-5.5', 'openai-chat', { catalog: catalogue }));
      expect(one?.entry.price).toEqual({ input: 3, output: 15 });
      expect(one?.model).toMatchObject({ context_length: 200_000 });
      // A model the list does not price is routed with no price at all.
      const [free] = routed(await over('local/llama-3', 'openai-chat', { catalog: catalogue }));
      expect(free?.entry.price).toBeUndefined();
    }
    finally { catalogue.stop(); }
  });

  it('asks the policy on the whole name, once, with the adapter as the entry\'s provider', async () => {
    const asked: ModelEntry[] = [];
    const [one] = routed(await over('openrouter/anthropic/claude-sonnet-5.5', 'openai-chat', {
      allowed: (entry) => { asked.push(entry); return undefined; },
    }));
    expect(one?.connector).toBe('openrouter-main');
    expect(asked).toEqual([{ provider: 'openrouter', id: 'anthropic/claude-sonnet-5.5' }]);
  });

  it('answers 403 with the policy\'s sentence when it refuses the name', async () => {
    const refusal = refused(await over('openrouter/anthropic/claude-sonnet-5.5', 'openai-chat', {
      allowed: () => 'deny-off refuses model openrouter/anthropic/claude-sonnet-5.5',
    }));
    expect(refusal).toEqual({ status: 403, message: 'deny-off refuses model openrouter/anthropic/claude-sonnet-5.5' });
  });

  it('refuses a name whose connector the caller may not use, naming no connector', async () => {
    const providers: ProviderConnector[] = [
      { id: 'mine', adapter: 'openrouter', owner: 'user:ana', provider: { endpoint: 'https://ana.test/v1', accepts: ['openai-chat'], key: MARKER } },
    ];
    const refusal = refused(await route(TABLE, 'openrouter/anything', 'openai-chat', { providers, caller: person('gus') }));
    expect(refusal.status).toBe(503);
    expect(refusal.message).toBe('model openrouter/anything has no connector this caller may use for openrouter');
    expect(JSON.stringify(refusal)).not.toContain('mine');
  });

  it('refuses a fetched name whose connectors are not in this dialect', async () => {
    const refusal = refused(await over('anthropic/claude-haiku-5-5', 'openai-chat'));
    expect(refusal).toEqual({
      status: 404,
      message: 'model anthropic/claude-haiku-5-5 is served in anthropic-messages, not openai-chat: call POST /v1/messages',
      code: 'model_not_found',
    });
  });

  it('still refuses a name with no slash as nobody serves it', async () => {
    const refusal = refused(await over('nothing', 'openai-chat'));
    expect(refusal).toEqual({ status: 404, message: 'model nothing is not served here', code: 'model_not_found' });
  });
});

describe('upstreamUrl', () => {
  it('joins an endpoint and the dialect\'s path with one slash', () => {
    expect(upstreamUrl('https://openrouter.ai/api/v1', 'openai-chat')).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(upstreamUrl('https://openrouter.ai/api/v1/', 'openai-chat')).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(upstreamUrl('https://api.anthropic.com', 'anthropic-messages')).toBe('https://api.anthropic.com/v1/messages');
    expect(upstreamUrl('https://api.anthropic.com/', 'anthropic-messages')).toBe('https://api.anthropic.com/v1/messages');
    expect(upstreamUrl('https://api.anthropic.com//', 'anthropic-messages')).toBe('https://api.anthropic.com/v1/messages');
  });
});
