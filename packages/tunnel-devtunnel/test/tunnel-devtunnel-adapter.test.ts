import { describe, expect, it, vi } from 'vitest';
import { withViewData } from '@ahpd/sdk';
import { checkView } from '../../sdk/src/plugins/view.js';
import type { Adapter, Connector, DeviceSignIn, PluginView, ViewHandle } from '@ahpd/sdk';
import {
  ACCESS_TOKEN_URL, ACCOUNT_URL, CLIENT_ID, DEVICE_CODE_URL,
  devtunnelAdapter, OpenTunnels, TUNNEL_VIEW, TUNNELS_URL,
} from '../src/adapter.js';

/*
 * The `devtunnel` adapter, against a fake `fetch`.
 *
 * No GitHub and no Dev Tunnels service is reached: each call is answered from
 * a queue by URL, so the device flow can be walked through pending, slow-down
 * and approval in one case. None of the values here is real, and nothing a
 * case checks ever reads one out of a log.
 */

/** One answer a fake URL gives. */
interface Answer {
  status?: number;
  body?: unknown;
}

/**
 * A fake `fetch`, with one queue of answers per URL.
 *
 * The last answer of a queue is reused, which is what a check called twice
 * needs. Every call is kept, so a case can read what went out.
 */
const fake = () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const answers = new Map<string, Answer[]>();
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
    const queue = answers.get(String(url));
    const answer = (queue !== undefined && queue.length > 1 ? queue.shift() : queue?.[0]) ?? {};
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof globalThis.fetch;
  const on = (url: string, ...given: Answer[]): void => {
    answers.set(url, [...(answers.get(url) ?? []), ...given]);
  };
  return { fetch, calls, on };
};

/** The form one POST carried. */
const formOf = (init: RequestInit | undefined): URLSearchParams => new URLSearchParams(String(init?.body));

/** The headers one call carried. */
const headersOf = (init: RequestInit | undefined): Headers => new Headers(init?.headers);

/** The device sign-in the adapter declares. */
const signInOf = (adapter: Adapter): DeviceSignIn => {
  const signIn = adapter.signIn;
  if (signIn === undefined || signIn.flow !== 'device') throw new Error('devtunnel declares a device sign-in');
  return signIn;
};

/** One connector, as `open` and `check` are handed it: the secrets read back from the vault. */
const connectorOf = (id: string, config: Record<string, unknown>): Connector =>
  ({ id, adapter: 'devtunnel', owner: 'host', config });

/**
 * A view handle that keeps the view as the host would, the data model after
 * each call, and the paths each `setViewData` set.
 */
const viewOf = (): { view: ViewHandle; shown: Record<string, unknown>[]; paths: string[] } => {
  const shown: Record<string, unknown>[] = [];
  const paths: string[] = [];
  let held: PluginView | undefined;
  return {
    shown,
    paths,
    view: {
      showView: (one) => { held = one; shown.push(one.dataModel ?? {}); },
      setViewData: (path, value) => {
        if (held === undefined) return;
        paths.push(path);
        held = withViewData(held, path, value);
        shown.push(held.dataModel ?? {});
      },
      clearView: () => { held = undefined; },
    },
  };
};

/** The start answer GitHub gives for the made-up code every case uses. */
const STARTED: Answer = {
  body: {
    device_code: 'the-handle',
    user_code: 'AB-12',
    verification_uri: 'https://github.com/login/device',
    expires_in: 900,
    interval: 5,
  },
};

