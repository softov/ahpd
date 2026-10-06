/*
 * Which provider a model name is called on.
 *
 * `route` is a function of the table, the caller's dialect, a policy and the
 * environment, so it is checked here without a listener: Softov's own table is
 * the fixture, and the environment is a plain object so no real key is read.
 */

import { describe, expect, it } from 'vitest';
import { proxyConfiguration } from '../src/proxy/providers.js';
import { route, upstreamUrl, type Routed } from '../src/proxy/route.js';

/** A key nobody has, so a refusal or a log that held it is found by looking for it. */
const MARKER = 'sk-marker-0f9e8d7c6b5a';

/** Softov's configuration's `proxy` key, as it was on 2026-10-06. */
const TABLE = proxyConfiguration({
  providers: { local: { endpoint: 'http://127.0.0.1:1234/v1', accepts: ['openai-chat'] } },
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

/** Every key set, to the marker. */
const KEYS = { OPENROUTER_API_KEY: MARKER, ANTHROPIC_API_KEY: MARKER, OPENAI_API_KEY: MARKER };

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

describe('route', () => {
  it('sends a name to the first entry that takes the caller\'s dialect, under that provider\'s id', async () => {
    const openai = routed(await route(TABLE, 'anthropic/claude-sonnet-5-5', 'openai-chat', { env: KEYS }));
    expect(openai.map((one) => [one.provider, one.entry.id])).toEqual([['openrouter', 'anthropic/claude-sonnet-5.5']]);
    expect(openai[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(openai[0]?.key).toBe(MARKER);

    const anthropic = routed(await route(TABLE, 'anthropic/claude-sonnet-5-5', 'anthropic-messages', { env: KEYS }));
    expect(anthropic.map((one) => [one.provider, one.entry.id])).toEqual([['anthropic', 'claude-sonnet-5-5']]);
    expect(anthropic[0]?.url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('calls a provider that has no key with none', async () => {
    const [local] = routed(await route(TABLE, 'local/default', 'openai-chat', { env: {} }));
    expect(local?.provider).toBe('local');
    expect(local?.entry.id).toBe('local-model');
    expect(local?.url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect(local?.key).toBeUndefined();
  });

  it('keeps every candidate in the file\'s order, for the fallback', async () => {
    const table = proxyConfiguration({
      providers: { second: { endpoint: 'http://127.0.0.1:9/v1', accepts: ['openai-chat'] } },
      models: { 'maker/model': [{ provider: 'openrouter', id: 'one' }, { provider: 'anthropic', id: 'skipped' }, { provider: 'second', id: 'two' }] },
    });
    const candidates = routed(await route(table, 'maker/model', 'openai-chat', { env: KEYS }));
    expect(candidates.map((one) => one.provider)).toEqual(['openrouter', 'second']);
  });

  it('refuses a name nobody serves without reading anything else', async () => {
    const refusal = refused(await route(TABLE, 'nobody/nothing', 'openai-chat', {
      env: KEYS,
      allowed: () => { throw new Error('the policy was asked'); },
    }));
    expect(refusal).toEqual({ status: 404, message: 'model nobody/nothing is not served here', code: 'model_not_found' });
  });

  it('refuses a name served only in the other dialect, naming where to call it', async () => {
    const refusal = refused(await route(TABLE, 'openai/gpt-5.5', 'anthropic-messages', { env: KEYS }));
    expect(refusal.status).toBe(404);
    expect(refusal.code).toBe('model_not_found');
    expect(refusal.message).toBe('model openai/gpt-5.5 is served in openai-chat, not anthropic-messages: call POST /v1/chat/completions');
  });

  it('passes over a provider whose key is unset, and names each one and its variable when none is left', async () => {
    const refusal = refused(await route(TABLE, 'anthropic/claude-opus-5-5', 'anthropic-messages', { env: { OPENROUTER_API_KEY: MARKER } }));
    expect(refusal.status).toBe(503);
    expect(refusal.message).toBe('model anthropic/claude-opus-5-5 has no provider with its key set: anthropic needs ANTHROPIC_API_KEY');
    expect(JSON.stringify(refusal)).not.toContain(MARKER);

    // The next entry takes it when the first has no key.
    const table = proxyConfiguration({ models: { 'm/x': [{ provider: 'openai', id: 'a' }, { provider: 'openrouter', id: 'b' }] } });
    const [only] = routed(await route(table, 'm/x', 'openai-chat', { env: { OPENROUTER_API_KEY: MARKER } }));
    expect(only?.provider).toBe('openrouter');
  });

  it('reads an empty key as one that is set, as proxy list does', async () => {
    const [one] = routed(await route(TABLE, 'openai/gpt-5.5', 'openai-chat', { env: { OPENROUTER_API_KEY: '' } }));
    expect(one?.provider).toBe('openrouter');
  });

  it('passes over an entry the policy refuses, and answers the first refusal when none is left', async () => {
    const refusal = refused(await route(TABLE, 'openai/gpt-5.5', 'openai-chat', {
      env: KEYS,
      allowed: (entry) => `deny-openai refuses model openai/gpt-5.5 through ${entry.provider}`,
    }));
    expect(refusal).toEqual({ status: 403, message: 'deny-openai refuses model openai/gpt-5.5 through openrouter' });

    const table = proxyConfiguration({ models: { 'm/x': [{ provider: 'openai', id: 'a' }, { provider: 'openrouter', id: 'b' }] } });
    const [kept] = routed(await route(table, 'm/x', 'openai-chat', {
      env: KEYS,
      allowed: async (entry) => (entry.provider === 'openai' ? 'no' : undefined),
    }));
    expect(kept?.provider).toBe('openrouter');
  });

  it('asks the policy before the key, so a refused entry is a 403 whatever its key', async () => {
    const refusal = refused(await route(TABLE, 'openai/gpt-5.5', 'openai-chat', { env: {}, allowed: () => 'refused' }));
    expect(refusal.status).toBe(403);
  });

  it('passes over an entry whose provider is not in the table', async () => {
    const table = { providers: {}, models: { 'm/x': [{ provider: 'gone', id: 'a' }] }, sessionCalls: 'record' as const };
    expect(refused(await route(table, 'm/x', 'openai-chat', { env: KEYS })).status).toBe(404);
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
