import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { WAIT_MS } from '../../../tools/wait.ts';
import type { AgentView, Bag, Engine, PluginHost } from '../../sdk/src/types/index.js';
import { openPi } from '../src/backend.js';
import { apply } from '../src/plugin.js';
import { opened, root } from './fake-pi.js';

/*
 * A pi agent on an OpenAI-compatible endpoint of its own.
 *
 * pi's own providers come from `auth.json` and `models.json`, which a record
 * cannot write. The endpoint here is a real listener: the record's `baseUrl`
 * and `apiKey` register a provider on the session's runtime, and the turn's
 * request reaching that listener is what says the registration is the one the
 * turn runs on.
 */

/** One request the stub endpoint saw. */
interface Seen {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** The listeners this file bound, so each port is given back. */
const listening: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of listening.splice(0)) await stop();
});

/** The run's zero-delay work finishing, up to a point. */
const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  throw new Error(`still waiting after ${ms} ms`);
};

/**
 * A listener that answers like an OpenAI-compatible endpoint: a model list at
 * `/v1/models`, and one streamed answer at `/v1/chat/completions`.
 *
 * `models` is what the list holds, and `failModels` makes it answer a server
 * error instead, as an endpoint whose catalogue cannot be read does.
 */
const serveEndpoint = async (
  models: string[] = ['test-model'],
  failModels = false,
): Promise<{ baseUrl: string; requests: Seen[] }> => {
  const requests: Seen[] = [];
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const path = incoming.url ?? '/';
      requests.push({
        method: incoming.method ?? 'GET',
        path,
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      if (path === '/v1/models') {
        if (failModels) {
          outgoing.writeHead(500, { 'content-type': 'application/json' });
          outgoing.end('{"error":{"message":"no catalogue"}}');
          return;
        }
        outgoing.writeHead(200, { 'content-type': 'application/json' });
        outgoing.end(JSON.stringify({ object: 'list', data: models.map((id) => ({ id, object: 'model' })) }));
        return;
      }
      if (path === '/v1/chat/completions') {
        outgoing.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const created = Date.now();
        const chunk = (choices: unknown[]): string => `data: ${JSON.stringify({
          id: 'chatcmpl-1', object: 'chat.completion.chunk', created, model: models[0] ?? 'test-model', choices,
        })}\n\n`;
        outgoing.write(chunk([{ index: 0, delta: { role: 'assistant', content: 'hello' }, finish_reason: null }]));
        outgoing.write(chunk([{ index: 0, delta: {}, finish_reason: 'stop' }]));
        outgoing.end('data: [DONE]\n\n');
        return;
      }
      outgoing.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  listening.push(() => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }));
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests };
};

/** The `pi` engine a load registers, for the probe cases. */
const engineWith = (): Engine => {
  const engines: Record<string, Engine> = {};
  const host = {
    paths: [root],
    registerEngine: (engine: Engine) => { engines[engine.name] = engine; },
  } as unknown as PluginHost;
  apply(host, {});
  const engine = engines['pi'];
  if (engine === undefined) throw new Error('no pi engine was registered');
  return engine;
};

/** One record of the engine, with a configuration a case may change. */
const recordOf = (held: () => Bag): AgentView => ({
  id: 'endpoint',
  engine: 'pi',
  owner: 'host',
  name: 'endpoint',
  description: undefined,
  icon: undefined,
  model: 'endpoint/test-model',
  get config() { return held(); },
});

it("answers a turn on the record's endpoint with the record's key", async () => {
  const endpoint = await serveEndpoint();
  const { session, types } = opened({}, {
    provider: 'endpoint',
    baseUrl: endpoint.baseUrl,
    apiKey: 'test-key',
    model: 'endpoint/test-model',
  }, openPi);
  try {
    session.sendMessage('t1', 'hello');
    await until(() => types().includes('chat/turnComplete'), 20_000);
    expect(types()).toContain('chat/turnComplete');

    const call = endpoint.requests.find((one) => one.path === '/v1/chat/completions');
    expect(call).toBeDefined();
    expect(call?.headers.authorization).toBe('Bearer test-key');
    expect(JSON.parse(call?.body ?? '{}')).toMatchObject({ model: 'test-model' });
  }
  finally {
    await session.close();
  }
});

