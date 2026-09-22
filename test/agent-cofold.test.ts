import { expect, it } from 'vitest';
import type { ModelAdapter } from '@cofold/agents';
import { cofoldAgent, modelOf, resourceOf, storeOf } from '../packages/agent-cofold/src/index.js';

/*
 * The backend's identity, before a session exists.
 *
 * Nothing here calls a model and nothing here runs a turn: this is the
 * provider, the schema a client fills in, the defaults, the model factory and
 * the store, which is the half a session is built on top of.
 */

const properties = (agent: ReturnType<typeof cofoldAgent>): Record<string, unknown> =>
  (agent.schema() as { properties: Record<string, unknown> }).properties;

it('answers provider cofold with the settings a session may carry', () => {
  const agent = cofoldAgent({});
  expect(agent.provider).toBe('cofold');
  expect(agent.displayName).toBe('Cofold');
  // No key: a bearer token is a credential, and the protocol's path for one is
  // `authenticate` against the protected resource below, not session config.
  // The mode and the effort are the two controls a window draws, and the cases
  // for what each one means are `agent-cofold-modes.test.ts`.
  expect(Object.keys(properties(agent))).toEqual(['model', 'baseUrl', 'instructions', 'permissionMode', 'effortLevel']);
});

it('advertises the resource a client may lend a token for', () => {
  const agent = cofoldAgent({ baseUrl: 'https://api.deepseek.com/v1' });
  expect(agent.protectedResources).toEqual([
    { resource: 'https://api.deepseek.com', resource_name: 'Cofold', required: false },
  ]);
});

it('names the resource after the endpoint only when that is an https URL', () => {
  expect(resourceOf({ baseUrl: 'https://api.deepseek.com/v1' })).toBe('https://api.deepseek.com');
  expect(resourceOf({ baseUrl: 'http://127.0.0.1:1234/v1' })).toBe('https://ahpd.dev/agent-cofold');
  expect(resourceOf({ resource: 'https://models.example' })).toBe('https://models.example');
});

it('defaults name only keys the schema declares', () => {
  const agent = cofoldAgent({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' });
  expect(agent.defaults()).toEqual({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' });
  for (const key of Object.keys(agent.defaults())) {
    expect(properties(agent)).toHaveProperty(key);
  }
});

it('gives a second registration its own provider', () => {
  expect(cofoldAgent({ provider: 'other', displayName: 'Other' })).toMatchObject({ provider: 'other', displayName: 'Other' });
});

it('offers the configured model and no commands', async () => {
  // An adapter, so the case is about the configured model standing in rather
  // than about whatever endpoint this machine happens to have running; the
  // catalogue an endpoint serves is `agent-cofold-models.test.ts`.
  const stub = { id: 'stub', modelId: 'stub', features: {} } as unknown as ModelAdapter;
  const offered = await cofoldAgent({ adapter: stub, model: 'deepseek-chat' }).probe?.();
  expect(offered?.models).toEqual([{ id: 'deepseek-chat', name: 'deepseek-chat' }]);
  expect(offered?.commands).toEqual([]);
});

it('builds an OpenAI-compatible adapter for the chosen model', () => {
  expect(modelOf({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }).modelId).toBe('deepseek-chat');
  // A session setting wins over the package's own default.
  expect(modelOf({ model: 'falls-back' }, { model: 'chosen' }).modelId).toBe('chosen');
});

it('uses a caller-passed adapter instead of building one', () => {
  const stub = { id: 'stub', modelId: 'stub', features: {} } as unknown as ModelAdapter;
  expect(modelOf({ adapter: stub, model: 'ignored' })).toBe(stub);
});

it('sends the token a client lent, and the daemon key when nobody did', async () => {
  const real = globalThis.fetch;
  const seen: (string | null | undefined)[] = [];
  globalThis.fetch = (async (_input: unknown, init?: { headers?: Record<string, string> }) => {
    seen.push(init?.headers?.authorization);
    return new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  try {
    const request = { instructions: 'x', messages: [], tools: [] } as never;
    await modelOf({ baseUrl: 'https://models.example/v1', model: 'm' }, {}, { 'https://models.example': 'lent' }).complete(request);
    await modelOf({ baseUrl: 'https://models.example/v1', model: 'm', apiKey: 'daemon' }).complete(request);
  }
  finally {
    globalThis.fetch = real;
  }
  expect(seen).toEqual(['Bearer lent', 'Bearer daemon']);
});

it('refuses a model nobody chose and no default covers', () => {
  // An explicit empty harness, so the case does not depend on whether the
  // machine running the suite has a cofold configuration of its own.
  expect(() => modelOf({}, {}, {}, { providers: [], path: 'test' })).toThrow(/no model|names none/);
});

it('builds a store that can hold a session', () => {
  expect(typeof storeOf({ memory: true }).sessions.create).toBe('function');
});
