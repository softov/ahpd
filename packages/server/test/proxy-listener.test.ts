/*
 * The proxy's door: where it answers, the shape of every refusal, who a caller
 * is, and the models list.
 *
 * Most cases serve the handler on a socket of its own, which is the daemon's
 * own path through `plainRequests`; the last ones start a real daemon, because
 * what they check is the wiring - `http` reaching the mount, and `/v1` being
 * the 404 `/api` is with `http` off.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memoryPolicies, type Grant, type Users } from '@ahpd/sdk';
import {
  answerJson, fakeProvider, isAnthropicError, isOpenAiError, MARKER, memoryUsage, people, ROOT_TOKEN, send, serveProxy,
  type People, type Served, type ServeOptions,
} from './fixtures/proxy-harness.js';

let folder: string;
let who: People;
const open: Served[] = [];
const fakes: { close(): Promise<void> }[] = [];

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), 'ahpd-proxy-listener-'));
  who = await people(folder);
});

afterEach(async () => {
  for (const one of open.splice(0)) await one.close();
  for (const one of fakes.splice(0)) await one.close();
  rmSync(folder, { recursive: true, force: true });
});

/** The proxy, with the users file above unless the options say otherwise. */
const proxy = async (options: ServeOptions = {}): Promise<Served> => {
  const served = await serveProxy({ users: who.users, ...options });
  open.push(served);
  return served;
};

/** A provider that answers every call with a small chat completion. */
const okProvider = async () => {
  const fake = await fakeProvider(answerJson(200, { id: 'x', object: 'chat.completion', choices: [] }));
  fakes.push(fake);
  return fake;
};

/** A person of a role of its own holding `grants`, in the team this host names, and a token for them. */
const personOf = async (id: string, grants: Grant[]): Promise<string> => {
  await who.users.addRole(id, grants);
  await who.users.add(id, [id], { memberships: ['backend'], primary: 'backend' });
  return who.users.mint(id);
};

/** A table whose one name, `fake/model`, is served by `endpoint` in both dialects with no key. */
const table = (endpoint: string) => ({
  providers: { fake: { endpoint, accepts: ['openai-chat', 'anthropic-messages'] as ('openai-chat' | 'anthropic-messages')[] } },
  models: { 'fake/model': [{ provider: 'fake', id: 'fake-model' }] },
});

const CHAT = '/v1/chat/completions';
const MESSAGES = '/v1/messages';
const CALL = { model: 'fake/model', messages: [{ role: 'user', content: 'hi' }] };
const asRoot = { authorization: `Bearer ${ROOT_TOKEN}` };

