/*
 * A call is held to the `model` policies, and each answered call is recorded
 * against the caller's pools.
 *
 * The providers are fakes on loopback, the policies and the usage store are in
 * memory, and the people are a users file in a temporary folder.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memoryPolicies, type ModelUse, type Policies, type Policy } from '@ahpd/sdk';
import {
  answerJson, fakeProvider, isAnthropicError, isOpenAiError, MARKER, memoryUsage, pause, people, ROOT_TOKEN, send, serveProxy,
  type FakeProvider, type People, type Served, type ServeOptions,
} from './fixtures/proxy-harness.js';
import type { ProxySetting } from '../src/proxy/providers.js';

let folder: string;
let who: People;
const open: Served[] = [];
const fakes: FakeProvider[] = [];

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'ahpd-proxy-policy-'));
  who = await people(folder);
});

afterEach(async () => {
  for (const one of open.splice(0)) await one.close();
  for (const one of fakes.splice(0)) await one.close();
  rmSync(folder, { recursive: true, force: true });
});

const CHAT = '/v1/chat/completions';
const MESSAGES = '/v1/messages';

/** A store holding these rows. */
const rows = async (...given: Policy[]): Promise<Policies> => {
  const store = memoryPolicies();
  for (const one of given) await store.put(one);
  return store;
};

const ALLOW_ALL: Policy = { id: 'everyone', scope: 'all', kind: 'model', effect: 'allow', match: { model: ['*'] } };
const DENY_OPENAI: Policy = { id: 'no-openai', scope: 'all', kind: 'model', effect: 'deny', match: { model: ['openai/*'] } };
const LOCAL_ONLY: Policy = { id: 'local-only', scope: 'team:backend', kind: 'model', effect: 'allow', match: { proxy: ['local'] } };

/**
 * Softov's table with every provider pointed at fakes: `openrouter` and
 * `anthropic` at `remote`, `local` at `local`, each answering its own dialect.
 */
const softov = (remote: string, local: string): ProxySetting => ({
  providers: {
    openrouter: { endpoint: remote, accepts: ['openai-chat'], key: { env: 'OPENROUTER_API_KEY' } },
    anthropic: { endpoint: remote, accepts: ['anthropic-messages'], key: { env: 'ANTHROPIC_API_KEY' } },
    local: { endpoint: local, accepts: ['openai-chat'] },
  },
  models: {
    'anthropic/claude-sonnet-5-5': [
      { provider: 'anthropic', id: 'claude-sonnet-5-5' },
      { provider: 'openrouter', id: 'anthropic/claude-sonnet-5.5', price: { input: 2, output: 10 } },
    ],
    'openai/gpt-5.5': [{ provider: 'openrouter', id: 'openai/gpt-5.5', price: { input: 5, output: 30 } }],
    'local/default': [{ provider: 'local', id: 'local-model' }],
  },
});

const KEYS = { OPENROUTER_API_KEY: MARKER, ANTHROPIC_API_KEY: MARKER };

/** An OpenAI chat completion reporting usage. */
const COMPLETION = {
  id: 'c', object: 'chat.completion', choices: [],
  usage: { prompt_tokens: 1200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 200 } },
};

/** Two fakes answering a chat completion, and the proxy over them with Softov's table. */
const setup = async (options: ServeOptions = {}) => {
  const remote = await fakeProvider(answerJson(200, COMPLETION));
  const local = await fakeProvider(answerJson(200, COMPLETION));
  fakes.push(remote, local);
  const usage = memoryUsage();
  const served = await serveProxy({ users: who.users, env: KEYS, proxy: softov(remote.endpoint, local.endpoint), usage: () => usage, ...options });
  open.push(served);
  return { remote, local, usage, served };
};

/** The records written, once their writes have settled. */
const settled = async (usage: { entries: unknown[] }, count: number): Promise<ModelUse[]> => {
  const until = Date.now() + 1000;
  while (usage.entries.length < count && Date.now() < until) await pause(10);
  await pause(20);
  return usage.entries as ModelUse[];
};

