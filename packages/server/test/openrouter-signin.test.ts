import { describe, expect, it } from 'vitest';
import type { Adapter, CodeSignIn } from '@ahpd/sdk';
import { hostAdapters } from '../src/proxy/adapters.js';

/*
 * The OpenRouter sign-in the host ships.
 *
 * A person signs in on OpenRouter's own page and pastes the code back, and the
 * host exchanges it for a key. The two URLs are OpenRouter's public ones, so a
 * connector's `endpoint` never moves a sign-in or an exchange anywhere else.
 *
 * No network is touched: the exchange goes out through the `fetch` a test hands
 * over.
 */

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

/** A JSON answer, as OpenRouter sends one. */
const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** The OpenRouter adapter, with an exchange that would reach the network if it were not faked. */
const openrouter = (fetcher?: typeof fetch): Adapter =>
  hostAdapters({ ...(fetcher === undefined ? {} : { fetch: fetcher }) })['openrouter']!;

/** The pasted-code sign-in of an adapter, which is the one OpenRouter declares. */
const signInOf = (adapter: Adapter): CodeSignIn => {
  const signIn = adapter.signIn;
  if (signIn === undefined || signIn.flow === 'device') throw new Error('openrouter has a pasted-code sign-in');
  return signIn;
};

const HEADERS = (init: RequestInit | undefined): Headers => new Headers(init?.headers);

describe('the OpenRouter sign-in', () => {
  it('names the button and the field the exchange fills', () => {
    const adapter = openrouter();
    expect(adapter.signIn?.title).toBe('Sign in with OpenRouter');
    expect(adapter.signIn?.field).toBe('key');
    // The field the exchange fills is the one the schema keeps in the vault.
    const properties = adapter.schema as { properties: Record<string, Record<string, unknown>> };
    expect(properties.properties['key']?.['secret']).toBe(true);
  });

  it('answers OpenRouter\'s own page with the challenge, the S256 method, the state and no callback', () => {
    const adapter = openrouter();
    const url = new URL(signInOf(adapter).url('the-challenge', 'the-state'));
    expect(`${url.origin}${url.pathname}`).toBe('https://openrouter.ai/auth');
    expect(url.searchParams.get('code_challenge')).toBe('the-challenge');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('the-state');
    expect(url.searchParams.get('key_label')).toBe('ahpd');
    // A callback makes OpenRouter answer the host directly; a person pastes the code instead.
    expect(url.searchParams.has('callback_url')).toBe(false);
  });

  it('exchanges the code at OpenRouter\'s fixed keys URL and answers the key', async () => {
    const probe = fake(json({ key: 'sk-or-new' }));
    const adapter = openrouter(probe.fetch);

    expect(await signInOf(adapter).exchange('the-code', 'the-verifier')).toBe('sk-or-new');
    expect(probe.calls).toHaveLength(1);
    expect(probe.calls[0]!.url).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(probe.calls[0]!.init?.method).toBe('POST');
    expect(HEADERS(probe.calls[0]!.init).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(probe.calls[0]!.init?.body))).toEqual({
      code: 'the-code',
      code_verifier: 'the-verifier',
      code_challenge_method: 'S256',
    });
    expect(probe.calls[0]!.init?.redirect).toBe('error');
    expect(probe.calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('refuses an exchange with its HTTP status alone, and never the vendor\'s body', async () => {
    const probe = fake(json({ error: 'no', echo: 'the-code the-verifier' }, 400));
    const adapter = openrouter(probe.fetch);

    const refusal = await signInOf(adapter).exchange('the-code', 'the-verifier').then(
      () => new Error('the exchange answered'),
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toBe('HTTP 400');
    expect((refusal as Error).message).not.toContain('the-code');
    expect((refusal as Error).message).not.toContain('the-verifier');
  });

  it('refuses an answer with no string key, and never the body', async () => {
    for (const answer of [{ error: 'the vendor body' }, { key: 42 }, { key: '' }]) {
      const adapter = openrouter(fake(json(answer)).fetch);
      const refusal = await signInOf(adapter).exchange('the-code', 'the-verifier').then(
        () => new Error('the exchange answered'),
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(Error);
      expect((refusal as Error).message).toBe('the answer named no key');
      expect((refusal as Error).message).not.toContain('the vendor body');
    }
  });
});