describe('/v1 answers in each dialect, and refuses in its own error shape', () => {
  it('reads /v1/chat/completions as openai-chat and /v1/messages as anthropic-messages', async () => {
    const fake = await okProvider();
    const served = await proxy({ proxy: table(fake.endpoint) });
    expect((await send(served.port, CHAT, { headers: asRoot, body: CALL })).status).toBe(200);
    expect((await send(served.port, MESSAGES, { headers: asRoot, body: CALL })).status).toBe(200);
    expect(fake.received.map((one) => one.url)).toEqual(['/v1/chat/completions', '/v1/v1/messages']);
  });

  it('refuses a body that is not JSON, or names no model, with 400 in each dialect', async () => {
    const served = await proxy();
    const notJson = await send(served.port, CHAT, { headers: asRoot, body: 'model=x' });
    expect(notJson.status).toBe(400);
    expect(isOpenAiError(notJson.json)).toBe(true);
    expect(notJson.json).toMatchObject({ error: { type: 'invalid_request_error', message: 'The request body is not JSON' } });

    const noModel = await send(served.port, MESSAGES, { headers: asRoot, body: { messages: [] } });
    expect(noModel.status).toBe(400);
    expect(isAnthropicError(noModel.json)).toBe(true);
    expect(noModel.json).toMatchObject({ type: 'error', error: { type: 'invalid_request_error' } });

    const array = await send(served.port, CHAT, { headers: asRoot, body: [] });
    expect(array.status).toBe(400);
  });

  it('refuses a method other than POST on a call path with 405 and Allow', async () => {
    const served = await proxy();
    const got = await send(served.port, MESSAGES, { method: 'GET', headers: asRoot });
    expect(got.status).toBe(405);
    expect(got.headers['allow']).toBe('POST');
    expect(isAnthropicError(got.json)).toBe(true);
    expect(got.json).toMatchObject({ error: { type: 'invalid_request_error' } });
  });

  it('answers a path under /v1 that is none of the three with 404 in OpenAI\'s body', async () => {
    const served = await proxy();
    const got = await send(served.port, '/v1/foo', { headers: asRoot });
    expect(got.status).toBe(404);
    expect(isOpenAiError(got.json)).toBe(true);
    expect(got.json).toMatchObject({ error: { type: 'not_found_error' } });
  });

  it('leaves everything outside /v1 to what is below it', async () => {
    const served = await proxy();
    expect((await send(served.port, '/api/manifest')).status).toBe(418);
    expect((await send(served.port, '/v10')).status).toBe(418);
  });

  it('refuses a foreign Host and a foreign Origin with 403 in the dialect\'s body', async () => {
    const served = await proxy();
    const host = await send(served.port, MESSAGES, { headers: { ...asRoot, host: 'evil.example:80' }, body: CALL });
    expect(host.status).toBe(403);
    expect(isAnthropicError(host.json)).toBe(true);
    expect(host.json).toMatchObject({ error: { type: 'permission_error', message: 'This API does not answer to evil.example:80' } });

    const origin = await send(served.port, CHAT, { headers: { ...asRoot, origin: 'https://evil.example' }, body: CALL });
    expect(origin.status).toBe(403);
    expect(isOpenAiError(origin.json)).toBe(true);
    expect(origin.json).toMatchObject({ error: { type: 'permission_error', message: 'This API does not answer to https://evil.example' } });

    // A loopback name at another port is still held to its Origin.
    const both = await send(served.port, CHAT, { headers: { ...asRoot, host: 'localhost:1', origin: 'https://evil.example' }, body: CALL });
    expect(both.status).toBe(403);

    // A path under /v1 that is neither dialect's is refused in plain JSON.
    const plain = await send(served.port, '/v1/foo', { headers: { host: 'evil.example' } });
    expect(plain.status).toBe(403);
    expect(plain.json).toEqual({ message: 'This API does not answer to evil.example' });
  });

  it('accepts a loopback Host at any port, which is where a forward lands', async () => {
    const fake = await okProvider();
    const served = await proxy({ proxy: table(fake.endpoint) });
    for (const host of ['127.0.0.1:41999', 'localhost:7', '[::1]:65000', 'localhost']) {
      expect((await send(served.port, CHAT, { headers: { ...asRoot, host }, body: CALL })).status, host).toBe(200);
    }
  });

  it('refuses a body larger than the limit with 413 before reading it all', async () => {
    const served = await proxy({ maxBodyBytes: 1024 });
    const got = await send(served.port, MESSAGES, { headers: asRoot, body: { model: 'fake/model', pad: 'x'.repeat(4096) } });
    expect(got.status).toBe(413);
    expect(isAnthropicError(got.json)).toBe(true);
    expect(got.json).toMatchObject({ error: { type: 'request_too_large' } });
  });
});

