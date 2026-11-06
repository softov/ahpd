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
import { LOGIN_ADAPTER, type OpenLogins } from './logins.js';

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
const SCOPE = 'user:profile user:inference';
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

/** The beta the CLI names on a call it makes with an OAuth token: its `OAUTH_BETA_HEADER`. */
const OAUTH_BETA = 'oauth-2025-04-20';

/** What the adapter is built with. */
export interface LoginAdapterOptions {
  /** The `fetch` the exchange and the check go out through. The global one when absent. */
  fetch?: typeof fetch;
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
    open: (connector, view) => logins.opened(connector, view),
    /*
     * A count of one prompt's tokens with the token: a model request that
     * costs nothing, since a `setup-token` token makes model requests and
     * nothing else. The CLI counts tokens the same way with its own OAuth
     * token, and the API refuses an invalid token there with 401.
     * https://code.claude.com/docs/en/authentication#generate-a-long-lived-token
     */
    check: async (connector) => probe(
      `${API}/v1/messages/count_tokens`,
      { authorization: `Bearer ${tokenOf(connector)}`, 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-beta': OAUTH_BETA },
      fetcher,
      { model: CHECK_MODEL, messages: [{ role: 'user', content: 'hi' }] },
    ),
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