describe('the registration', () => {
  it('marks both tokens secret, keeps the account plain, and requires both tokens', () => {
    const adapter = devtunnelAdapter(new OpenTunnels());
    const properties = adapter.schema['properties'] as Record<string, Record<string, unknown>>;
    expect(properties['token']?.['secret']).toBe(true);
    expect(properties['refresh']?.['secret']).toBe(true);
    expect(properties['account']?.['secret']).toBeUndefined();
    expect(adapter.schema['required']).toEqual(['token', 'refresh']);
    const signIn = signInOf(adapter);
    expect(signIn.title).toBe('Sign in with GitHub');
    expect(signIn.field).toBe('token');
    expect(signIn.account).toBe('account');
  });

  it('lets a sign-in change the account only when the option says so', () => {
    expect(signInOf(devtunnelAdapter(new OpenTunnels())).switchAccount).toBe(false);
    expect(signInOf(devtunnelAdapter(new OpenTunnels(), { allowAccountChange: true })).switchAccount).toBe(true);
  });

  it('shows the account and the last refresh as key values, which the host check passes', () => {
    expect(TUNNEL_VIEW.components['accountName']).toMatchObject({ component: 'KeyValue', label: 'Account', value: { path: '/account' } });
    expect(TUNNEL_VIEW.components['refreshed']).toMatchObject({ component: 'KeyValue', label: 'Last refresh', child: 'refreshedAt' });
    expect(TUNNEL_VIEW.components['refreshedAt']).toMatchObject({ component: 'DateTime', value: { path: '/refreshed' }, format: 'datetime' });
    expect(() => { checkView({ ...TUNNEL_VIEW, dataModel: { account: 'octocat' } }, 'main', 'tunnel-devtunnel', {}); }).not.toThrow();
  });

  it('declares a main view: the account it signed in as, and its last refresh', () => {
    const adapter = devtunnelAdapter(new OpenTunnels());
    expect(adapter.capabilities).toEqual([{
      type: 'view',
      name: 'main',
      title: 'Account',
      description: 'The GitHub account this connector signed in as, and when its token last refreshed.',
    }]);
  });
});

