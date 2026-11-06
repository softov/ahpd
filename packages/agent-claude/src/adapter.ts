/**
 * The `claude-login` adapter: one Claude login as a connector.
 *
 * A person makes one by signing in on claude.ai, as `claude setup-token` does,
 * or by putting a token `claude setup-token` printed. The host keeps the token
 * in its vault, and hands it back to `open`, which keeps it for the engine. A
 * put of the same id replaces the token, and a remove takes the login away.
 */

import { probe, PROBE_TIMEOUT_MS } from '@ahpd/sdk';
import type { Adapter, Connector } from '@ahpd/sdk';
import type { SDKUsageReport } from '@anthropic-ai/claude-agent-sdk';
import { LOGIN_ADAPTER, PROFILE_SCOPES, type LoginProfile, type OpenLogins } from './logins.js';
import { snapshotsOf, usageOf } from './usage.js';

/*
 * Claude Code's own sign-in for a long-lived token, as the CLI 2.1.301 that
 * SDK 0.3.301 runs holds it: the claude.ai authorize URL, the token URL, the
 * code page and the client id of its `builtInOauthConfig`; and its
 * `LONG_LIVED_OAUTH_TOKEN_TTL_SECONDS`, the expiry it asks the token URL for.
 * https://code.claude.com/docs/en/authentication#generate-a-long-lived-token
 *
 * The scopes are `CLAUDE_AI_PROFILE_SCOPE` and `CLAUDE_AI_INFERENCE_SCOPE`,
 * where `setup-token` asks the second alone. Without the profile scope the CLI
 * reads no email and no plan type of the account, and its usage request answers
 * no plan limits, so a login's view could show nothing of either.
 */
const AUTHORIZE_URL = 'https://claude.com/cai/oauth/authorize';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CODE_PAGE = 'https://platform.claude.com/oauth/code/callback';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const SCOPE = PROFILE_SCOPES;
const YEAR_SECONDS = 31_536_000;

/** The API a login's token is for, and the version a call to it names. */
const API = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * The model a check counts tokens for: one the API serves now.
 *
 * The API answers a refused token with 401 before it reads the model, so the
 * model decides nothing about the token; a model it retires answers 404, and
 * the check says so.
 */
const CHECK_MODEL = 'claude-haiku-5-5';

/**
 * The plan type each organization type of a profile names, as the CLI maps it.
 * A type not in the map names no plan.
 */
const PLANS: Readonly<Record<string, string>> = {
  claude_max: 'max',
  claude_pro: 'pro',
  claude_team: 'team',
  claude_enterprise: 'enterprise',
};

/** The value as one object, or an empty one. */
const objectOf = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

/**
 * What a token's profile says of its account, or nothing when the token may
 * not read it or the call fails.
 *
 * The call is the CLI's own: `GET /api/oauth/profile` with the token as a
 * bearer. The answer is `{ account: { uuid, email }, organization: { uuid,
 * organization_type, ... } }`, as the CLI 2.1.301 checks it. A token without
 * `user:profile` is refused, and that refusal is what tells a session the
 * token reads no profile.
 */
