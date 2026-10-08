#!/usr/bin/env node
/**
 * Calls through the model proxy, the way a tool would, and says what came back.
 *
 * Lists the models, then calls one in each dialect the proxy reads: OpenAI's
 * chat completions and Anthropic's messages, whole and streamed. Then the
 * refusals a client meets: no token, a model nobody serves, a wrong method.
 * See docs/PROXY.md for what each answer should be.
 *
 *   AHPD_TOKEN=<token> node scripts/completions.mjs
 *   node scripts/completions.mjs --base http://127.0.0.1:37537 --model local/default --token <token>
 *   node scripts/completions.mjs --only chat --prompt 'Say PONG'
 *   node scripts/completions.mjs --fake-upstream --scope backend
 *
 * Options:
 *   --base <url>       the listener that serves /v1, default http://127.0.0.1:37537
 *   --token <secret>   the ahpd token, default AHPD_TOKEN
 *   --model <name>     a <maker>/<name>, default the first one /v1/models lists
 *   --prompt <text>    what to ask, default a one-word answer
 *   --scope <scope>    sent as X-AHP-Scope, to charge a team or project
 *   --only <part>      models, chat, messages or refusals; repeatable
 *   --fake-upstream    answer as the provider on 127.0.0.1:1234, where the
 *                      `local` provider points, so a call succeeds without a
 *                      model server; it also checks what the proxy forwarded
 *   --fake-port <n>    the fake provider's port, default 1234
 *
 * Exit status is 0 when every check got the answer it expects.
 */

import { createServer } from 'node:http';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
};
const all = (name) => argv.flatMap((one, at) => (one === `--${name}` && argv[at + 1] !== undefined ? [argv[at + 1]] : []));

const base = arg('base', 'http://127.0.0.1:37537').replace(/\/+$/, '');
const token = arg('token', process.env.AHPD_TOKEN);
const prompt = arg('prompt', 'Reply with exactly the word PONG and nothing else.');
const scope = arg('scope');
const only = all('only');
const runs = (part) => only.length === 0 || only.includes(part);

if (!token) {
  console.log('No token. Pass --token, or set AHPD_TOKEN.');
  process.exit(1);
}

let failed = 0;
/** One check's line: what was asked, and whether the answer was the expected one. */
const report = (ok, what, detail) => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `\n     ${detail}` : ''}`);
};

const headers = (dialect, extra = {}) => ({
  'content-type': 'application/json',
  ...(dialect === 'anthropic'
    ? { 'x-api-key': token, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${token}` }),
  ...(scope ? { 'x-ahp-scope': scope } : {}),
  ...extra,
});

/** A call's answer as text, with its status and the time it took. */
const call = async (path, init) => {
  const began = Date.now();
  try {
    const response = await fetch(`${base}${path}`, init);
    const text = await response.text();
    return { status: response.status, type: response.headers.get('content-type') ?? '', text, ms: Date.now() - began };
  }
  catch (error) {
    return { status: 0, type: '', text: error instanceof Error ? error.message : String(error), ms: Date.now() - began };
  }
};
const json = (text) => { try { return JSON.parse(text); } catch { return undefined; } };
const short = (text, n = 160) => (text.length > n ? `${text.slice(0, n)}...` : text).replace(/\s+/g, ' ');
/** The `data:` payloads of an SSE body, parsed where they are JSON. */
const events = (text) => text.split('\n')
  .filter((line) => line.startsWith('data:'))
  .map((line) => line.slice(5).trim())
  .filter((data) => data !== '' && data !== '[DONE]')
  .map(json)
  .filter(Boolean);

/**
 * A stand-in for a provider, for a host whose providers cannot answer.
 *
 * Listens where a provider's endpoint points (the `local` one is
 * http://127.0.0.1:1234/v1) and answers OpenAI's chat completions, whole and
 * streamed. It keeps what each call carried, so the checks can say whether the
 * proxy renamed the model and kept the caller's token to itself.
 */
const fakePort = argv.includes('--fake-upstream') ? Number(arg('fake-port', 1234)) : undefined;
const seen = [];
const fake = fakePort === undefined ? undefined : await new Promise((ready, fail) => {
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      const body = json(raw) ?? {};
      seen.push({ path: request.url, headers: request.headers, body });
      if (!body.stream) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          id: 'fake-1', object: 'chat.completion', model: body.model,
          choices: [{ index: 0, message: { role: 'assistant', content: 'PONG' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 },
        }));
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta, extra = {}) => response.write(`data: ${JSON.stringify({ id: 'fake-2', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`);
      chunk({ role: 'assistant', content: 'PO' });
      chunk({ content: 'NG' });
      if (body.stream_options?.include_usage) {
        response.write(`data: ${JSON.stringify({ id: 'fake-2', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 12, completion_tokens: 1, total_tokens: 13 } })}\n\n`);
      }
      response.end('data: [DONE]\n\n');
    });
  });
  server.once('error', (error) => fail(new Error(`the fake provider could not listen on ${fakePort}: ${error.message}`)));
  server.listen(fakePort, '127.0.0.1', () => ready(server));
});
if (fake) console.log(`fake provider on http://127.0.0.1:${fakePort}\n`);
const leave = (code) => {
  fake?.close();
  process.exit(code);
};

