/*
 * A routed call: what goes upstream, what comes back, and how it ends.
 *
 * The provider is a fake on loopback that records what it was sent and
 * answers as each case needs, JSON or an SSE stream written in steps. The key
 * is a marker value, so a log, a refusal or an answer that held it is found by
 * looking for it.
 */

import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  answerJson, fakeProvider, isAnthropicError, isOpenAiError, MARKER, pause, ROOT_TOKEN, send, serveProxy,
  type FakeAnswer, type FakeProvider, type Served, type ServeOptions,
} from './fixtures/proxy-harness.js';

const open: Served[] = [];
const fakes: FakeProvider[] = [];

afterEach(async () => {
  for (const one of open.splice(0)) await one.close();
  for (const one of fakes.splice(0)) await one.close();
});

const fake = async (answer: FakeAnswer): Promise<FakeProvider> => {
  const one = await fakeProvider(answer);
  fakes.push(one);
  return one;
};

const proxy = async (options: ServeOptions): Promise<Served> => {
  const served = await serveProxy(options);
  open.push(served);
  return served;
};

type Dialect = 'openai-chat' | 'anthropic-messages';

/** A table of one name, `m/x`, served by each endpoint in turn, every provider keyed by the marker. */
const table = (dialect: Dialect, ...endpoints: string[]) => ({
  providers: Object.fromEntries(endpoints.map((endpoint, index) => [
    `p${String(index)}`,
    { endpoint, accepts: [dialect], key: { env: `P${String(index)}_KEY` } },
  ])),
  models: { 'm/x': endpoints.map((_endpoint, index) => ({ provider: `p${String(index)}`, id: `id-${String(index)}` })) },
});

/** Every provider's key set to the marker. */
const keys = (count: number): Record<string, string> =>
  Object.fromEntries(Array.from({ length: count }, (_value, index) => [`P${String(index)}_KEY`, MARKER]));

const CHAT = '/v1/chat/completions';
const MESSAGES = '/v1/messages';
const asRoot = { authorization: `Bearer ${ROOT_TOKEN}` };

/** An SSE event as a provider writes it. */
const event = (name: string, data: unknown): string => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/** A streamed answer read chunk by chunk, with the request held so the test can hang up. */
interface Streaming {
  request: ClientRequest;
  response: IncomingMessage;
  /** The next chunk, or `undefined` once the answer has ended. */
  next(): Promise<string | undefined>;
  /** Everything still to come, once it has ended. */
  rest(): Promise<string>;
}