describe('the device sign-in', () => {
  it('shows GitHub\'s code and waits as GitHub asks until the approval', async () => {
    const probe = fake();
    probe.on(DEVICE_CODE_URL, STARTED);
    probe.on(
      ACCESS_TOKEN_URL,
      { body: { error: 'authorization_pending' } },
      { body: { error: 'slow_down' } },
      { body: { error: 'authorization_pending' } },
      { body: { access_token: 'gho_made-up', refresh_token: 'ghr_made-up', expires_in: 28800 } },
    );
    probe.on(ACCOUNT_URL, { body: { login: 'ana' } });
    const signIn = signInOf(devtunnelAdapter(new OpenTunnels(), { fetch: probe.fetch }));

    expect(await signIn.start()).toEqual({
      code: 'AB-12',
      url: 'https://github.com/login/device',
      expires: 900,
      interval: 5,
      handle: 'the-handle',
    });
    expect(probe.calls[0]!.url).toBe(DEVICE_CODE_URL);
    expect(probe.calls[0]!.init?.method).toBe('POST');
    const started = formOf(probe.calls[0]!.init);
    expect(started.get('client_id')).toBe(CLIENT_ID);
    expect(started.get('scope')).toBe('tunnels');

    // Pending keeps the interval, slow-down adds five seconds to it, and the
    // next pending answer carries the raised wait.
    expect(await signIn.poll('the-handle')).toEqual({ wait: 5 });
    expect(await signIn.poll('the-handle')).toEqual({ wait: 10 });
    expect(await signIn.poll('the-handle')).toEqual({ wait: 10 });
    expect(await signIn.poll('the-handle')).toEqual({
      values: { token: 'gho_made-up', refresh: 'ghr_made-up', account: 'ana' },
    });

    const poll = formOf(probe.calls[1]!.init);
    expect(probe.calls[1]!.url).toBe(ACCESS_TOKEN_URL);
    expect(poll.get('client_id')).toBe(CLIENT_ID);
    expect(poll.get('device_code')).toBe('the-handle');
    expect(poll.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
    const account = probe.calls.at(-1)!;
    expect(account.url).toBe(ACCOUNT_URL);
    expect(headersOf(account.init).get('authorization')).toBe('Bearer gho_made-up');
  });

  it('slows down on GitHub\'s 429 as on slow_down, and keeps polling', async () => {
    const probe = fake();
    probe.on(DEVICE_CODE_URL, STARTED);
    probe.on(ACCESS_TOKEN_URL, { status: 429 }, { body: { error: 'authorization_pending' } });
    const signIn = signInOf(devtunnelAdapter(new OpenTunnels(), { fetch: probe.fetch }));
    const started = await signIn.start();

    expect(await signIn.poll(started.handle)).toEqual({ wait: 10 });
    expect(await signIn.poll(started.handle)).toEqual({ wait: 10 });
  });

  it('ends the sign-in on a refusal, and names neither the handle nor the code', async () => {
    const probe = fake();
    probe.on(DEVICE_CODE_URL, STARTED);
    probe.on(ACCESS_TOKEN_URL, { body: { error: 'access_denied' } });
    const signIn = signInOf(devtunnelAdapter(new OpenTunnels(), { fetch: probe.fetch }));
    await signIn.start();

    const failure = await signIn.poll('the-handle').then(() => undefined, (error: unknown) => error);
    const message = String((failure as Error).message);
    expect(message).toContain('access_denied');
    expect(message).not.toContain('the-handle');
    expect(message).not.toContain('AB-12');
  });

  it('refuses an approval that comes with no refresh token', async () => {
    const probe = fake();
    probe.on(DEVICE_CODE_URL, STARTED);
    probe.on(ACCESS_TOKEN_URL, { body: { access_token: 'gho_made-up' } });
    const signIn = signInOf(devtunnelAdapter(new OpenTunnels(), { fetch: probe.fetch }));
    await signIn.start();
    await expect(signIn.poll('the-handle')).rejects.toThrow('no refresh token');
  });
});

describe('the check', () => {
  it('lists the account\'s tunnels with the token, and says ok or denied', async () => {
    const probe = fake();
    probe.on(TUNNELS_URL, { body: { tunnels: [] } }, { status: 401 });
    const adapter = devtunnelAdapter(new OpenTunnels(), { fetch: probe.fetch });

    expect(await adapter.check!(connectorOf('ana', { token: 'gho_made-up' }))).toEqual({ result: 'ok' });
    expect(probe.calls[0]!.url).toBe(TUNNELS_URL);
    expect(headersOf(probe.calls[0]!.init).get('authorization')).toBe('github gho_made-up');

    expect(await adapter.check!(connectorOf('ana', { token: 'gho_made-up' })))
      .toEqual({ result: 'denied', message: 'HTTP 401' });
  });

  it('uses the token an open connector holds, which a refresh made newer than the record\'s', async () => {
    const probe = fake();
    probe.on(TUNNELS_URL, { body: { tunnels: [] } });
    const tunnels = new OpenTunnels();
    tunnels.hold('ana', { owner: 'host', token: 'gho_refreshed' });
    const adapter = devtunnelAdapter(tunnels, { fetch: probe.fetch });

    await adapter.check!(connectorOf('ana', { token: 'gho_stored' }));
    expect(headersOf(probe.calls[0]!.init).get('authorization')).toBe('github gho_refreshed');
  });
});

describe('an open connector', () => {
  it('shows the account it signed in as when it opens, with no call to the service', () => {
    const probe = fake();
    const tunnels = new OpenTunnels();
    const { view, shown } = viewOf();
    const close = devtunnelAdapter(tunnels, { fetch: probe.fetch })
      .open(connectorOf('ana', { token: 'gho_only', account: 'ana' }), view);

    expect(shown).toEqual([{ account: 'ana' }]);
    expect(probe.calls).toEqual([]);
    (close as () => void)();
  });

  it('sets the time of a refresh once the pair is stored', async () => {
    const probe = fake();
    probe.on(ACCESS_TOKEN_URL, { body: { access_token: 'gho_new', refresh_token: 'ghr_new', expires_in: 28800 } });
    const stored: string[] = [];
    const { view, shown, paths } = viewOf();
    const close = devtunnelAdapter(new OpenTunnels(), {
      fetch: probe.fetch,
      secret: async () => { stored.push('stored'); },
    }).open(connectorOf('ana', { token: 'gho_old', refresh: 'ghr_old', account: 'ana' }), view);

    // The open shows the account alone, before its refresh answers.
    expect(shown).toEqual([{ account: 'ana' }]);
    await vi.waitFor(() => { expect(shown).toHaveLength(2); });
    expect(stored).toHaveLength(1);
    expect(paths).toEqual(['/refreshed']);
    const drawn = shown[1]!;
    expect(drawn['account']).toBe('ana');
    const refreshed = String(drawn['refreshed']);
    expect(new Date(refreshed).toISOString()).toBe(refreshed);
    (close as () => void)();
  });

  it('refreshes at open, stores both new values, and keeps the new token', async () => {
    const probe = fake();
    probe.on(ACCESS_TOKEN_URL, { body: { access_token: 'gho_new', refresh_token: 'ghr_new', expires_in: 28800 } });
    const sent: { id: string; values: Record<string, string> }[] = [];
    const tunnels = new OpenTunnels();
    const adapter = devtunnelAdapter(tunnels, {
      fetch: probe.fetch,
      secret: async (id, values) => { sent.push({ id, values }); },
    });

    const close = adapter.open(connectorOf('ana', { token: 'gho_old', refresh: 'ghr_old' }));
    expect(tunnels.held('ana')).toEqual({ owner: 'host', token: 'gho_old', refresh: 'ghr_old' });
    await vi.waitFor(() => { expect(sent).toHaveLength(1); });

    expect(sent[0]).toEqual({ id: 'ana', values: { token: 'gho_new', refresh: 'ghr_new' } });
    expect(tunnels.held('ana')).toEqual({ owner: 'host', token: 'gho_new', refresh: 'ghr_new' });
    const body = formOf(probe.calls[0]!.init);
    expect(probe.calls[0]!.url).toBe(ACCESS_TOKEN_URL);
    expect(body.get('client_id')).toBe(CLIENT_ID);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('ghr_old');

    (close as () => void)();
    expect(tunnels.held('ana')).toBeUndefined();
  });

  it('waits for the open\'s refresh before a check, so a start checks with the new token', async () => {
    const probe = fake();
    probe.on(ACCESS_TOKEN_URL, { body: { access_token: 'gho_new', refresh_token: 'ghr_new', expires_in: 28800 } });
    probe.on(TUNNELS_URL, { body: { tunnels: [] } });
    // GitHub answers the refresh only once the case lets it.
    let answer: () => void = () => {};
    const gate = new Promise<void>((resolve) => { answer = resolve; });
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === ACCESS_TOKEN_URL) await gate;
      return probe.fetch(url, init);
    }) as typeof globalThis.fetch;
    const tunnels = new OpenTunnels();
    const adapter = devtunnelAdapter(tunnels, { fetch, secret: async () => {} });
    const connector = connectorOf('ana', { token: 'gho_old', refresh: 'ghr_old' });

    const close = adapter.open(connector);
    const checked = adapter.check!(connector);
    await Promise.resolve();
    expect(probe.calls.some((call) => call.url === TUNNELS_URL)).toBe(false);
    answer();

    await expect(checked).resolves.toEqual({ result: 'ok' });
    const call = probe.calls.find((one) => one.url === TUNNELS_URL);
    expect(headersOf(call!.init).get('authorization')).toBe('github gho_new');
    (close as () => void)();
  });

  it('answers the service\'s token only after the open\'s refresh, so a tunnel started at boot uses the new one', async () => {
    const probe = fake();
    probe.on(ACCESS_TOKEN_URL, { body: { access_token: 'gho_new', refresh_token: 'ghr_new', expires_in: 28800 } });
    let answer: () => void = () => {};
    const gate = new Promise<void>((resolve) => { answer = resolve; });
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === ACCESS_TOKEN_URL) await gate;
      return probe.fetch(url, init);
    }) as typeof globalThis.fetch;
    const tunnels = new OpenTunnels();
    const adapter = devtunnelAdapter(tunnels, { fetch, secret: async () => {} });

    const close = adapter.open(connectorOf('ana', { token: 'gho_old', refresh: 'ghr_old' }));
    let token: string | undefined;
    const read = tunnels.ready('ana').then((open) => { token = open?.token; });
    await Promise.resolve();
    expect(token).toBeUndefined();
    answer();

    await read;
    expect(token).toBe('gho_new');
    (close as () => void)();
  });

  it('stops waiting for a refresh once its connector closes', async () => {
    const probe = fake();
    // GitHub never answers this refresh.
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === ACCESS_TOKEN_URL) await new Promise(() => {});
      return probe.fetch(url, init);
    }) as typeof globalThis.fetch;
    const tunnels = new OpenTunnels();
    const adapter = devtunnelAdapter(tunnels, { fetch, secret: async () => {} });

    const close = adapter.open(connectorOf('ana', { token: 'gho_old', refresh: 'ghr_old' }));
    (close as () => void)();

    await expect(tunnels.ready('ana')).resolves.toBeUndefined();
  });

  it('logs one line on a failed refresh and asks for a check, with no token in the line', async () => {
    const probe = fake();
    probe.on(ACCESS_TOKEN_URL, { status: 400, body: { error: 'bad_refresh_token', echo: 'gho_old ghr_old' } });
    const lines: string[] = [];
    const checked: string[] = [];
    const tunnels = new OpenTunnels();
    const adapter = devtunnelAdapter(tunnels, {
      fetch: probe.fetch,
      log: (line) => { lines.push(line); },
      check: (id) => { checked.push(id); },
    });

    const close = adapter.open(connectorOf('ana', { token: 'gho_old', refresh: 'ghr_old' }));
    await vi.waitFor(() => { expect(checked).toEqual(['ana']); });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('could not refresh its token');
    expect(lines[0]).toContain('HTTP 400');
    expect(lines.join(' ')).not.toContain('gho_old');
    expect(lines.join(' ')).not.toContain('ghr_old');
    // A token that could not be refreshed is still the one the connector holds.
    expect(tunnels.held('ana')).toEqual({ owner: 'host', token: 'gho_old', refresh: 'ghr_old' });

    (close as () => void)();
  });

  it('refreshes again at two thirds of the lifetime GitHub gives, and an hour on when it gives none', async () => {
    vi.useFakeTimers();
    try {
      const probe = fake();
      probe.on(
        ACCESS_TOKEN_URL,
        { body: { access_token: 'gho_1', refresh_token: 'ghr_1', expires_in: 28800 } },
        { body: { access_token: 'gho_2', refresh_token: 'ghr_2' } },
        { body: { access_token: 'gho_3', refresh_token: 'ghr_3' } },
      );
      const refreshes = (): number => probe.calls.filter((call) => call.url === ACCESS_TOKEN_URL).length;
      const tunnels = new OpenTunnels();
      const close = devtunnelAdapter(tunnels, { fetch: probe.fetch, secret: async () => {} })
        .open(connectorOf('ana', { token: 'gho_old', refresh: 'ghr_old' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(refreshes()).toBe(1);

      // Eight hours' lifetime, so the next refresh is at five hours and twenty minutes.
      await vi.advanceTimersByTimeAsync(28800 * 1000 * 2 / 3 - 1000);
      expect(refreshes()).toBe(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(refreshes()).toBe(2);
      expect(tunnels.held('ana')?.token).toBe('gho_2');

      // That answer gave no lifetime, so the next is an hour on.
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000 - 2000);
      expect(refreshes()).toBe(2);
      await vi.advanceTimersByTimeAsync(2000);
      expect(refreshes()).toBe(3);
      (close as () => void)();
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('tries a failed refresh again in ten seconds, and stops at a 4xx', async () => {
    vi.useFakeTimers();
    try {
      const probe = fake();
      probe.on(
        ACCESS_TOKEN_URL,
        { status: 502 },
        { status: 401 },
        { body: { access_token: 'gho_never', refresh_token: 'ghr_never', expires_in: 28800 } },
      );
      const refreshes = (): number => probe.calls.filter((call) => call.url === ACCESS_TOKEN_URL).length;
      const checked: string[] = [];
      const close = devtunnelAdapter(new OpenTunnels(), {
        fetch: probe.fetch,
        check: (id) => { checked.push(id); },
      }).open(connectorOf('ana', { token: 'gho_old', refresh: 'ghr_old' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(refreshes()).toBe(1);

      await vi.advanceTimersByTimeAsync(10_000);
      expect(refreshes()).toBe(2);
      // GitHub no longer takes the token, so nothing is asked of it again.
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(refreshes()).toBe(2);
      expect(checked).toEqual(['ana', 'ana']);
      (close as () => void)();
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('has nothing to refresh when the record holds no refresh token', async () => {
    const probe = fake();
    const tunnels = new OpenTunnels();
    const close = devtunnelAdapter(tunnels, { fetch: probe.fetch })
      .open(connectorOf('ana', { token: 'gho_only' }));

    await new Promise((done) => { setTimeout(done, 10); });
    expect(probe.calls).toEqual([]);
    expect(tunnels.held('ana')).toEqual({ owner: 'host', token: 'gho_only' });

    (close as () => void)();
  });
});