describe('a policy decides the model', () => {
  it('refuses a call a deny row names, naming the row, without touching a provider', async () => {
    const { served, remote } = await setup({ policies: await rows(ALLOW_ALL, DENY_OPENAI), policiesCheck: true });
    const got = await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5' } });
    expect(got.status).toBe(403);
    expect(isOpenAiError(got.json)).toBe(true);
    expect(got.json).toMatchObject({ error: { type: 'permission_error', message: 'no-openai refuses model openai/gpt-5.5 through proxy openrouter' } });
    expect(remote.received).toEqual([]);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default' } })).status).toBe(200);
  });

  it('goes only through a provider a row allows, and says no policy allows the rest', async () => {
    const { served, local, remote } = await setup({ policies: await rows(LOCAL_ONLY), policiesCheck: true });
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default' } })).status).toBe(200);
    expect(local.received).toHaveLength(1);
    const refused = await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5' } });
    expect(refused.status).toBe(403);
    expect(refused.json).toMatchObject({ error: { message: 'no policy allows model openai/gpt-5.5 through proxy openrouter' } });
    const messages = await send(served.port, MESSAGES, { headers: { 'x-api-key': who.ana }, body: { model: 'anthropic/claude-sonnet-5-5' } });
    expect(messages.status).toBe(403);
    expect(isAnthropicError(messages.json)).toBe(true);
    expect(remote.received).toEqual([]);
  });

  it('does not check root, nor anybody with the checks off', async () => {
    const strict = await setup({ policies: await rows(DENY_OPENAI), policiesCheck: true });
    expect((await send(strict.served.port, CHAT, { headers: { authorization: `Bearer ${ROOT_TOKEN}` }, body: { model: 'openai/gpt-5.5' } })).status).toBe(200);
    const off = await setup({ policies: await rows(DENY_OPENAI), policiesCheck: false });
    expect((await send(off.served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5' } })).status).toBe(200);
  });

  it('refuses when the store cannot be read', async () => {
    const broken: Policies = { ...memoryPolicies(), list: async () => { throw new Error('the store is unreadable'); } };
    const { served, remote } = await setup({ policies: broken, policiesCheck: true });
    const got = await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default' } });
    expect(got.status).toBe(403);
    expect(got.json).toMatchObject({ error: { message: 'no policy could be read, so model is refused: the store is unreadable' } });
    expect(remote.received).toEqual([]);
  });
});

describe('the call is recorded', () => {
  it('writes one record for a JSON answer, with the tokens, the price cost and the person\'s pools', async () => {
    const { served, usage } = await setup();
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5' } })).status).toBe(200);
    const [entry, ...more] = await settled(usage, 1);
    expect(more).toEqual([]);
    expect(entry).toMatchObject({
      kind: 'model',
      source: 'proxy',
      owner: 'user:ana',
      team: 'backend',
      project: 'billing',
      model: { name: 'openai/gpt-5.5', provider: 'openrouter', input: 1000, output: 300, cache: { read: 200 } },
      pools: ['user:ana', 'team:backend', 'project:backend:billing'],
    });
    // (1000 + 200) * $5 + 300 * $30, per million.
    expect(entry?.cost?.currency).toBe('usd');
    expect(entry?.cost?.from).toBe('price');
    expect(entry?.cost?.amount).toBeCloseTo((1200 * 5 + 300 * 30) / 1_000_000, 12);
    expect(Date.parse(entry?.at ?? '')).not.toBeNaN();
    expect(entry?.session).toBeUndefined();
    expect(JSON.stringify(entry)).not.toContain(MARKER);
  });

  it('writes one record for an Anthropic stream, from message_start and the last message_delta', async () => {
    const remote = await fakeProvider((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":40,"cache_read_input_tokens":7,"cache_creation_input_tokens":3,"output_tokens":1}}}\n\n');
      response.write('event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n');
      response.write('event: message_delta\r\ndata: {"type":"message_delta","usage":{"output_tokens":9}}\r\n\r\n');
      response.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    });
    fakes.push(remote);
    const usage = memoryUsage();
    const served = await serveProxy({ users: who.users, env: KEYS, proxy: softov(remote.endpoint, remote.endpoint), usage: () => usage });
    open.push(served);
    await send(served.port, MESSAGES, { headers: { 'x-api-key': who.ana, 'x-ahp-scope': 'backend:ahpd' }, body: { model: 'anthropic/claude-sonnet-5-5', stream: true } });
    const [entry] = await settled(usage, 1);
    expect(entry?.model).toEqual({ name: 'anthropic/claude-sonnet-5-5', provider: 'anthropic', input: 40, output: 9, cache: { read: 7, write: 3 } });
    expect(entry?.project).toBe('ahpd');
    // The anthropic entry has no price.
    expect(entry?.cost).toBeUndefined();
  });

  it('writes one record with no tokens for an OpenAI stream that did not ask for usage', async () => {
    const remote = await fakeProvider((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n');
    });
    fakes.push(remote);
    const usage = memoryUsage();
    const served = await serveProxy({ users: who.users, env: KEYS, proxy: softov(remote.endpoint, remote.endpoint), usage: () => usage });
    open.push(served);
    await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5', stream: true } });
    const entries = await settled(usage, 1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.model).toEqual({ name: 'openai/gpt-5.5', provider: 'openrouter' });
    expect(entries[0]?.cost).toBeUndefined();
    // Nothing was injected to ask for it.
    expect(JSON.parse(remote.received[0]?.body ?? '')).toEqual({ model: 'openai/gpt-5.5', stream: true });
  });

  it('writes one record with what was read when the stream is cut', async () => {
    const remote = await fakeProvider((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1}}}\n\n', () => {
        setTimeout(() => { response.destroy(); }, 20);
      });
    });
    fakes.push(remote);
    const usage = memoryUsage();
    const served = await serveProxy({ users: who.users, env: KEYS, proxy: softov(remote.endpoint, remote.endpoint), usage: () => usage });
    open.push(served);
    // The caller's connection is cut too, so the request fails rather than ending.
    await expect(send(served.port, MESSAGES, { headers: { 'x-api-key': who.ana }, body: { model: 'anthropic/claude-sonnet-5-5', stream: true } }))
      .rejects.toThrow(/aborted|ECONNRESET/u);
    const entries = await settled(usage, 1);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.model).toMatchObject({ input: 12, output: 1 });
  });

  it('charges root to root:<host>', async () => {
    const { served, usage } = await setup();
    await send(served.port, CHAT, { headers: { authorization: `Bearer ${ROOT_TOKEN}` }, body: { model: 'local/default' } });
    const [entry] = await settled(usage, 1);
    expect(entry?.owner).toBe('root:testbox');
    expect(entry?.pools).toEqual(['root:testbox']);
  });

  it('keeps answering when the store fails, and says so in the log', async () => {
    const remote = await fakeProvider(answerJson(200, COMPLETION));
    fakes.push(remote);
    const served = await serveProxy({
      users: who.users, env: KEYS, proxy: softov(remote.endpoint, remote.endpoint),
      usage: () => ({ ...memoryUsage(), record: async () => { throw new Error('disk full'); } }),
    });
    open.push(served);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5' } })).status).toBe(200);
    await pause(30);
    expect(served.log.join('\n')).toContain('proxy: could not keep the record of a call to openai/gpt-5.5: disk full');
  });
});

