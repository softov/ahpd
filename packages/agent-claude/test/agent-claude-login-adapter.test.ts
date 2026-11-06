import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Adapter, CodeSignIn, Connector, ViewHandle } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { loginAdapter } from '../src/adapter.js';
import { OpenLogins } from '../src/logins.js';

/*
 * A Claude login as a connector of `claude-login`.
 *
 * A person signs in on claude.ai as `claude setup-token` does and pastes the
 * code the page shows, or puts a token the CLI printed. The sign-in's URLs
 * and client are the CLI's own, read from the CLI 2.1.301 that SDK 0.3.301
 * runs, and its scopes are the CLI's profile and inference scopes. No network is touched: the exchange and the check go out
 * through the `fetch` a test hands over.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-claude/src/index.ts';
const DIR = mkdtempSync(join(tmpdir(), 'ahpd-login-adapter-'));

/** What one fake `fetch` was asked, and the answer or throw it gives. */
const fake = (answer: Response | Error) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
    if (answer instanceof Error) throw answer;
    return answer;
  }) as typeof fetch;
  return { fetch: fetcher, calls };
};

/** A JSON answer, as the token URL sends one. */
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const HEADERS = (init: RequestInit | undefined): Headers => new Headers(init?.headers);

/** The adapter over a record of logins of its own, with a `fetch` that is faked. */
const adapterOf = (fetcher?: typeof fetch, logins = new OpenLogins()): Adapter =>
  // No case touches the network: one that hands no `fetch` gets one that fails, as an offline host's does.
  loginAdapter(logins, { fetch: fetcher ?? fake(new Error('offline')).fetch });

/** The pasted-code sign-in of an adapter, which is the one claude-login declares. */
const signInOf = (adapter: Adapter): CodeSignIn => {
  const signIn = adapter.signIn;
  if (signIn === undefined || signIn.flow === 'device') throw new Error('claude-login has a pasted-code sign-in');
  return signIn;
};

/** One connector of the adapter, as `open` is handed it: the token read back from the vault. */
const connectorOf = (id: string, token: string, owner: Connector['owner'] = 'host'): Connector =>
  ({ id, adapter: 'claude-login', owner, config: { token } });

it('is registered by a load, with its token kept in the vault and a sign-in that fills it', async () => {
  const { problems, options } = await loadPlugins([{ name: SOURCE, options: {} }], {
    base: { path: DIR, agents: [echo({ path: DIR })] },
    configDir: REPO,
    cwd: REPO,
    log: () => {},
  });
  expect(problems).toEqual([]);
  const adapter = options.adapters?.['claude-login'];
  expect(adapter?.title).toBe('Claude login');
  const properties = adapter?.schema['properties'] as Record<string, Record<string, unknown>>;
  expect(properties['token']?.['secret']).toBe(true);
  expect(adapter?.schema['required']).toEqual(['token']);
  expect(adapter?.signIn?.field).toBe('token');
  expect(adapter?.signIn?.title).toBe('Sign in with Claude');
  // The plan usage is shown on the connector's main view, not in a form.
  expect(adapter?.capabilities).toEqual([expect.objectContaining({ type: 'view', name: 'main' })]);
});

