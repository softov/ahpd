/**
 * The `devtunnel` adapter: one GitHub account's Dev Tunnels access.
 *
 * A person makes a connector by signing in to the Dev Tunnels service's GitHub
 * app on their own device, so no `devtunnel` CLI and no password ever reaches
 * this host. The app answers a token and a refresh token, the host keeps both
 * in its vault, and the account it signed in as stays in the record beside
 * them.
 *
 * A token lasts eight hours, and a daemon that was down longer wakes with one
 * that has expired. So an open connector refreshes at once, which is why the
 * vault has the refresh token too, and then keeps its token alive as VS Code's
 * CLI does: again at two thirds of the lifetime GitHub's answer gives the new
 * token, an hour on when it gives none, and ten seconds after a refresh that
 * failed. The rotated pair is written back through `x-ahpd/connectors/secret`,
 * before the token is used for anything, so a restart finds the pair that
 * still works.
 *
 * Every open connector's token is kept in memory, by id, for the tunnel kind
 * that uses it. Nothing here reads it back from the vault itself: the host
 * hands `open` the resolved config and this file keeps it.
 */

import { probe, PROBE_TIMEOUT_MS, reason } from '@ahpd/sdk';
import type {
  Adapter, CheckResult, Connector, ConnectorOwner, DeviceSignInPoll, DeviceSignInStart, PluginView,
} from '@ahpd/sdk';
import type { LogLevel } from '@ahpd/sdk';

/**
 * The Dev Tunnels service's GitHub app, from the SDK's
 * `ts/src/contracts/tunnelServiceProperties.ts`: `Iv1.e7b89e013f801f03`.
 *
 * It is the app the `devtunnel` CLI and VS Code sign in with, so a connector
 * made here is the same account they see. A client id is public, as it is in
 * every OAuth client, and no client secret is needed for the device flow.
 * https://github.com/microsoft/dev-tunnels/blob/b73b0eb774b/ts/src/contracts/tunnelServiceProperties.ts#L111-L116
 */
export const CLIENT_ID = 'Iv1.e7b89e013f801f03';

/** The scope the app's `gitHubAppScopes` names. */
export const SCOPE = 'tunnels';

/** Where a device sign-in starts, and where its approval is asked for. */
export const DEVICE_CODE_URL = 'https://github.com/login/device/code';

/** Where the token, its refresh and each poll answer. */
export const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

/** The account a token belongs to. */
export const ACCOUNT_URL = 'https://api.github.com/user';

/**
 * The Dev Tunnels management API, as the service's `serviceUri` spells it.
 *
 * The check lists the account's tunnels, which needs the token and nothing
 * else. https://github.com/microsoft/dev-tunnels/blob/b73b0eb774b/ts/src/contracts/tunnelServiceProperties.ts
 */
export const TUNNELS_URL = 'https://global.rel.tunnels.api.visualstudio.com/api/v1/tunnels';

/**
 * What a `devtunnel` connector shows on its `main` view, with no data: the
 * account it signed in as, and the time of the last refresh of its token.
 *
 * Both are what the connector already holds, so the adapter shows them with no
 * call to the service. A connector that has not refreshed since it opened
 * shows no time, and a path the data does not hold draws nothing.
 */
export const TUNNEL_VIEW: PluginView = {
  root: 'account',
  components: {
    account: { id: 'account', component: 'Column', children: ['accountName', 'refreshed'] },
    accountName: { id: 'accountName', component: 'KeyValue', label: 'Account', value: { path: '/account' } },
    // The time is the line's value, shown in the reader's own zone.
    refreshed: { id: 'refreshed', component: 'KeyValue', label: 'Last refresh', child: 'refreshedAt' },
    refreshedAt: { id: 'refreshedAt', component: 'DateTime', value: { path: '/refreshed' }, format: 'datetime' },
  },
};

/** The grant type a device poll and a refresh name. */
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const REFRESH_GRANT = 'refresh_token';

/** How long GitHub's answer lasts when it names no interval, in seconds. */
const DEFAULT_INTERVAL = 5;

/** How much a `slow_down` adds to the wait, in seconds, as RFC 8628 says. */
const SLOW_DOWN = 5;

/**
 * How many waits are kept for sign-ins nobody finished.
 *
 * The host forgets a sign-in at its code's expiry, and it does not tell the
 * adapter, so this map is the one place an abandoned flow could pile up. The
 * oldest go first, and a code older than a hundred started sign-ins is long
 * expired.
 */
const INTERVALS_KEPT = 100;

/**
 * When an open connector refreshes again, in milliseconds, as VS Code's CLI
 * keeps its token alive: an hour when GitHub's answer gives the token no
 * lifetime, and never sooner than ten seconds, which is also the wait after a
 * refresh that failed.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/cli/src/auth.rs#L849-L904
 */