describe('a session\'s call', () => {
  /** A `whose` answering `session-token` as a session Ana runs, in backend:billing. */
  const session = async () => {
    const ana = await who.users.verify(who.ana);
    if (ana === undefined) throw new Error('ana is not verified');
    return (token: string) => (token === 'session-token'
      ? { session: 's-1', chat: 'c-1', turn: 't-7', owner: 'user:ana' as const, principal: ana, scope: { team: 'backend', project: 'billing' } }
      : undefined);
  };

  it('is checked and recorded with its session, chat and turn when sessionCalls is record, or absent', async () => {
    for (const sessionCalls of ['record', undefined] as const) {
      const remote = await fakeProvider(answerJson(200, COMPLETION));
      fakes.push(remote);
      const usage = memoryUsage();
      const table: ProxySetting = { ...softov(remote.endpoint, remote.endpoint), ...(sessionCalls === undefined ? {} : { sessionCalls }) };
      const served = await serveProxy({
        users: who.users, env: KEYS, proxy: table, usage: () => usage,
        whose: await session(), policies: await rows(ALLOW_ALL, DENY_OPENAI), policiesCheck: true,
      });
      open.push(served);
      const denied = await send(served.port, CHAT, { headers: { 'x-api-key': 'session-token' }, body: { model: 'openai/gpt-5.5' } });
      expect(denied.status).toBe(403);
      expect(denied.json).toMatchObject({ error: { message: 'no-openai refuses model openai/gpt-5.5 through proxy openrouter' } });

      expect((await send(served.port, CHAT, { headers: { 'x-api-key': 'session-token' }, body: { model: 'local/default' } })).status).toBe(200);
      const [entry, ...more] = await settled(usage, 1);
      expect(more).toEqual([]);
      expect(entry).toMatchObject({
        source: 'proxy', session: 's-1', chat: 'c-1', turn: 't-7', owner: 'user:ana', team: 'backend', project: 'billing',
        pools: ['user:ana', 'team:backend', 'project:backend:billing'],
      });
    }
  });

  it('is neither checked nor recorded when sessionCalls is skip', async () => {
    const remote = await fakeProvider(answerJson(200, COMPLETION));
    fakes.push(remote);
    const usage = memoryUsage();
    const served = await serveProxy({
      users: who.users, env: KEYS, proxy: { ...softov(remote.endpoint, remote.endpoint), sessionCalls: 'skip' }, usage: () => usage,
      whose: await session(), policies: await rows(ALLOW_ALL, DENY_OPENAI), policiesCheck: true,
    });
    open.push(served);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': 'session-token' }, body: { model: 'openai/gpt-5.5' } })).status).toBe(200);
    await pause(50);
    expect(usage.entries).toEqual([]);
    // A person is still checked and recorded.
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'openai/gpt-5.5' } })).status).toBe(403);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: { model: 'local/default' } })).status).toBe(200);
    expect(await settled(usage, 1)).toHaveLength(1);
  });

  it('is not checked when whose names nobody, as on a host with no directory, and is still recorded', async () => {
    const remote = await fakeProvider(answerJson(200, COMPLETION));
    fakes.push(remote);
    const usage = memoryUsage();
    const served = await serveProxy({
      env: KEYS, proxy: softov(remote.endpoint, remote.endpoint), usage: () => usage,
      whose: (token) => (token === 'session-token' ? { session: 's-2' } : undefined),
      policies: await rows(DENY_OPENAI), policiesCheck: true,
    });
    open.push(served);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': 'session-token' }, body: { model: 'openai/gpt-5.5' } })).status).toBe(200);
    const [entry] = await settled(usage, 1);
    expect(entry).toMatchObject({ session: 's-2', pools: [] });
    expect(entry?.owner).toBeUndefined();
  });
});