describe('the sign-in', () => {
  it('opens the URL claude setup-token opens, with the host\'s challenge and state', () => {
    const url = new URL(signInOf(adapterOf()).url('the-challenge', 'the-state'));
    expect(`${url.origin}${url.pathname}`).toBe('https://claude.com/cai/oauth/authorize');
    expect([...url.searchParams.entries()]).toEqual([
      ['code', 'true'],
      ['client_id', '9d1c250a-e61b-44d9-88ed-5944d1962f5e'],
      ['response_type', 'code'],
      ['redirect_uri', 'https://platform.claude.com/oauth/code/callback'],
      ['scope', 'user:profile user:inference'],
      ['code_challenge', 'the-challenge'],
      ['code_challenge_method', 'S256'],
      ['state', 'the-state'],
    ]);
  });

  it('exchanges the pasted code for a one-year token at Claude\'s token URL', async () => {
    const probe = fake(json({ access_token: 'sk-ant-oat01-made-up', token_type: 'Bearer', expires_in: 31536000 }));
    const adapter = adapterOf(probe.fetch);
    expect(await signInOf(adapter).exchange(' the-code#the-state\n', 'the-verifier')).toBe('sk-ant-oat01-made-up');
    expect(probe.calls).toHaveLength(1);
    expect(probe.calls[0]!.url).toBe('https://platform.claude.com/v1/oauth/token');
    expect(probe.calls[0]!.init?.method).toBe('POST');
    expect(HEADERS(probe.calls[0]!.init).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(probe.calls[0]!.init?.body))).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: 'https://platform.claude.com/oauth/code/callback',
      client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
      code_verifier: 'the-verifier',
      state: 'the-state',
      expires_in: 31536000,
    });
    expect(probe.calls[0]!.init?.redirect).toBe('error');
    expect(probe.calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses a paste without its state, and asks nothing', async () => {
    const probe = fake(json({ access_token: 'unused' }));
    const adapter = adapterOf(probe.fetch);
    await expect(signInOf(adapter).exchange('the-code', 'the-verifier')).rejects.toThrow('both are needed');
    await expect(signInOf(adapter).exchange('#the-state', 'the-verifier')).rejects.toThrow('both are needed');
    expect(probe.calls).toEqual([]);
  });

  it('refuses an exchange with its HTTP status alone, and never the answer', async () => {
    const probe = fake(json({ error: 'invalid_grant', echo: 'the-code the-verifier' }, 400));
    const failure = await signInOf(adapterOf(probe.fetch)).exchange('the-code#the-state', 'the-verifier').then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(String((failure as Error).message)).toBe('HTTP 400');
  });

  it('refuses an answer that names no token', async () => {
    const probe = fake(json({ token_type: 'Bearer' }));
    await expect(signInOf(adapterOf(probe.fetch)).exchange('the-code#the-state', 'the-verifier')).rejects.toThrow('named no token');
  });
});