describe('a caller is a person, root or a session, and may call', () => {
  it('refuses a call with no credential, or one this host does not know, with 401 before anything is read', async () => {
    const fake = await okProvider();
    const served = await proxy({ proxy: table(fake.endpoint) });
    for (const path of [CHAT, MESSAGES]) {
      const none = await send(served.port, path, { body: CALL });
      expect(none.status).toBe(401);
      expect(path === CHAT ? isOpenAiError(none.json) : isAnthropicError(none.json)).toBe(true);
      expect(none.json).toMatchObject({ error: { type: 'authentication_error' } });

      const unknown = await send(served.port, path, { headers: { 'x-api-key': 'not-a-token' }, body: CALL });
      expect(unknown.status).toBe(401);
      const removed = await send(served.port, path, { headers: { 'x-api-key': who.rex }, body: CALL });
      expect(removed.status).toBe(401);
    }
    expect(fake.received).toEqual([]);
  });

  it('takes the credential as Bearer or as x-api-key, and refuses two that differ', async () => {
    const fake = await okProvider();
    const served = await proxy({ proxy: table(fake.endpoint) });
    expect((await send(served.port, CHAT, { headers: { authorization: `Bearer ${who.ana}` }, body: CALL })).status).toBe(200);
    expect((await send(served.port, MESSAGES, { headers: { 'x-api-key': who.ana }, body: CALL })).status).toBe(200);
    expect((await send(served.port, CHAT, { headers: { authorization: `Bearer ${who.ana}`, 'x-api-key': who.ana }, body: CALL })).status).toBe(200);
    const two = await send(served.port, MESSAGES, { headers: { authorization: `Bearer ${who.ana}`, 'x-api-key': who.gus }, body: CALL });
    expect(two.status).toBe(400);
    expect(isAnthropicError(two.json)).toBe(true);
    expect(fake.received).toHaveLength(3);
  });

  it('answers the deployment token as root, which needs no grant and no scope', async () => {
    const fake = await okProvider();
    const served = await proxy({ proxy: table(fake.endpoint) });
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': ROOT_TOKEN }, body: CALL })).status).toBe(200);
  });

  it('refuses a person without proxy:call with 403 naming the grant', async () => {
    const fake = await okProvider();
    const served = await proxy({ proxy: table(fake.endpoint) });
    const fay = await send(served.port, CHAT, { headers: { authorization: `Bearer ${who.fay}` }, body: CALL });
    expect(fay.status).toBe(403);
    expect(isOpenAiError(fay.json)).toBe(true);
    expect(fay.json).toMatchObject({ error: { type: 'permission_error', message: 'fay may not proxy:call here' } });
    const gus = await send(served.port, MESSAGES, { headers: { 'x-api-key': who.gus }, body: CALL });
    expect(gus.status).toBe(403);
    expect(isAnthropicError(gus.json)).toBe(true);
    expect(gus.json).toMatchObject({ error: { message: 'gus may not proxy:call here' } });
    expect(fake.received).toEqual([]);
    // The built-in member holds the call through the write group, and admin
    // through `*:*`.
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.ana }, body: CALL })).status).toBe(200);
    expect((await send(served.port, CHAT, { headers: { 'x-api-key': who.dee }, body: CALL })).status).toBe(200);
  });

  it('calls for a role holding only proxy:call, and refuses a list to it', async () => {
    const fake = await okProvider();
    const served = await proxy({ proxy: table(fake.endpoint) });
    const caller = await personOf('cal', ['proxy:call']);
    expect((await send(served.port, CHAT, { headers: { authorization: `Bearer ${caller}` }, body: CALL })).status).toBe(200);
    const listed = await send(served.port, '/v1/models', { headers: { 'x-api-key': caller } });
    expect(listed.status).toBe(403);
    expect(listed.json).toMatchObject({ error: { message: 'cal may not proxy:models here' } });
  });

  it('refuses a person in no team on a host that names teams, as a session is refused', async () => {
    const served = await proxy();
    await who.users.add('nil', ['member']);
    const got = await send(served.port, CHAT, { headers: { 'x-api-key': await who.users.mint('nil') }, body: CALL });
    expect(got.status).toBe(403);
    expect(got.json).toMatchObject({ error: { message: 'nil belongs to no team and project, so there is nothing to charge' } });
  });

  it('reads the scope from X-AHP-Scope, then ?scope=, then the primary', async () => {
    const fake = await okProvider();
    const usage = memoryUsage();
    const served = await proxy({ proxy: table(fake.endpoint), usage: () => usage });
    const key = { 'x-api-key': who.ana };
    expect((await send(served.port, CHAT, { headers: key, body: CALL })).status).toBe(200);
    expect((await send(served.port, CHAT, { headers: { ...key, 'x-ahp-scope': 'backend:ahpd' }, body: CALL })).status).toBe(200);
    expect((await send(served.port, `${CHAT}?scope=backend:ahpd`, { headers: key, body: CALL })).status).toBe(200);
    expect((await send(served.port, `${CHAT}?scope=backend:ahpd`, { headers: { ...key, 'x-ahp-scope': 'backend:billing' }, body: CALL })).status).toBe(200);
    await new Promise((done) => { setTimeout(done, 20); });
    expect(usage.entries.map((one) => one.project)).toEqual(['billing', 'ahpd', 'ahpd', 'billing']);

    const foreign = await send(served.port, MESSAGES, { headers: { ...key, 'x-ahp-scope': 'sales' }, body: CALL });
    expect(foreign.status).toBe(403);
    expect(isAnthropicError(foreign.json)).toBe(true);
    expect(foreign.json).toMatchObject({ error: { message: 'ana may name backend:billing, backend:ahpd' } });
    // The scope header is this host's, not the provider's.
    for (const one of fake.received) expect(one.headers['x-ahp-scope']).toBeUndefined();
  });

  it('answers a token whose answers as a session, without asking the directory', async () => {
    const fake = await okProvider();
    let verified = 0;
    const counting: Users = { ...who.users, verify: async (token) => { verified += 1; return who.users.verify(token); } };
    const served = await proxy({
      proxy: table(fake.endpoint),
      users: counting,
      whose: (token) => (token === 'session-token' ? { session: 's-1', chat: 'c-1', turn: 't-1' } : undefined),
    });
    expect((await send(served.port, MESSAGES, { headers: { 'x-api-key': 'session-token' }, body: CALL })).status).toBe(200);
    expect(verified).toBe(0);
    expect((await send(served.port, MESSAGES, { headers: { 'x-api-key': who.ana }, body: CALL })).status).toBe(200);
    expect(verified).toBe(1);
  });

  it('accepts only the deployment token and whose on a host with no users directory', async () => {
    const fake = await okProvider();
    const served = await serveProxy({ proxy: table(fake.endpoint), whose: (token) => (token === 's' ? { session: 's-1' } : undefined) });
    open.push(served);
    expect((await send(served.port, CHAT, { headers: asRoot, body: CALL })).status).toBe(200);
    expect((await send(served.port, CHAT, { headers: { authorization: 'Bearer s' }, body: CALL })).status).toBe(200);
    const other = await send(served.port, CHAT, { headers: { authorization: `Bearer ${who.ana}` }, body: CALL });
    expect(other.status).toBe(401);
    expect(other.json).toMatchObject({ error: { message: 'A connection token is required' } });
  });
});

