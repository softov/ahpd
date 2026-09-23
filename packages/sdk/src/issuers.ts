/**
 * The authorization servers this host accepts a credential from.
 *
 * `fileUsers` compares a hash this host minted, which a client that can only
 * acquire tokens through an OAuth provider cannot use: there is no provider to
 * resolve for a secret this host invented. So a deployment names an issuer, the
 * host advertises it, and the host asks it who a token belongs to.
 *
 * Two are here. GitHub is the one a stock client can already resolve, and an
 * OpenID Connect issuer named by URL is the one an operator with an identity
 * provider actually has.
 *
 * Both ask a `userinfo`-shaped endpoint rather than verifying a JWT, because
 * GitHub issues opaque tokens and this keeps one code path, no key cache and no
 * signing-key dependency.
 */

import type { Issuer } from './types/users.js';

/**
 * How this module reaches the network.
 *
 * Narrower than the global `fetch` on purpose: an issuer needs one GET that
 * answers JSON, and a test made to satisfy the whole of `Response` for a
 * boolean is a test nobody writes.
 */
export interface Fetcher {
  (url: string, init?: { headers?: Record<string, string> }): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
}

/** A GET that answers an object, or nothing for anything that is not one. */
const get = async (fetcher: Fetcher, url: string, token?: string): Promise<Record<string, unknown> | undefined> => {
  try {
    const answer = await fetcher(url, {
      headers: {
        accept: 'application/json',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
    });
    if (!answer.ok) return undefined;
    const held: unknown = await answer.json();
    return typeof held === 'object' && held !== null ? held as Record<string, unknown> : undefined;
  }
  catch {
    // Unreachable is nobody rather than a thrown error: a host that cannot ask
    // does not know, and `-32007` is what not knowing means on the wire.
    return undefined;
  }
};

/** One non-empty string field, or nothing. */
const field = (held: Record<string, unknown> | undefined, name: string): string | undefined => {
  const value = held?.[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/** What `githubIssuer` may be told, for a test or a GitHub-compatible host. */
export interface GitHubIssuerOptions {
  /** How to reach it. Defaults to the global `fetch`. */
  fetch?: Fetcher;
  /** The issuer identifier. Default `https://github.com/login/oauth`. */
  id?: string;
  /** Where its user endpoint is. Default `https://api.github.com/user`. */
  endpoint?: string;
  /** The scopes to ask for. Default `['read:user']`. */
  scopes?: readonly string[];
}

/**
 * GitHub, which is the issuer a stock client can already resolve.
 *
 * Its OAuth has no discovery document and no `sub`, so the endpoint and the
 * field are fixed and the subject is the login.
 */
export const githubIssuer = (options: GitHubIssuerOptions = {}): Issuer => {
  const fetcher = options.fetch ?? fetch as Fetcher;
  const endpoint = options.endpoint ?? 'https://api.github.com/user';
  return {
    id: options.id ?? 'https://github.com/login/oauth',
    scopes: options.scopes ?? ['read:user'],
    subject: async (token) => field(await get(fetcher, endpoint, token), 'login'),
  };
};

/** What `oidcIssuer` may be told. */
export interface OidcIssuerOptions {
  /** The issuer identifier, which is also where its metadata is discovered. */
  issuer: string;
  /** How to reach it. Defaults to the global `fetch`. */
  fetch?: Fetcher;
  /** The scopes to ask for. Default `['openid']`. */
  scopes?: readonly string[];
  /** A userinfo endpoint already known, so a test needs no discovery. */
  userinfo?: string;
}

/**
 * An OpenID Connect issuer, named by URL.
 *
 * Its metadata is discovered once from the well-known path, and the answer is
 * kept only when it names an https endpoint: the document is remote, and a
 * person's bearer token must not be sent over anything less. Discovery that
 * fails is tried again on the next sign-in rather than cached as a failure.
 */
export const oidcIssuer = (options: OidcIssuerOptions): Issuer => {
  const fetcher = options.fetch ?? fetch as Fetcher;
  let known: string | undefined;
  const userinfo = async (): Promise<string | undefined> => {
    if (options.userinfo !== undefined) return options.userinfo;
    if (known !== undefined) return known;
    const at = `${options.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
    const endpoint = field(await get(fetcher, at), 'userinfo_endpoint');
    if (endpoint !== undefined && endpoint.startsWith('https://')) known = endpoint;
    return known;
  };
  return {
    id: options.issuer,
    scopes: options.scopes ?? ['openid'],
    subject: async (token) => {
      const endpoint = await userinfo();
      return endpoint === undefined ? undefined : field(await get(fetcher, endpoint, token), 'sub');
    },
  };
};
