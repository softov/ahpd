import { expect, it } from 'vitest';
import { modelsProblem, offeredModels, ownModels } from '../src/models.js';

/*
 * The models a Claude harness offers when its operator names them: written by
 * id, or fetched from an endpoint's model list and filtered, in place of the
 * CLI's list or added to it.
 */

const CLI = [{ id: 'default', name: 'Default' }, { id: 'opus', name: 'Opus' }];

/** An endpoint answering an OpenAI-shaped model list, and the requests it saw. */
const endpoint = (data: unknown[], status = 200) => {
  const seen: { url: string; auth?: string }[] = [];
  const get = (async (url: string, init?: { headers?: Record<string, string> }) => {
    seen.push({ url, ...(init?.headers?.authorization === undefined ? {} : { auth: init.headers.authorization }) });
    return new Response(JSON.stringify({ data }), { status });
  }) as unknown as typeof fetch;
  return { get, seen };
};

it('offers written ids and named models, each once, in order', async () => {
  expect(await ownModels(['stealth/space-bunny-alpha', { id: 'anthropic/fable-5', name: 'Fable 5' }, 'stealth/space-bunny-alpha']))
    .toEqual([{ id: 'stealth/space-bunny-alpha', name: 'stealth/space-bunny-alpha' }, { id: 'anthropic/fable-5', name: 'Fable 5' }]);
});

it('fetches an endpoint list and keeps the ids its pattern covers, with the key from the daemon', async () => {
  process.env.AHPD_MODELS_KEY = 'sk-test';
  const { get, seen } = endpoint([
    { id: 'stealth/space-bunny-alpha', name: 'Space Bunny' },
    { id: 'anthropic/fable-5' },
    { id: 'openai/gpt-5' },
  ]);
  const models = await ownModels([{ fetch: 'https://models.test/v1/models', match: 'stealth/*', key: { fromEnv: 'AHPD_MODELS_KEY' } }], () => {}, get);
  delete process.env.AHPD_MODELS_KEY;
  expect(models).toEqual([{ id: 'stealth/space-bunny-alpha', name: 'Space Bunny' }]);
  expect(seen).toEqual([{ url: 'https://models.test/v1/models', auth: 'Bearer sk-test' }]);
  // No pattern keeps every model, named by its id when the endpoint gives no name.
  expect((await ownModels([{ fetch: 'https://models.test/v1/models' }], () => {}, get)).map((one) => one.name))
    .toEqual(['Space Bunny', 'anthropic/fable-5', 'openai/gpt-5']);
});

it('says so and offers the written models when a fetch fails', async () => {
  const said: string[] = [];
  const { get } = endpoint([], 503);
  const models = await ownModels(['anthropic/fable-5', { fetch: 'https://models.test/v1/models' }], (line) => said.push(line), get);
  expect(models).toEqual([{ id: 'anthropic/fable-5', name: 'anthropic/fable-5' }]);
  expect(said).toEqual(['models from https://models.test/v1/models could not be read: HTTP 503']);
});

it('replaces the CLI list, adds to it with keepCliModels, and is the CLI list without models', () => {
  const own = [{ id: 'stealth/space-bunny-alpha', name: 'Space Bunny' }, { id: 'opus', name: 'Opus again' }];
  expect(offeredModels(CLI, undefined, undefined)).toEqual(CLI);
  expect(offeredModels(CLI, own, undefined)).toEqual(own);
  expect(offeredModels(CLI, own, true)).toEqual([...CLI, { id: 'stealth/space-bunny-alpha', name: 'Space Bunny' }]);
});

it('names what is wrong with a models option', () => {
  expect(modelsProblem(undefined)).toBeUndefined();
  expect(modelsProblem(['a/b', { id: 'c/d', name: 'D' }, { fetch: 'https://x', match: 'a/*', key: { fromEnv: 'K' } }])).toBeUndefined();
  expect(modelsProblem('a/b')).toBe('options.models is not a list');
  expect(modelsProblem([''])).toBe('options.models[0] is an empty id');
  expect(modelsProblem([{ name: 'x' }])).toBe('options.models[0] has neither an id nor a fetch');
  expect(modelsProblem([{ fetch: 'https://x', key: 'K' }])).toBe('options.models[0].key is not { fromEnv }');
});