// The models, in both list shapes.
let model = arg('model');
{
  const openai = await call('/v1/models', { headers: headers('openai') });
  if (openai.status === 0) {
    console.log(`Could not reach ${base}: ${openai.text}`);
    leave(1);
  }
  const names = json(openai.text)?.data?.map((one) => one.id) ?? [];
  if (runs('models')) {
    report(openai.status === 200 && names.length > 0, `GET /v1/models (OpenAI shape) -> ${openai.status}`, names.join(', ') || short(openai.text));
    const anthropic = await call('/v1/models', { headers: headers('anthropic') });
    const listed = json(anthropic.text);
    report(anthropic.status === 200 && Array.isArray(listed?.data) && listed.object === undefined,
      `GET /v1/models (Anthropic shape) -> ${anthropic.status}`, (listed?.data ?? []).map((one) => one.id).join(', ') || short(anthropic.text));
  }
  if (model !== undefined && names.length > 0 && !names.includes(model)) {
    console.log(`\nThe proxy does not list ${model}. It lists: ${names.join(', ')}`);
    leave(1);
  }
  model ??= names[0];
}
if (model === undefined) {
  console.log('The proxy lists no model to call. Pass --model.');
  leave(1);
}
console.log(`\nmodel ${model}\n`);

/**
 * One dialect, whole and streamed.
 *
 * A model served only in the other dialect answers 404 naming the path to
 * call, which is a correct answer and reported as such rather than as a fail.
 */
const dialect = async (name, path, body, said, streamed) => {
  const whole = await call(path, { method: 'POST', headers: headers(name), body: JSON.stringify(body(false)) });
  if (whole.status === 404) {
    report(true, `POST ${path} -> 404, not served in this dialect`, json(whole.text)?.error?.message ?? short(whole.text));
    return;
  }
  const answer = json(whole.text);
  report(whole.status === 200 && said(answer) !== '', `POST ${path} -> ${whole.status} in ${whole.ms} ms`,
    whole.status === 200 ? `said ${JSON.stringify(short(said(answer)))}, usage ${JSON.stringify(answer?.usage ?? null)}` : short(whole.text));

  const stream = await call(path, { method: 'POST', headers: headers(name), body: JSON.stringify(body(true)) });
  const chunks = events(stream.text);
  const text = streamed(chunks);
  report(stream.status === 200 && stream.type.includes('text/event-stream') && text !== '',
    `POST ${path} stream -> ${stream.status} in ${stream.ms} ms, ${chunks.length} events`,
    stream.status === 200 ? `said ${JSON.stringify(short(text))}` : short(stream.text));
};

if (runs('chat')) {
  await dialect('openai', '/v1/chat/completions',
    (stream) => ({
      model, messages: [{ role: 'user', content: prompt }], max_tokens: 64,
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    }),
    (answer) => answer?.choices?.[0]?.message?.content ?? '',
    (chunks) => chunks.map((one) => one.choices?.[0]?.delta?.content ?? '').join(''));
  if (fake) {
    const last = seen.at(-1);
    report(last !== undefined, `the provider was called ${seen.length} time${seen.length === 1 ? '' : 's'}`, last ? `at ${last.path}` : 'never');
    if (last) {
      report(last.body.model !== model, 'the proxy sent the provider its own model id', `${model} -> ${last.body.model}`);
      const carried = Object.entries(last.headers).filter(([, value]) => String(value).includes(token)).map(([key]) => key);
      report(carried.length === 0, 'the caller\'s token did not reach the provider', carried.length === 0 ? '' : `found in ${carried.join(', ')}`);
      report(last.headers['x-ahp-scope'] === undefined, 'X-AHP-Scope did not reach the provider');
    }
  }
}

if (runs('messages')) {
  await dialect('anthropic', '/v1/messages',
    (stream) => ({ model, max_tokens: 64, messages: [{ role: 'user', content: prompt }], ...(stream ? { stream: true } : {}) }),
    (answer) => (answer?.content ?? []).map((one) => one.text ?? '').join(''),
    (chunks) => chunks.map((one) => (one.type === 'content_block_delta' ? one.delta?.text ?? '' : '')).join(''));
}

if (runs('refusals')) {
  console.log('');
  const body = JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] });
  const expect = async (what, path, init, status, type) => {
    const got = await call(path, init);
    const error = json(got.text)?.error;
    report(got.status === status && (type === undefined || error?.type === type),
      `${what} -> ${got.status}${error?.type ? ` ${error.type}` : ''}`, error?.message ?? short(got.text));
  };
  await expect('no token', '/v1/chat/completions',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body }, 401, 'authentication_error');
  await expect('a token nobody knows', '/v1/chat/completions',
    { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-token' }, body }, 401, 'authentication_error');
  await expect('two different credentials', '/v1/chat/completions',
    { method: 'POST', headers: { ...headers('openai'), 'x-api-key': 'not-a-token' }, body }, 400, 'invalid_request_error');
  await expect('a model nobody serves', '/v1/chat/completions',
    { method: 'POST', headers: headers('openai'), body: JSON.stringify({ model: 'nobody/nothing', messages: [] }) }, 404, 'not_found_error');
  await expect('a body that is not JSON', '/v1/chat/completions',
    { method: 'POST', headers: headers('openai'), body: 'not json' }, 400, 'invalid_request_error');
  await expect('GET on a POST path', '/v1/chat/completions', { headers: headers('openai') }, 405, 'invalid_request_error');
  await expect('a path the proxy does not serve', '/v1/embeddings',
    { method: 'POST', headers: headers('openai'), body }, 404);
}

console.log(failed === 0 ? '\nEvery check passed.' : `\n${failed} check${failed === 1 ? '' : 's'} failed.`);
leave(failed === 0 ? 0 : 1);
