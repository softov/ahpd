import { expect, it } from 'vitest';
import type { ModelAdapter } from '@facio/agents';
import { facioAgent, modelOf, storeOf } from '../packages/agent-facio/src/index.js';

/*
 * The backend's identity, before a session exists.
 *
 * Nothing here calls a model and nothing here runs a turn: this is the
 * provider, the schema a client fills in, the defaults, the model factory and
 * the store, which is the half a session is built on top of.
 */

const properties = (agent: ReturnType<typeof facioAgent>): Record<string, unknown> =>
  (agent.schema() as { properties: Record<string, unknown> }).properties;

it('answers provider facio with the settings a session may carry', () => {
  const agent = facioAgent({});
  expect(agent.provider).toBe('facio');
  expect(agent.displayName).toBe('Facio');
  expect(Object.keys(properties(agent))).toEqual(['model', 'baseUrl', 'apiKey', 'instructions']);
});

it('defaults name only keys the schema declares', () => {
  const agent = facioAgent({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' });
  expect(agent.defaults()).toEqual({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' });
  for (const key of Object.keys(agent.defaults())) {
    expect(properties(agent)).toHaveProperty(key);
  }
});

it('gives a second registration its own provider', () => {
  expect(facioAgent({ provider: 'other', displayName: 'Other' })).toMatchObject({ provider: 'other', displayName: 'Other' });
});

it('offers the configured model and no commands', async () => {
  const offered = await facioAgent({ model: 'deepseek-chat' }).probe?.();
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

it('refuses a model nobody chose and no default covers', () => {
  expect(() => modelOf({})).toThrow(/no model/);
});

it('builds a store that can hold a session', () => {
  expect(typeof storeOf({ memory: true }).sessions.create).toBe('function');
});