export const DEFAULT_REFRESH_MS = 60 * 60 * 1000;
export const MIN_REFRESH_MS = 10_000;

/**
 * An answer that was not 2xx, by its status alone.
 *
 * The body may quote the code or a token, so the status is all it says; a
 * caller reads the status to tell a token GitHub no longer takes from a call
 * that failed on the way.
 */
class StatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`HTTP ${String(status)}`);
    this.status = status;
  }
}

/** The line every log of this adapter starts with. */
const NAME = 'tunnel-devtunnel';

/** One open connector's token, as the tunnel kind reads it. */
export interface OpenTunnel {
  /** Whose connector it is, so the tunnel kind can answer with the same boundary. */
  owner: ConnectorOwner;
  /** The token a call to the service goes out with. */
  token: string;
  /** The token that makes the next one, when the record holds one. */
  refresh?: string;
}

/**
 * The tokens of the connectors a load holds open, by id.
 *
 * Written by `open` and read by the tunnel kind that follows. The map is the
 * whole of what the rest of the package may see: a token is answered as one
 * string, and the vault is still the thing that survives a restart.
 */
export class OpenTunnels {
  readonly #held = new Map<string, OpenTunnel>();
  /** The refresh each open connector is running now, by connector id. */
  readonly #refreshing = new Map<string, Promise<void>>();

  /** The token of one open connector, or nothing when it is not open. */
  held(id: string): OpenTunnel | undefined {
    return this.#held.get(id);
  }

  /**
   * The token of one open connector once the refresh it runs now has ended.
   *
   * A connector opens with the vault's token and refreshes it at once, and a
   * daemon that was down longer than a token lasts opens with one that has
   * expired. A tunnel enabled at boot starts in that same moment, so every
   * call to the service and every check reads its token here.
   */
  async ready(id: string): Promise<OpenTunnel | undefined> {
    await this.#refreshing.get(id);
    return this.#held.get(id);
  }

  /** Note the refresh one connector runs now, which `ready` waits for. */
  refreshing(id: string, run: Promise<void>): void {
    this.#refreshing.set(id, run);
  }

  /** Stop waiting for one refresh, when it ends or its connector closes. */
  settled(id: string, run: Promise<void>): void {
    if (this.#refreshing.get(id) === run) this.#refreshing.delete(id);
  }

  /** The ids of every connector this load holds open. */
  ids(): string[] {
    return [...this.#held.keys()];
  }

  /** Keep one connector's token until it closes. */
  hold(id: string, tunnel: OpenTunnel): void {
    this.#held.set(id, tunnel);
  }

  /** Forget one connector, when it closes. */
  release(id: string): void {
    this.#held.delete(id);
  }
}

/** What the adapter is built with. */
export interface DevtunnelAdapterOptions {
  /** The `fetch` every GitHub and service call goes out through. The global one when absent. */
  fetch?: typeof fetch;
  /** Whether a second sign-in may replace the account of an existing connector. */
  allowAccountChange?: boolean;
  /**
   * Write a refreshed pair to the vault, as `x-ahpd/connectors/secret` does.
   *
   * The plugin's own connection supplies it. Absent, a refresh is used and
   * not written back, which is what a test without a host needs.
   */
  secret?: (id: string, values: Record<string, string>) => Promise<void>;
  /** Ask the host to check one connector again, as `x-ahpd/connectors/check` does. */
  check?: (id: string) => void | Promise<void>;
  /** Where the one line of a failed refresh goes. */
  log?: (line: string, level?: LogLevel) => void;
}

/** A non-empty string, or nothing. */
const textOf = (value: unknown): string | undefined =>
  (typeof value === 'string' && value !== '' ? value : undefined);

/** A positive number, or nothing. */
const secondsOf = (value: unknown): number | undefined =>
  (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);

/** The token a record holds, which the form requires. */
const tokenOf = (connector: Connector): string => {
  const token = textOf(connector.config['token']);
  if (token === undefined) throw new Error(`${connector.id} holds no token`);
  return token;
};

/** The `devtunnel` adapter, over the tokens one load keeps open. */
export function devtunnelAdapter(tunnels: OpenTunnels, options: DevtunnelAdapterOptions = {}): Adapter {
  const fetcher = options.fetch ?? globalThis.fetch;
  const log = options.log ?? (() => {});
  /*
   * The wait the host polls at, by device code.
   *
   * GitHub's start answer names it, and a `slow_down` raises it. The host
   * sends only the handle on a poll, so the number has to be kept here.
   */
  const intervals = new Map<string, number>();

  /** Keep one handle's wait, dropping the oldest when nobody finished them. */
  const remember = (handle: string, wait: number): void => {
    if (!intervals.has(handle) && intervals.size >= INTERVALS_KEPT) {
      const oldest = intervals.keys().next().value;
      if (oldest !== undefined) intervals.delete(oldest);
    }
    intervals.set(handle, wait);
  };

  /** Read one answer as an object, or refuse it with its status alone. */
  const bodyOf = async (answer: Response): Promise<Record<string, unknown>> => {
    if (!answer.ok) {
      await answer.body?.cancel().catch(() => undefined);
      throw new StatusError(answer.status);
    }
    const held = await answer.json() as unknown;
    if (typeof held !== 'object' || held === null || Array.isArray(held)) {
      throw new Error('the answer was not an object');
    }
    return held as Record<string, unknown>;
  };

  /** Post one form to GitHub, and answer what came back. */
  const send = (url: string, fields: Record<string, string>): Promise<Response> => fetcher(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    redirect: 'error',
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });

  /** Post one form to GitHub, and read its JSON answer. */
  const post = async (url: string, fields: Record<string, string>): Promise<Record<string, unknown>> =>
    bodyOf(await send(url, fields));

  /** The login a token belongs to, as GitHub's user API names it. */
  const accountOf = async (token: string): Promise<string> => {
    const held = await bodyOf(await fetcher(ACCOUNT_URL, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    }));
    const login = textOf(held['login']);
    if (login === undefined) throw new Error('the account answer named no login');
    return login;
  };