describe('the check', () => {
  it('counts the tokens of one prompt with the token, as the CLI names an OAuth call', async () => {
    const probe = fake(json({ input_tokens: 8 }));
    const adapter = adapterOf(probe.fetch);
    expect(await adapter.check!(connectorOf('first', 'sk-ant-oat01-first'))).toEqual({ result: 'ok' });
    expect(probe.calls[0]!.url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
    expect(probe.calls[0]!.init?.method).toBe('POST');
    const headers = HEADERS(probe.calls[0]!.init);
    expect(headers.get('authorization')).toBe('Bearer sk-ant-oat01-first');
    expect(headers.get('anthropic-beta')).toBe('oauth-2025-04-20');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(probe.calls[0]!.init?.body))).toEqual({
      model: 'claude-haiku-5-5',
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('says a refused token is denied, any other answer failed, and no answer unreachable', async () => {
    const connector = connectorOf('first', 'sk-ant-oat01-first');
    expect(await adapterOf(fake(new Response('{}', { status: 401 })).fetch).check!(connector))
      .toEqual({ result: 'denied', message: 'HTTP 401' });
    expect(await adapterOf(fake(new Response('{}', { status: 500 })).fetch).check!(connector))
      .toEqual({ result: 'failed', message: 'HTTP 500' });
    expect(await adapterOf(fake(new Error('ECONNREFUSED')).fetch).check!(connector))
      .toEqual({ result: 'unreachable' });
  });
});

describe('an open login', () => {
  it('keeps its token and owner for the engine until it closes', () => {
    const logins = new OpenLogins();
    const adapter = adapterOf(undefined, logins);
    const close = adapter.open(connectorOf('first', 'sk-ant-oat01-first', 'user:ana'));
    expect(logins.held('first')).toEqual({ owner: 'user:ana', token: 'sk-ant-oat01-first' });
    expect(typeof close).toBe('function');
    (close as () => void)();
    expect(logins.held('first')).toBeUndefined();
  });

  it('sets the plan of the account when an answer arrives, with a row for each window', () => {
    const logins = new OpenLogins();
    const shown: Record<string, unknown>[] = [];
    const view: ViewHandle = { showView: () => {}, setViewData: (_path, data) => { shown.push(data as Record<string, unknown>); }, clearView: () => {} };
    adapterOf(undefined, logins).open(connectorOf('first', 'sk-ant-oat01-first'), view);

    logins.noted('first', 'sk-ant-oat01-first', {
      quotaSnapshots: {
        session: { remainingPercentage: 60, resetDate: '2026-11-04T15:00:00.000Z' },
        'weekly:opus': { remainingPercentage: 80 },
      },
      account: { subscriptionType: 'max', apiProvider: 'firstParty' },
    });

    expect(shown).toEqual([{
      plan: 'max',
      windows: [
        { name: 'Session', left: 60, reset: '2026-11-04T15:00:00.000Z' },
        { name: 'Weekly: opus', left: 80 },
      ],
    }]);
  });

  it('sets no window for an account with no plan limits, and no data for a stale token', () => {
    const logins = new OpenLogins();
    const shown: Record<string, unknown>[] = [];
    const view: ViewHandle = { showView: () => {}, setViewData: (_path, data) => { shown.push(data as Record<string, unknown>); }, clearView: () => {} };
    adapterOf(undefined, logins).open(connectorOf('first', 'sk-ant-oat01-first'), view);

    // A token a put replaced speaks for the account it belonged to, not this one.
    logins.noted('first', 'sk-ant-oat01-old', { quotaSnapshots: { weekly: { remainingPercentage: 10 } } });
    expect(shown).toEqual([]);

    // The provider is not a plan, so an account that names no plan type shows none.
    logins.noted('first', 'sk-ant-oat01-first', { quotaSnapshots: {}, account: { apiProvider: 'bedrock' } });
    expect(shown).toEqual([{ windows: [] }]);
  });

  it('asks the profile at open, and shows its masked email and plan before any session', async () => {
    const logins = new OpenLogins();
    const shown: Record<string, unknown>[] = [];
    const view: ViewHandle = { showView: () => {}, setViewData: (_path, data) => { shown.push(data as Record<string, unknown>); }, clearView: () => {} };
    const probe = fake(json({ account: { uuid: 'a-1', email: 'softov@brbyte.com' }, organization: { uuid: 'o-1', organization_type: 'claude_max' } }));
    adapterOf(probe.fetch, logins).open(connectorOf('first', 'sk-ant-oat01-first'), view);
    await new Promise((done) => { setTimeout(done, 0); });

    expect(probe.calls.map((one) => one.url)).toEqual(['https://api.anthropic.com/api/oauth/profile']);
    expect(HEADERS(probe.calls[0]?.init).get('authorization')).toBe('Bearer sk-ant-oat01-first');
    expect(shown).toEqual([{ email: 'so****@brbyte.com', plan: 'max', windows: [] }]);
    expect(logins.scopesOf('first')).toBe('user:profile user:inference');
    // The full email stays in the call: nothing a view holds has it.
    expect(JSON.stringify(shown)).not.toContain('softov@');
  });

  it('takes a refused or empty profile as a token that reads none, and shows nothing of it', async () => {
    for (const answer of [json({ error: 'forbidden' }, 403), json({}), new Error('offline')]) {
      const logins = new OpenLogins();
      const shown: Record<string, unknown>[] = [];
      const view: ViewHandle = { showView: () => {}, setViewData: (_path, data) => { shown.push(data as Record<string, unknown>); }, clearView: () => {} };
      adapterOf(fake(answer).fetch, logins).open(connectorOf('first', 'sk-ant-oat01-first'), view);
      await new Promise((done) => { setTimeout(done, 0); });
      expect(shown).toEqual([]);
      expect(logins.scopesOf('first')).toBeUndefined();
    }
  });

  it('sets the masked email beside the plan', () => {
    const logins = new OpenLogins();
    const shown: Record<string, unknown>[] = [];
    const view: ViewHandle = { showView: () => {}, setViewData: (_path, data) => { shown.push(data as Record<string, unknown>); }, clearView: () => {} };
    adapterOf(undefined, logins).open(connectorOf('first', 'sk-ant-oat01-first'), view);

    logins.noted('first', 'sk-ant-oat01-first', { account: { subscriptionType: 'max' }, email: 'so****@brbyte.com' });
    expect(shown).toEqual([{ email: 'so****@brbyte.com', plan: 'max', windows: [] }]);
  });
});