describe('GET /v1/models lists the names a caller may use', () => {
  /** Softov's table, as a fixture. */
  const SOFTOV = {
    providers: { local: { endpoint: 'http://127.0.0.1:1/v1', accepts: ['openai-chat'] as 'openai-chat'[] } },
    models: {
      'anthropic/claude-sonnet-5-5': [
        { provider: 'anthropic', id: 'claude-sonnet-5-5' },
        { provider: 'openrouter', id: 'anthropic/claude-sonnet-5.5', price: { input: 2, output: 10 } },
      ],
      'anthropic/claude-opus-5-5': [{ provider: 'anthropic', id: 'claude-opus-5-5' }],
      'openai/gpt-5.5': [{ provider: 'openrouter', id: 'openai/gpt-5.5', price: { input: 5, output: 30 } }],
      'local/default': [{ provider: 'local', id: 'local-model' }],
    },
  };
  const ALL_KEYS = { OPENROUTER_API_KEY: MARKER, ANTHROPIC_API_KEY: MARKER, OPENAI_API_KEY: MARKER };

  it('lists every name with a key set, in OpenAI\'s shape by default', async () => {
    const served = await proxy({ proxy: SOFTOV, env: ALL_KEYS });
    const got = await send(served.port, '/v1/models', { headers: { authorization: `Bearer ${who.ana}` } });
    expect(got.status).toBe(200);
    expect(got.json).toEqual({
      object: 'list',
      data: [
        { id: 'anthropic/claude-sonnet-5-5', object: 'model', created: 0, owned_by: 'anthropic' },
        { id: 'anthropic/claude-opus-5-5', object: 'model', created: 0, owned_by: 'anthropic' },
        { id: 'openai/gpt-5.5', object: 'model', created: 0, owned_by: 'openai' },
        { id: 'local/default', object: 'model', created: 0, owned_by: 'local' },
      ],
    });
    // No provider id, endpoint, price or variable is in it.
    for (const word of ['claude-sonnet-5.5', 'local-model', 'openrouter', '127.0.0.1', 'price', 'API_KEY', MARKER]) {
      expect(got.text).not.toContain(word);
    }
  });

  it('answers in Anthropic\'s shape when anthropic-version is sent', async () => {
    const served = await proxy({ proxy: SOFTOV, env: ALL_KEYS });
    const got = await send(served.port, '/v1/models', { headers: { 'x-api-key': who.ana, 'anthropic-version': '2023-06-01' } });
    expect(got.status).toBe(200);
    const body = got.json as { data: { type: string; id: string; display_name: string; created_at: string }[]; has_more: boolean; first_id: string; last_id: string };
    expect(body.data.map((one) => one.id)).toEqual(['anthropic/claude-sonnet-5-5', 'anthropic/claude-opus-5-5', 'openai/gpt-5.5', 'local/default']);
    expect(body.data[0]).toEqual({ type: 'model', id: 'anthropic/claude-sonnet-5-5', display_name: 'anthropic/claude-sonnet-5-5', created_at: '1970-01-01T00:00:00Z' });
    expect(body.has_more).toBe(false);
    expect(body.first_id).toBe('anthropic/claude-sonnet-5-5');
    expect(body.last_id).toBe('local/default');
  });

  it('drops a name whose every entry has no key set', async () => {
    const served = await proxy({ proxy: SOFTOV, env: { OPENROUTER_API_KEY: MARKER } });
    const got = await send(served.port, '/v1/models', { headers: { 'x-api-key': who.ana } });
    expect((got.json as { data: { id: string }[] }).data.map((one) => one.id)).toEqual(['anthropic/claude-sonnet-5-5', 'openai/gpt-5.5', 'local/default']);
  });

  it('drops a name a policy denies for that person, and not for root', async () => {
    const policies = memoryPolicies();
    await policies.put({ id: 'everyone', scope: 'all', kind: 'model', effect: 'allow', match: { model: ['*'] } });
    await policies.put({ id: 'no-openai', scope: 'all', kind: 'model', effect: 'deny', match: { model: ['openai/*'] } });
    const served = await proxy({ proxy: SOFTOV, env: ALL_KEYS, policies, policiesCheck: true });
    const ana = await send(served.port, '/v1/models', { headers: { 'x-api-key': who.ana } });
    expect((ana.json as { data: { id: string }[] }).data.map((one) => one.id)).not.toContain('openai/gpt-5.5');
    expect((ana.json as { data: { id: string }[] }).data).toHaveLength(3);
    const root = await send(served.port, '/v1/models', { headers: asRoot });
    expect((root.json as { data: { id: string }[] }).data.map((one) => one.id)).toContain('openai/gpt-5.5');
  });

  it('needs proxy:models, and refuses no credential with 401 in OpenAI\'s body', async () => {
    const served = await proxy({ proxy: SOFTOV, env: ALL_KEYS });
    const none = await send(served.port, '/v1/models');
    expect(none.status).toBe(401);
    expect(isOpenAiError(none.json)).toBe(true);
    const fay = await send(served.port, '/v1/models', { headers: { 'x-api-key': who.fay, 'anthropic-version': '2023-06-01' } });
    expect(fay.status).toBe(403);
    expect(isAnthropicError(fay.json)).toBe(true);
    expect(fay.json).toMatchObject({ error: { message: 'fay may not proxy:models here' } });
    const post = await send(served.port, '/v1/models', { headers: asRoot, body: {} });
    expect(post.status).toBe(405);
    expect(post.headers['allow']).toBe('GET');
  });

  it('lists for a role holding only proxy:models, and refuses a call to it', async () => {
    const served = await proxy({ proxy: SOFTOV, env: ALL_KEYS });
    const lister = await personOf('lis', ['proxy:models']);
    const listed = await send(served.port, '/v1/models', { headers: { 'x-api-key': lister } });
    expect(listed.status).toBe(200);
    expect((listed.json as { data: { id: string }[] }).data.length).toBeGreaterThan(0);
    const called = await send(served.port, CHAT, { headers: { 'x-api-key': lister }, body: CALL });
    expect(called.status).toBe(403);
    expect(called.json).toMatchObject({ error: { message: 'lis may not proxy:call here' } });
  });
});