  /** Start a device sign-in on GitHub, and answer what a person is shown. */
  const start = async (): Promise<DeviceSignInStart> => {
    const held = await post(DEVICE_CODE_URL, { client_id: CLIENT_ID, scope: SCOPE });
    const code = textOf(held['user_code']);
    const url = textOf(held['verification_uri']);
    const handle = textOf(held['device_code']);
    const expires = secondsOf(held['expires_in']);
    const interval = secondsOf(held['interval']) ?? DEFAULT_INTERVAL;
    if (code === undefined || url === undefined || handle === undefined || expires === undefined) {
      throw new Error('GitHub answered no device code');
    }
    remember(handle, interval);
    return { code, url, expires, interval, handle };
  };

  /**
   * Ask once whether the person approved, and answer what that means.
   *
   * GitHub answers a poll that came too soon with a 429 as well as with
   * `slow_down`, and VS Code's CLI slows down for both.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/cli/src/auth.rs#L827-L837
   */
  const poll = async (handle: string): Promise<DeviceSignInPoll> => {
    const answered = await send(ACCESS_TOKEN_URL, {
      client_id: CLIENT_ID,
      device_code: handle,
      grant_type: DEVICE_GRANT,
    });
    const wait = intervals.get(handle) ?? DEFAULT_INTERVAL;
    if (answered.status === 429) {
      await answered.body?.cancel().catch(() => undefined);
      const slower = wait + SLOW_DOWN;
      remember(handle, slower);
      return { wait: slower };
    }
    const held = await bodyOf(answered);
    const error = textOf(held['error']);
    if (error !== undefined) {
      if (error === 'authorization_pending') return { wait };
      if (error === 'slow_down') {
        const slower = wait + SLOW_DOWN;
        remember(handle, slower);
        return { wait: slower };
      }
      intervals.delete(handle);
      // The code is the person's and the handle is a credential, so neither is said.
      throw new Error(`GitHub refused the sign-in: ${error}`);
    }
    const token = textOf(held['access_token']);
    const refresh = textOf(held['refresh_token']);
    if (token === undefined) throw new Error('GitHub answered no token');
    if (refresh === undefined) throw new Error('GitHub answered no refresh token');
    const account = await accountOf(token);
    intervals.delete(handle);
    return { values: { token, refresh, account } };
  };

  /**
   * Trade the refresh token for a new pair.
   *
   * A device-flow token is refreshed with the client id alone: the app has no
   * client secret to send. https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
   */
  const refreshed = async (refresh: string): Promise<{ token: string; refresh: string; expires?: number }> => {
    const held = await post(ACCESS_TOKEN_URL, {
      client_id: CLIENT_ID,
      grant_type: REFRESH_GRANT,
      refresh_token: refresh,
    });
    const token = textOf(held['access_token']);
    const next = textOf(held['refresh_token']) ?? refresh;
    const expires = secondsOf(held['expires_in']);
    if (token === undefined) throw new Error('GitHub answered no token');
    return { token, refresh: next, ...(expires === undefined ? {} : { expires }) };
  };