it('answers a turn on a keyless endpoint without an Authorization header', async () => {
  const endpoint = await serveEndpoint(['keyless-model']);
  const { session, types } = opened({}, {
    provider: 'endpoint',
    baseUrl: endpoint.baseUrl,
    model: 'endpoint/keyless-model',
  }, openPi);
  try {
    session.sendMessage('t1', 'hello');
    await until(() => types().includes('chat/turnComplete'), 20_000);
    expect(types()).toContain('chat/turnComplete');

    const call = endpoint.requests.find((one) => one.path === '/v1/chat/completions');
    expect(call).toBeDefined();
    expect(call?.headers.authorization).toBeUndefined();
    expect(JSON.parse(call?.body ?? '{}')).toMatchObject({ model: 'keyless-model' });
  }
  finally {
    await session.close();
  }
});

it("replaces pi's own provider of the same name for this session", async () => {
  const endpoint = await serveEndpoint();
  const { session, types } = opened({}, {
    provider: 'openai',
    baseUrl: endpoint.baseUrl,
    apiKey: 'test-key',
    model: 'openai/test-model',
  }, openPi);
  try {
    session.sendMessage('t1', 'hello');
    await until(() => types().includes('chat/turnComplete'), 20_000);
    expect(types()).toContain('chat/turnComplete');

    const call = endpoint.requests.find((one) => one.path === '/v1/chat/completions');
    expect(call?.headers.authorization).toBe('Bearer test-key');
    expect(JSON.parse(call?.body ?? '{}')).toMatchObject({ model: 'test-model' });
  }
  finally {
    await session.close();
  }
});

it('makes no request to the endpoint for a record with no baseUrl', async () => {
  const endpoint = await serveEndpoint();
  const backend = await openPi({ cwd: root, provider: 'plain' });
  try {
    const found = await backend.models();
    expect(found.map((model) => `${model.provider}/${model.id}`)).not.toContain('endpoint/test-model');
  }
  finally {
    backend.dispose();
  }
  expect(endpoint.requests).toEqual([]);
});

it("lists the record's endpoint models in its probe, under the record's id", async () => {
  const endpoint = await serveEndpoint(['probe-model']);
  const agent = engineWith().open(recordOf(() => ({ baseUrl: endpoint.baseUrl, apiKey: 'probe-key' })));

  const offered = await agent.probe!();
  expect(offered.models.map((model) => model.id)).toContain('endpoint/probe-model');

  // The listing is the endpoint's own, and the record's key is what it carried.
  const listing = endpoint.requests.find((one) => one.path === '/v1/models');
  expect(listing?.headers.authorization).toBe('Bearer probe-key');
});

it("lists a keyless endpoint's models in its probe, sending no Authorization header", async () => {
  const endpoint = await serveEndpoint(['keyless-model']);
  const agent = engineWith().open(recordOf(() => ({ baseUrl: endpoint.baseUrl })));

  const offered = await agent.probe!();
  expect(offered.models.map((model) => model.id)).toContain('endpoint/keyless-model');

  const listing = endpoint.requests.find((one) => one.path === '/v1/models');
  expect(listing?.headers.authorization).toBeUndefined();
});

it("lists the new endpoint's models at the next probe after an edit of baseUrl", async () => {
  const first = await serveEndpoint(['first-model']);
  const second = await serveEndpoint(['second-model']);
  let held: Bag = { baseUrl: first.baseUrl, apiKey: 'first-key' };
  const agent = engineWith().open(recordOf(() => held));

  expect((await agent.probe!()).models.map((model) => model.id)).toContain('endpoint/first-model');

  held = { baseUrl: second.baseUrl, apiKey: 'second-key' };
  const offered = await agent.probe!();
  expect(offered.models.map((model) => model.id)).toContain('endpoint/second-model');
  expect(offered.models.map((model) => model.id)).not.toContain('endpoint/first-model');
  expect(second.requests.find((one) => one.path === '/v1/models')?.headers.authorization).toBe('Bearer second-key');
});

it('answers no endpoint models and no error when the listing fails', async () => {
  const endpoint = await serveEndpoint(['unreachable-model'], true);
  const agent = engineWith().open(recordOf(() => ({ baseUrl: endpoint.baseUrl, apiKey: 'probe-key' })));

  const offered = await agent.probe!();
  expect(offered.models.map((model) => model.id)).not.toContain('endpoint/unreachable-model');
});