/*
 * The daemon, as a process: the mount and the switch.
 */

const REPO = join(import.meta.dirname, '../../..');
const MAIN = 'packages/server/src/main.ts';
const BACKEND = join(import.meta.dirname, 'fixtures', 'plugin-echo');

interface Daemon {
  child: ChildProcess;
  port: number;
  /** The API's own port when `http.port` gave it one, and -1 otherwise. */
  apiPort: number;
  output(): string;
}

const daemons: Daemon[] = [];

afterEach(async () => {
  for (const one of daemons.splice(0)) {
    one.child.kill('SIGTERM');
    await new Promise<void>((done) => {
      if (one.child.exitCode !== null || one.child.signalCode !== null) { done(); return; }
      const timer = setTimeout(() => { one.child.kill('SIGKILL'); done(); }, 5000);
      one.child.once('exit', () => { clearTimeout(timer); done(); });
    });
  }
});

/** A daemon on an ephemeral port with this configuration, resolved once it announces itself. */
const daemon = (config: unknown, env: Record<string, string> = {}): Promise<Daemon> => new Promise((resolve, reject) => {
  const file = join(folder, 'config.json');
  writeFileSync(file, JSON.stringify(config));
  const child = spawn(
    process.execPath,
    ['--conditions', 'development', '--import', './scripts/dev.mjs', MAIN,
      '--config-file', file, '--port', '0', '--no-update-check', '--connection-token', ROOT_TOKEN],
    { cwd: REPO, env: { ...process.env, XDG_CONFIG_HOME: folder, CI: '1', ...env }, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let output = '';
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill('SIGKILL');
    reject(new Error(`the daemon never announced itself:\n${output}`));
  }, 25000);
  child.stderr.on('data', (chunk: Buffer) => { output += String(chunk); });
  child.stdout.on('data', (chunk: Buffer) => {
    output += String(chunk);
    const ws = /ahpd on ws:\/\/([^\s,]+):(\d+)/u.exec(output);
    if (ws === null || settled) return;
    settled = true;
    clearTimeout(timer);
    const api = /http on http:\/\/[^\s,]+:(\d+)\/api/u.exec(output);
    const one: Daemon = { child, port: Number(ws[2]), apiPort: api === null ? -1 : Number(api[1]), output: () => output };
    daemons.push(one);
    resolve(one);
  });
});

