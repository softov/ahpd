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

import type { Issuer, IssuerAnswer } from './types/users.js';

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

/**
 * The whole answer, when it named a subject in the field this issuer uses.
 *
 * The claims travel with it, because a record that reads its roles out of one
 * would otherwise need a second request for the same sign-in.
 */
const answer = (held: Record<string, unknown> | undefined, name: string): IssuerAnswer | undefined => {
  const subject = field(held, name);
  return held === undefined || subject === undefined ? undefined : { subject, claims: held };
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
    who: async (token) => answer(await get(fetcher, endpoint, token), 'login'),
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

/** Whether a URL names this machine. */
const loopbackUrl = (value: string): boolean =>
  /^https?:\/\/(?:127\.0\.0\.1|\[::1\]|localhost)(?::\d+)?(?:[/?#]|$)/i.test(value);

/**
 * Whether this host may send a person's credential to a URL.
 *
 * https anywhere, and plain http only on loopback. A self-hosted issuer is
 * common and on loopback nothing leaves the machine; a remote one over http
 * would put a bearer token in clear - decision
 * `an-issuer-may-be-plain-http-on-loopback`.
 */
export const isIssuerUrl = (value: string): boolean => {
  if (/^https:\/\/[^\s#]+$/.test(value)) return true;
  return /^http:\/\/[^\s#]+$/.test(value) && loopbackUrl(value);
};

/**
 * An OpenID Connect issuer, named by URL.
 *
 * Its metadata is discovered once from the well-known path, and the answer is
 * kept only when it names an endpoint this host may send a token to: https, or
 * plain http on loopback. Discovery that fails is tried again on the next
 * sign-in rather than cached as a failure.
 */
export const oidcIssuer = (options: OidcIssuerOptions): Issuer => {
  const fetcher = options.fetch ?? fetch as Fetcher;
  let known: string | undefined;
  const userinfo = async (): Promise<string | undefined> => {
    if (options.userinfo !== undefined) return options.userinfo;
    if (known !== undefined) return known;
    const at = `${options.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
    const endpoint = field(await get(fetcher, at), 'userinfo_endpoint');
    if (endpoint !== undefined && isIssuerUrl(endpoint)) known = endpoint;
    return known;
  };
  return {
    id: options.issuer,
    scopes: options.scopes ?? ['openid'],
    who: async (token) => {
      const endpoint = await userinfo();
      return endpoint === undefined ? undefined : answer(await get(fetcher, endpoint, token), 'sub');
    },
  };
};

/**
 * The kind of authorization server a name is.
 *
 * `github` is the preset a stock client can resolve with no work at all, and a
 * URL this host may reach is an OpenID Connect issuer whose metadata is
 * discovered. Anything else answers nothing, so a configuration refuses the
 * start and a record is reported rather than silently never verifying. The
 * rule is here so the daemon's `issuer` key and a record's own `issuer` field
 * cannot disagree about what a name means.
 */
export type IssuerKind = { kind: 'github' } | { kind: 'oidc'; issuer: string };

/** What a name turned out to be, or nothing when this host may not reach it. */
export const issuerKind = (value: string): IssuerKind | undefined => {
  if (value === 'github') return { kind: 'github' };
  return isIssuerUrl(value) ? { kind: 'oidc', issuer: value } : undefined;
};

/**
 * An authorization server, named the way a configuration or a record names one.
 *
 * A test that wants no network passes its own resolver through
 * `FileUserOptions.issuerFor` instead of using this.
 */
export const issuerFrom = (value: string, fetcher?: Fetcher): Issuer | undefined => {
  const kind = issuerKind(value);
  if (kind === undefined) return undefined;
  const reach = fetcher === undefined ? {} : { fetch: fetcher };
  return kind.kind === 'github' ? githubIssuer(reach) : oidcIssuer({ issuer: kind.issuer, ...reach });
};