  return {
    name: 'devtunnel',
    title: 'Dev Tunnel',
    description: 'One GitHub account, whose Dev Tunnels a connector hosts.',
    schema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          minLength: 1,
          secret: true,
          title: 'Access token',
          description: 'The Dev Tunnels token a sign-in answers. The vault keeps it, and the plugin refreshes it.',
        },
        refresh: {
          type: 'string',
          minLength: 1,
          secret: true,
          title: 'Refresh token',
          description: 'The token that makes the next access token. The vault keeps it, and it is replaced on every refresh.',
        },
        account: {
          type: 'string',
          title: 'Account',
          description: 'The GitHub login the connector signed in as, which a second sign-in from another account is held against.',
        },
      },
      required: ['token', 'refresh'],
    },
    capabilities: [{
      type: 'view',
      name: 'main',
      title: 'Account',
      description: 'The GitHub account this connector signed in as, and when its token last refreshed.',
    }],
    /*
     * A token with no tunnel listing behind it is a token the service does not
     * take, so one list of the account's tunnels is the whole check. The
     * service reads a GitHub token under its own `github` scheme, not `Bearer`.
     * An open connector is checked with the token it holds, which a refresh
     * may have made newer than the one the vault answered at the open. A start
     * checks while the open's refresh may still run, and the vault's token may
     * have expired by then, so the check waits for that refresh first.
     */
    check: async (connector): Promise<CheckResult> => {
      const open = await tunnels.ready(connector.id);
      return probe(
        TUNNELS_URL,
        { accept: 'application/json', authorization: `github ${open?.token ?? tokenOf(connector)}` },
        fetcher,
      );
    },
    signIn: {
      flow: 'device',
      title: 'Sign in with GitHub',
      field: 'token',
      account: 'account',
      switchAccount: options.allowAccountChange === true,
      start,
      poll,
    },
    open: (connector, view) => {
      const id = connector.id;
      const token = tokenOf(connector);
      const refresh = textOf(connector.config['refresh']);
      const account = textOf(connector.config['account']);
      tunnels.hold(id, { owner: connector.owner, token, ...(refresh === undefined ? {} : { refresh }) });
      let stopped = false;
      /** This open's refresh while it runs, which `tunnels` holds too. */
      let running: Promise<void> | undefined;
      /** The next refresh, once one is set. */
      let timer: ReturnType<typeof setTimeout> | undefined;
      // The account the record holds; the time of a refresh is set when one stores a pair.
      view?.showView({ ...TUNNEL_VIEW, dataModel: account === undefined ? {} : { account } });

      /** Ask the host to check this connector, as a failed refresh does. */
      const checkNow = (): void => {
        void Promise.resolve().then(() => options.check?.(id)).catch(() => undefined);
      };

      /** Refresh again in `ms`, never sooner than the CLI's ten seconds. */
      const again = (ms: number): void => {
        if (stopped) return;
        timer = setTimeout(() => { void rotate(); }, Math.max(ms, MIN_REFRESH_MS));
        timer.unref?.();
      };

      /**
       * Rotate the pair, store it, and only then use it.
       *
       * The old refresh token stops working the moment GitHub answers, so the
       * new one goes to the vault before the map is changed. A send that fails
       * is one line: the new pair is still the only one that works, so it is
       * used and the next refresh tries to store its pair again.
       */
      const rotate = (): Promise<void> => {
        if (stopped) return Promise.resolve();
        if (running !== undefined) return running;
        const now = tunnels.held(id);
        if (now?.refresh === undefined) return Promise.resolve();
        const run = exchange(now.refresh).finally(() => {
          running = undefined;
          tunnels.settled(id, run);
        });
        running = run;
        tunnels.refreshing(id, run);
        return run;
      };

      /**
       * Trade one refresh token, store the pair, hold it, and set the next.
       *
       * The next refresh is at two thirds of the new token's lifetime, as VS
       * Code's CLI sets it. A refresh that fails asks the host to check the
       * connector; a 4xx is a token GitHub no longer takes, which ends the
       * refreshing as it ends the CLI's, and anything else is tried again in
       * ten seconds.
       */
      const exchange = async (refresh: string): Promise<void> => {
        try {
          const next = await refreshed(refresh);
          try {
            await options.secret?.(id, { token: next.token, refresh: next.refresh });
          }
          catch (error) {
            log(`${NAME}: connector ${id} keeps its refreshed token but the vault was not written: ${reason(error)}`, 'warn');
          }
          if (stopped) return;
          const still = tunnels.held(id);
          if (still === undefined) return;
          tunnels.hold(id, { ...still, token: next.token, refresh: next.refresh });
          view?.setViewData('/refreshed', new Date().toISOString());
          again(next.expires === undefined ? DEFAULT_REFRESH_MS : next.expires * 1000 * 2 / 3);
        }
        catch (error) {
          log(`${NAME}: connector ${id} could not refresh its token: ${reason(error)}`, 'error');
          checkNow();
          if (!(error instanceof StatusError && error.status >= 400 && error.status < 500)) again(MIN_REFRESH_MS);
        }
      };

      void rotate();
      return () => {
        stopped = true;
        clearTimeout(timer);
        // A refresh that outlives this open must not hold back the next open's calls.
        if (running !== undefined) tunnels.settled(id, running);
        tunnels.release(id);
      };
    },
  };
}