describe('the daemon serves /v1 beside /api, and only while http is on', () => {
  it('answers a call on its own port with http on, never printing the provider\'s key', async () => {
    const fake = await okProvider();
    const one = await daemon({
      http: true,
      plugins: [BACKEND],
      proxy: {
        providers: { fake: { endpoint: fake.endpoint, accepts: ['openai-chat'], key: { env: 'FAKE_PROVIDER_KEY' } } },
        models: { 'fake/model': [{ provider: 'fake', id: 'fake-model' }]},
      },
    }, { FAKE_PROVIDER_KEY: MARKER });
    const got = await send(one.port, CHAT, { headers: asRoot, body: CALL });
    expect(got.status).toBe(200);
    expect(fake.received[0]?.headers['authorization']).toBe(`Bearer ${MARKER}`);
    // The caller's token went nowhere near the provider.
    expect(JSON.stringify(fake.received[0]?.headers)).not.toContain(ROOT_TOKEN);

    // A refusal, a failed call and the log hold no key.
    const refused = await send(one.port, CHAT, { headers: asRoot, body: { ...CALL, model: 'nobody/nothing' } });
    expect(refused.status).toBe(404);
    expect(isOpenAiError(refused.json)).toBe(true);
    await fake.close();
    const down = await send(one.port, CHAT, { headers: asRoot, body: CALL });
    expect(down.status).toBe(502);
    expect(isOpenAiError(down.json)).toBe(true);
    for (const text of [got.text, refused.text, down.text, one.output()]) expect(text).not.toContain(MARKER);
    expect(one.output()).toContain('proxy: root fake/model');
  }, 30000);

  it('moves /v1 with /api to the API\'s own port', async () => {
    const fake = await okProvider();
    const one = await daemon({ http: { port: 0 }, plugins: [BACKEND], proxy: table(fake.endpoint) });
    expect(one.apiPort).toBeGreaterThan(0);
    expect((await send(one.apiPort, CHAT, { headers: asRoot, body: CALL })).status).toBe(200);
    const moved = await send(one.port, CHAT, { headers: asRoot, body: CALL });
    expect(moved.status).toBe(404);
  }, 30000);

  it('answers /v1 with the 404 /api gets while http is off', async () => {
    const one = await daemon({ plugins: [BACKEND] });
    const v1 = await send(one.port, MESSAGES, { headers: asRoot, body: CALL });
    expect(v1.status).toBe(404);
    expect(v1.json).toEqual({ message: `No API at ${MESSAGES}` });
    expect((await send(one.port, '/api/manifest')).status).toBe(404);
  }, 30000);
});