/** A call whose answer is read as it arrives. */
const streaming = (port: number, path: string, headers: Record<string, string>, body: unknown): Promise<Streaming> =>
  new Promise((resolve, reject) => {
    const request = httpRequest({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: { host: `127.0.0.1:${String(port)}`, 'content-type': 'application/json', ...headers },
    }, (response) => {
      const queue: (string | undefined)[] = [];
      const waiting: ((value: string | undefined) => void)[] = [];
      const push = (value: string | undefined): void => {
        const taker = waiting.shift();
        if (taker === undefined) queue.push(value);
        else taker(value);
      };
      response.on('data', (chunk: Buffer) => { push(String(chunk)); });
      response.on('end', () => { push(undefined); });
      response.on('error', () => { push(undefined); });
      response.on('aborted', () => { push(undefined); });
      const next = (): Promise<string | undefined> => {
        if (queue.length > 0) return Promise.resolve(queue.shift());
        return new Promise((done) => { waiting.push(done); });
      };
      resolve({
        request,
        response,
        next,
        rest: async () => {
          let all = '';
          for (let chunk = await next(); chunk !== undefined; chunk = await next()) all += chunk;
          return all;
        },
      });
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });

describe('the call goes out with the provider\'s key and streams back unchanged', () => {
  it('sends the entry\'s id and the key in OpenAI\'s header, and nothing of the caller\'s credential', async () => {
    const provider = await fake(answerJson(200, { id: 'chatcmpl-1', object: 'chat.completion', choices: [] }));
    const served = await proxy({ proxy: table('openai-chat', provider.endpoint), env: keys(1) });
    const body = { model: 'm/x', stream: false, temperature: 0.2, messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function' }] };
    const got = await send(served.port, CHAT, {
      headers: {
        ...asRoot, 'x-ahp-scope': 'backend', cookie: 'session=1', origin: `http://127.0.0.1:${String(served.port)}`,
        'x-forwarded-for': '10.0.0.1', 'proxy-authorization': 'Basic x', 'x-custom': 'kept',
      },
      body,
    });
    expect(got.status).toBe(200);
    expect(got.json).toEqual({ id: 'chatcmpl-1', object: 'chat.completion', choices: [] });

    const [sent] = provider.received;
    expect(sent?.url).toBe('/v1/chat/completions');
    expect(JSON.parse(sent?.body ?? '')).toEqual({ ...body, model: 'id-0' });
    expect(sent?.headers['authorization']).toBe(`Bearer ${MARKER}`);
    expect(sent?.headers['x-api-key']).toBeUndefined();
    for (const name of ['x-ahp-scope', 'cookie', 'origin', 'x-forwarded-for', 'proxy-authorization']) {
      expect(sent?.headers[name], name).toBeUndefined();
    }
    expect(sent?.headers['x-custom']).toBe('kept');
    expect(JSON.stringify(sent?.headers)).not.toContain(ROOT_TOKEN);
  });

  it('sends the key as x-api-key in Anthropic\'s dialect, and passes anthropic-version and -beta', async () => {
    const provider = await fake(answerJson(200, { type: 'message', content: [] }));
    const served = await proxy({ proxy: table('anthropic-messages', provider.endpoint), env: keys(1) });
    const got = await send(served.port, MESSAGES, {
      headers: { 'x-api-key': ROOT_TOKEN, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'tools-2024', accept: 'application/json' },
      body: { model: 'm/x', max_tokens: 8, messages: [] },
    });
    expect(got.status).toBe(200);
    const [sent] = provider.received;
    expect(sent?.url).toBe('/v1/v1/messages');
    expect(sent?.headers['x-api-key']).toBe(MARKER);
    expect(sent?.headers['authorization']).toBeUndefined();
    expect(sent?.headers['anthropic-version']).toBe('2023-06-01');
    expect(sent?.headers['anthropic-beta']).toBe('tools-2024');
    expect(sent?.headers['accept']).toBe('application/json');
    expect(JSON.parse(sent?.body ?? '').model).toBe('id-0');
  });

  it('sends no key to a provider that has none, and still not the caller\'s', async () => {
    const provider = await fake(answerJson(200, {}));
    const served = await proxy({
      proxy: { providers: { local: { endpoint: provider.endpoint, accepts: ['openai-chat'] } }, models: { 'local/default': [{ provider: 'local', id: 'local-model' }] } },
    });
    expect((await send(served.port, CHAT, { headers: asRoot, body: { model: 'local/default' } })).status).toBe(200);
    expect(provider.received[0]?.headers['authorization']).toBeUndefined();
    expect(provider.received[0]?.headers['x-api-key']).toBeUndefined();
  });

  it('streams an SSE answer event by event, byte for byte', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((done) => { release = done; });
    const events = [
      event('message_start', { type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } }),
      event('content_block_delta', { type: 'content_block_delta', delta: { text: 'Hé ✓' } }),
      event('message_delta', { type: 'message_delta', usage: { output_tokens: 3 } }),
      event('message_stop', { type: 'message_stop' }),
    ];
    const provider = await fake(async (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'req-1' });
      response.write(events[0]);
      // The rest waits until the caller has read the first event.
      await gate;
      for (const one of events.slice(1)) {
        response.write(one);
        await pause(10);
      }
      response.end();
    });
    const served = await proxy({ proxy: table('anthropic-messages', provider.endpoint), env: keys(1) });
    const answer = await streaming(served.port, MESSAGES, { 'x-api-key': ROOT_TOKEN }, { model: 'm/x', stream: true });
    expect(answer.response.statusCode).toBe(200);
    expect(answer.response.headers['content-type']).toBe('text/event-stream');
    expect(answer.response.headers['x-request-id']).toBe('req-1');
    const first = await answer.next();
    expect(first).toBe(events[0]);
    release();
    expect(`${first ?? ''}${await answer.rest()}`).toBe(events.join(''));
  });

  it('passes a provider\'s error through as it came', async () => {
    const said = { error: { message: 'slow down', type: 'rate_limit_error' } };
    const provider = await fake(answerJson(429, said, { 'retry-after': '7' }));
    const served = await proxy({ proxy: table('openai-chat', provider.endpoint), env: keys(1) });
    const got = await send(served.port, CHAT, { headers: asRoot, body: { model: 'm/x' } });
    expect(got.status).toBe(429);
    expect(got.json).toEqual(said);
    expect(got.headers['retry-after']).toBe('7');
    expect(served.log.join('\n')).toContain('proxy: root m/x: p0 answered 429');
  });

  it('answers a provider that cannot be reached with 502 in the dialect\'s body, naming the provider', async () => {
    const gone = await fake(answerJson(200, {}));
    await gone.close();
    fakes.splice(fakes.indexOf(gone), 1);
    const served = await proxy({ proxy: table('anthropic-messages', gone.endpoint), env: keys(1) });
    const got = await send(served.port, MESSAGES, { headers: { 'x-api-key': ROOT_TOKEN }, body: { model: 'm/x' } });
    expect(got.status).toBe(502);
    expect(isAnthropicError(got.json)).toBe(true);
    expect(got.json).toMatchObject({ error: { type: 'api_error', message: 'model m/x on p0 could not be reached' } });
    expect(served.log.join('\n')).toMatch(/proxy: root m\/x: p0 unreachable/u);
  });

  it('drops the encoding, the length and a cookie from the answer, whose body fetch has decoded', async () => {
    const plain = JSON.stringify({ ok: true, pad: 'x'.repeat(200) });
    const provider = await fake((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'set-cookie': 'provider=1' });
      response.end(gzipSync(plain));
    });
    const served = await proxy({ proxy: table('openai-chat', provider.endpoint), env: keys(1) });
    const got = await send(served.port, CHAT, { headers: asRoot, body: { model: 'm/x' } });
    expect(got.status).toBe(200);
    expect(got.text).toBe(plain);
    expect(got.headers['content-encoding']).toBeUndefined();
    expect(got.headers['set-cookie']).toBeUndefined();
  });

  it('does not follow a redirect, which would carry the key elsewhere', async () => {
    const elsewhere = await fake(answerJson(200, {}));
    const provider = await fake((_request, response) => {
      response.writeHead(307, { location: `${elsewhere.endpoint}/chat/completions` });
      response.end();
    });
    const served = await proxy({ proxy: table('openai-chat', provider.endpoint), env: keys(1) });
    const got = await send(served.port, CHAT, { headers: asRoot, body: { model: 'm/x' } });
    expect(got.status).toBe(502);
    expect(elsewhere.received).toEqual([]);
  });

  it('keeps the account\'s organization, project and rate-limit headers out both ways, and passes retry-after', async () => {
    const provider = await fake(answerJson(200, { ok: true }, {
      'openai-organization': 'org-host', 'openai-project': 'proj-host', 'anthropic-organization-id': 'org-uuid',
      'x-ratelimit-remaining-requests': '99', 'x-ratelimit-limit-tokens': '1000',
      'anthropic-ratelimit-tokens-remaining': '5000', 'anthropic-ratelimit-requests-reset': '2026-10-06T00:00:00Z',
      'retry-after': '3', 'retry-after-ms': '3000', 'x-request-id': 'req-9',
    }));
    const served = await proxy({ proxy: table('openai-chat', provider.endpoint), env: keys(1) });
    const got = await send(served.port, CHAT, {
      headers: { ...asRoot, 'openai-organization': 'org-caller', 'openai-project': 'proj-caller', 'anthropic-organization-id': 'org-caller' },
      body: { model: 'm/x' },
    });
    expect(got.status).toBe(200);
    for (const name of ['openai-organization', 'openai-project', 'anthropic-organization-id']) {
      expect(provider.received[0]?.headers[name], `sent ${name}`).toBeUndefined();
      expect(got.headers[name], `returned ${name}`).toBeUndefined();
    }
    for (const name of ['x-ratelimit-remaining-requests', 'x-ratelimit-limit-tokens', 'anthropic-ratelimit-tokens-remaining', 'anthropic-ratelimit-requests-reset']) {
      expect(got.headers[name], name).toBeUndefined();
    }
    expect(got.headers['retry-after']).toBe('3');
    expect(got.headers['retry-after-ms']).toBe('3000');
    expect(got.headers['x-request-id']).toBe('req-9');
  });

  it('does not send a header the caller\'s Connection header names', async () => {
    const provider = await fake(answerJson(200, {}));
    const served = await proxy({ proxy: table('openai-chat', provider.endpoint), env: keys(1) });
    const got = await send(served.port, CHAT, {
      headers: { ...asRoot, connection: 'keep-alive, x-hop', 'x-hop': 'this-connection-only', 'x-custom': 'kept' },
      body: { model: 'm/x' },
    });
    expect(got.status).toBe(200);
    expect(provider.received[0]?.headers['x-hop']).toBeUndefined();
    expect(provider.received[0]?.headers['x-custom']).toBe('kept');
  });

  it('keeps the marker key out of every log line, refusal and answer', async () => {
    const provider = await fake(answerJson(500, { error: { message: 'boom' } }));
    const served = await proxy({ proxy: table('openai-chat', provider.endpoint), env: keys(1) });
    const texts = [
      (await send(served.port, CHAT, { headers: asRoot, body: { model: 'm/x' } })).text,
      (await send(served.port, CHAT, { headers: asRoot, body: { model: 'nobody/nothing' } })).text,
      (await send(served.port, MESSAGES, { headers: asRoot, body: { model: 'm/x' } })).text,
      (await send(served.port, CHAT, { headers: { authorization: 'Bearer wrong' }, body: { model: 'm/x' } })).text,
      served.log.join('\n'),
    ];
    for (const text of texts) expect(text).not.toContain(MARKER);
  });
});