export const profileOf = async (token: string, fetcher: typeof fetch): Promise<LoginProfile | undefined> => {
  try {
    const answer = await fetcher(`${API}/api/oauth/profile`, {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'cache-control': 'no-cache' },
      redirect: 'error',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!answer.ok) {
      await answer.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const held = objectOf(await answer.json() as unknown);
    // The CLI refuses an answer with no account, and so does this.
    const account = objectOf(held['account']);
    if (Object.keys(account).length === 0) return undefined;
    const email = account['email'];
    const type = objectOf(held['organization'])['organization_type'];
    const plan = typeof type === 'string' ? PLANS[type] : undefined;
    return {
      ...(typeof email === 'string' && email !== '' ? { email } : {}),
      ...(plan === undefined ? {} : { plan }),
    };
  }
  catch {
    return undefined;
  }
};

/** The beta the CLI names on a call it makes with an OAuth token: its `OAUTH_BETA_HEADER`. */
const OAUTH_BETA = 'oauth-2025-04-20';

/** What the adapter is built with. */
export interface LoginAdapterOptions {
  /** The `fetch` the exchange and the check go out through. The global one when absent. */
  fetch?: typeof fetch;
  /** What reads a token's usage report without a session: a one-shot `/usage` query when absent. */
  usage?: (token: string, scopes: string) => Promise<SDKUsageReport | undefined>;
}

/** The token a connector holds, which the form requires and a record written by hand may not. */
const tokenOf = (connector: Connector): string => {
  const token = connector.config['token'];
  if (typeof token !== 'string' || token === '') throw new Error(`${connector.id} holds no token`);
  return token;
};

/**
 * The code and the state a person pasted.
 *
 * The code page shows `<code>#<state>`, and the CLI takes nothing less: a
 * paste without both halves is refused before the token URL is asked, as the
 * CLI's own manual entry refuses it.
 */
const pastedOf = (pasted: string): { code: string; state: string } => {
  const [code, state] = pasted.trim().split('#');
  if (code === undefined || code === '' || state === undefined || state === '') {
    throw new Error('the code page shows the code and its state together, and both are needed');
  }
  return { code, state };
};

/** The `claude-login` adapter, over the logins one load keeps. */
export function loginAdapter(logins: OpenLogins, options: LoginAdapterOptions = {}): Adapter {
  const fetcher = options.fetch ?? globalThis.fetch;
  const readUsage = options.usage ?? usageOf;
  /**
   * Read one open login's usage without a session, and set it on its view.
   * Only a token whose profile answered has the scopes a report needs, and a
   * read that gives nothing changes nothing.
   */
  const measure = async (id: string, token: string): Promise<void> => {
    const scopes = logins.scopesOf(id);
    if (scopes === undefined || logins.held(id)?.token !== token) return;
    const report = await readUsage(token, scopes).catch(() => undefined);
    const snapshots = report === undefined ? undefined : snapshotsOf(report);
    if (snapshots !== undefined) logins.measured(id, token, snapshots);
  };
  return {
    name: LOGIN_ADAPTER,
    title: 'Claude login',
    description: 'One Claude account, which a Claude agent signs in with.',
    schema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          minLength: 1,
          secret: true,
          title: 'Token',
          description: 'A token from claude setup-token. A sign-in fills it, and the vault keeps it.',
        },
      },
      required: ['token'],
    },
    capabilities: [{
      type: 'view',
      name: 'main',
      title: 'Plan usage',
      description: 'The account this login signs in to, its plan, and what is left of each window.',
    }],
    icons: [{ src: './icon.svg' }],
    /*
     * The profile is asked once at each open: its answer says whether the
     * token reads it, and gives the email and the plan type before a session.
     */
    open: (connector, view) => {
      const stop = logins.opened(connector, view);
      const token = tokenOf(connector);
      void profileOf(token, fetcher).then(async (profile) => {
        if (profile === undefined) return;
        logins.profiled(connector.id, token, profile);
        await measure(connector.id, token);
      });
      return stop;
    },
    /*
     * A count of one prompt's tokens with the token: a model request that
     * costs nothing, since a `setup-token` token makes model requests and
     * nothing else. The CLI counts tokens the same way with its own OAuth
     * token, and the API refuses an invalid token there with 401.
     * https://code.claude.com/docs/en/authentication#generate-a-long-lived-token
     */
    check: async (connector) => {
      const token = tokenOf(connector);
      // A check reads the plan again too, for a login whose profile answered.
      void measure(connector.id, token);
      return probe(
        `${API}/v1/messages/count_tokens`,
        { authorization: `Bearer ${token}`, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-beta': OAUTH_BETA },
        fetcher,
        { model: CHECK_MODEL, messages: [{ role: 'user', content: 'hi' }] },
      );
    },
    /*
     * The sign-in is the CLI's `setup-token` on the code page: a person signs
     * in on claude.ai, the page shows the code, and the host exchanges what
     * they paste here, as it exchanges an OpenRouter code.
     */
    signIn: {
      title: 'Sign in with Claude',
      field: 'token',
      url: (challenge: string, state: string) => {
        // The CLI's own parameters, in its own order.
        const url = new URL(AUTHORIZE_URL);
        url.searchParams.append('code', 'true');
        url.searchParams.append('client_id', CLIENT_ID);
        url.searchParams.append('response_type', 'code');
        url.searchParams.append('redirect_uri', CODE_PAGE);
        url.searchParams.append('scope', SCOPE);
        url.searchParams.append('code_challenge', challenge);
        url.searchParams.append('code_challenge_method', 'S256');
        url.searchParams.append('state', state);
        return url.toString();
      },
      exchange: async (pasted: string, verifier: string) => {
        const { code, state } = pastedOf(pasted);
        const answer = await fetcher(TOKEN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            code,
            redirect_uri: CODE_PAGE,
            client_id: CLIENT_ID,
            code_verifier: verifier,
            state,
            expires_in: YEAR_SECONDS,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (!answer.ok) {
          // The body may quote the code, so a refusal is its status and nothing else.
          await answer.body?.cancel().catch(() => undefined);
          throw new Error(`HTTP ${String(answer.status)}`);
        }
        const held = await answer.json() as unknown;
        const token = typeof held === 'object' && held !== null ? (held as Record<string, unknown>)['access_token'] : undefined;
        if (typeof token !== 'string' || token === '') throw new Error('the answer named no token');
        return token;
      },
    },
  };
}