describe('a call ends when either side does, and on a timeout', () => {
  it('closes the provider\'s request when the caller hangs up mid-stream', async () => {
    const provider = await fake((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(event('message_start', { type: 'message_start' }));
      // And never another.
    });
    const served = await proxy({ proxy: table('anthropic-messages', provider.endpoint), env: keys(1) });
    const answer = await streaming(served.port, MESSAGES, { 'x-api-key': ROOT_TOKEN }, { model: 'm/x', stream: true });
    expect(await answer.next()).toContain('message_start');
    answer.request.destroy();
    const until = Date.now() + 1000;
    while (provider.received[0]?.closed !== true && Date.now() < until) await pause(20);
    expect(provider.received[0]?.closed).toBe(true);
  });

  it('answers 504 in the dialect\'s body when the provider sends no headers in time', async () => {
    const provider = await fake(() => { /* never answers */ });
    const served = await proxy({ proxy: table('openai-chat', provider.endpoint), env: keys(1), headersTimeoutMs: 200 });
    const started = Date.now();
    const got = await send(served.port, CHAT, { headers: asRoot, body: { model: 'm/x' } });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(got.status).toBe(504);
    expect(isOpenAiError(got.json)).toBe(true);
    expect(got.json).toMatchObject({ error: { type: 'timeout_error', message: 'model m/x on p0 sent no answer in time' } });
  });

  it('ends the stream after the events already sent when the provider goes quiet', async () => {
    const first = event('message_start', { type: 'message_start' });
    const provider = await fake((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(first);
    });
    const served = await proxy({ proxy: table('anthropic-messages', provider.endpoint), env: keys(1), idleTimeoutMs: 200 });
    const answer = await streaming(served.port, MESSAGES, { 'x-api-key': ROOT_TOKEN }, { model: 'm/x', stream: true });
    const all = `${await answer.next() ?? ''}${await answer.rest()}`;
    expect(all).toBe(first);
    expect(served.log.join('\n')).toContain('p0 sent nothing for 0.2 s; the answer was ended');
    const until = Date.now() + 1000;
    while (provider.received[0]?.closed !== true && Date.now() < until) await pause(20);
    expect(provider.received[0]?.closed).toBe(true);
  });

  it('falls back to the next entry on a 503, and the caller gets the answer of the last one tried', async () => {
    const down = await fake(answerJson(503, { error: { message: 'overloaded' } }));
    const up = await fake(answerJson(200, { from: 'up' }));
    const served = await proxy({ proxy: table('openai-chat', down.endpoint, up.endpoint), env: keys(2) });
    const got = await send(served.port, CHAT, { headers: asRoot, body: { model: 'm/x' } });
    expect(got.status).toBe(200);
    expect(got.json).toEqual({ from: 'up' });
    expect(JSON.parse(up.received[0]?.body ?? '').model).toBe('id-1');
    expect(served.log.join('\n')).toContain('proxy: root m/x: p0 503; p1 answered 200');
  });

  it('falls back on a 429 and a refused connection', async () => {
    const limited = await fake(answerJson(429, {}));
    const gone = await fake(answerJson(200, {}));
    await gone.close();
    fakes.splice(fakes.indexOf(gone), 1);
    const up = await fake(answerJson(200, { from: 'up' }));
    const served = await proxy({
      proxy: table('anthropic-messages', limited.endpoint, gone.endpoint, up.endpoint),
      env: keys(3),
    });
    const got = await send(served.port, MESSAGES, { headers: asRoot, body: { model: 'm/x' } });
    expect(got.json).toEqual({ from: 'up' });
    expect(served.log.join('\n')).toMatch(/p0 429, p1 unreachable[^;]*; p2 answered 200/u);
  });

  it('does not fall back after a header timeout: the caller gets 504 and the next entry is never called', async () => {
    const silent = await fake(() => { /* never answers */ });
    const spare = await fake(answerJson(200, { from: 'spare' }));
    const served = await proxy({ proxy: table('anthropic-messages', silent.endpoint, spare.endpoint), env: keys(2), headersTimeoutMs: 200 });
    const got = await send(served.port, MESSAGES, { headers: asRoot, body: { model: 'm/x' } });
    expect(got.status).toBe(504);
    expect(isAnthropicError(got.json)).toBe(true);
    expect(got.json).toMatchObject({ error: { type: 'timeout_error', message: 'model m/x on p0 sent no answer in time' } });
    await pause(50);
    expect(silent.received).toHaveLength(1);
    expect(spare.received).toEqual([]);
  });

  it('starts no further upstream call once the caller has hung up between attempts', async () => {
    let calls = 0;
    let hangUp: () => void = () => {};
    const upstream: typeof fetch = async (_url, init) => {
      calls += 1;
      const signal = init?.signal;
      if (calls === 1 && signal !== undefined && signal !== null) {
        // The caller hangs up while the first entry is still answering; its 503 comes after.
        const aborted = new Promise<void>((done) => { signal.addEventListener('abort', () => { done(); }, { once: true }); });
        hangUp();
        await aborted;
      }
      return new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 503, headers: { 'content-type': 'application/json' } });
    };
    const served = await proxy({ proxy: table('openai-chat', 'http://127.0.0.1:1/v1', 'http://127.0.0.1:2/v1'), env: keys(2), fetch: upstream });
    const request = httpRequest({
      host: '127.0.0.1', port: served.port, path: CHAT, method: 'POST',
      headers: { host: `127.0.0.1:${String(served.port)}`, 'content-type': 'application/json', ...asRoot },
    });
    request.on('error', () => { /* hung up on purpose */ });
    hangUp = () => { request.destroy(); };
    request.end(JSON.stringify({ model: 'm/x' }));
    const until = Date.now() + 1000;
    while (!served.log.join('\n').includes('caller hung up') && Date.now() < until) await pause(20);
    expect(calls).toBe(1);
    expect(served.log.join('\n')).toContain('p0 503, p1 not tried, the caller hung up');
  });

  it('answers the last failure when every entry fails', async () => {
    const one = await fake(answerJson(503, { error: { message: 'first' } }));
    const two = await fake(answerJson(502, { error: { message: 'second' } }));
    const served = await proxy({ proxy: table('openai-chat', one.endpoint, two.endpoint), env: keys(2) });
    const got = await send(served.port, CHAT, { headers: asRoot, body: { model: 'm/x' } });
    expect(got.status).toBe(502);
    expect(got.json).toEqual({ error: { message: 'second' } });
  });

  it('does not retry a 400, nor a provider that failed after its first event', async () => {
    const bad = await fake(answerJson(400, { error: { message: 'bad request' } }));
    const spare = await fake(answerJson(200, {}));
    const served = await proxy({ proxy: table('openai-chat', bad.endpoint, spare.endpoint), env: keys(2) });
    const got = await send(served.port, CHAT, { headers: asRoot, body: { model: 'm/x' } });
    expect(got.status).toBe(400);
    expect(spare.received).toEqual([]);

    const first = 'data: {"choices":[]}\n\n';
    const broken = await fake((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(first, () => { setTimeout(() => { response.destroy(); }, 20); });
    });
    const second = await fake(answerJson(200, {}));
    const again = await proxy({ proxy: table('openai-chat', broken.endpoint, second.endpoint), env: keys(2) });
    const answer = await streaming(again.port, CHAT, asRoot, { model: 'm/x', stream: true });
    const all = `${await answer.next() ?? ''}${await answer.rest()}`;
    expect(all).toBe(first);
    expect(second.received).toEqual([]);
    expect(again.log.join('\n')).toContain('p0 ended its answer early');
  });

  it('cuts the caller\'s connection when the provider drops mid-answer, rather than ending a short body cleanly', async () => {
    const provider = await fake((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '100' });
      response.write('{"partial":', () => { setTimeout(() => { response.socket?.destroy(); }, 20); });
    });
    const served = await proxy({ proxy: table('openai-chat', provider.endpoint), env: keys(1) });
    const outcome = await new Promise<{ ended: boolean; error?: string; text: string }>((resolve) => {
      const request = httpRequest({
        host: '127.0.0.1', port: served.port, path: CHAT, method: 'POST',
        headers: { host: `127.0.0.1:${String(served.port)}`, 'content-type': 'application/json', ...asRoot },
      }, (response) => {
        let text = '';
        response.on('data', (chunk: Buffer) => { text += String(chunk); });
        response.on('end', () => { resolve({ ended: true, text }); });
        response.on('error', (error: NodeJS.ErrnoException) => { resolve({ ended: false, error: error.code ?? error.message, text }); });
      });
      request.on('error', (error: NodeJS.ErrnoException) => { resolve({ ended: false, error: error.code ?? error.message, text: '' }); });
      request.end(JSON.stringify({ model: 'm/x' }));
    });
    expect(outcome.ended).toBe(false);
    expect(outcome.error).toMatch(/ECONNRESET|aborted/u);
    expect(served.log.join('\n')).toContain('p0 ended its answer early');
  });
});
