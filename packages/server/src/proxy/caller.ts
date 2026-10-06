/**
 * Who a proxy call is, and whether they may make it.
 *
 * A person's own tool sends its credential the way its vendor's SDK does:
 * `Authorization: Bearer` from an OpenAI client, `x-api-key` from Claude Code
 * and the Anthropic SDKs. Either one is checked in the order the API checks a
 * request: the deployment token is root; then a session's own token, asked of
 * `whose`, which is in memory and so asked before anything that may ask an
 * issuer over the network; then a person, verified by the directory, still on
 * file, and holding the grant the call needs.
 *
 * A person's work is charged to a team and project, named in `X-AHP-Scope` or
 * `?scope=` or else their primary, resolved by `scopeFor` as a session's is.
 */

import { refusalReason, scopeFor, type Grant, type Owner, type Principal, type Scope, type Users } from '@ahpd/sdk';
import { same } from '../commands/authorize.js';
import type { Refusal } from './dialects.js';

/**
 * A session's own token, as `whose` answers it.
 *
 * The session, chat and turn the token was handed to, so a record of the call
 * can be matched with the session meter's record of the same turn; who the
 * session belongs to and what it is charged to, for the policy and the record.
 */
export interface SessionCaller {
  /** The session the token belongs to. */
  session: string;
  /** The chat within it, when the token is a chat's. */
  chat?: string;
  /** The turn the call is made in, when known. */
  turn?: string;
  /** Who the session's work belongs to. */
  owner?: Owner;
  /** The person the session runs for, whose policies a call is held to. Absent: nobody to check. */
  principal?: Principal;
  /** The team and project the session is charged to. */
  scope?: Scope;
}

/** Who a call is. */
export type ProxyCaller =
  | { kind: 'root' }
  | { kind: 'person'; principal: Principal; scope?: Scope }
  | ({ kind: 'session' } & SessionCaller);

/** What a caller is checked against. */
export interface CallerOptions {
  /** The deployment's own token, which is root. */
  token?: string;
  /** The people who may call. Absent: only the deployment token and `whose` answer. */
  users?: Users;
  /** The session a token belongs to, or nothing when it is no session's. */
  whose?(token: string): SessionCaller | undefined;
}

/** A caller, or why the call is refused. */
export type Called = { caller: ProxyCaller } | { refusal: Refusal };

/** The header a scope is named in. */
export const SCOPE_HEADER = 'x-ahp-scope';

/** The credential a request presented, `Bearer` first; `false` when it presented two different ones. */
const credentialOf = (headers: Headers): string | undefined | false => {
  const bearer = /^Bearer\s+(.+)$/iu.exec(headers.get('authorization') ?? '')?.[1]?.trim();
  const key = headers.get('x-api-key')?.trim();
  const given = [bearer, key].filter((one): one is string => one !== undefined && one !== '');
  const [first, second] = given;
  if (first !== undefined && second !== undefined && !same(first, second)) return false;
  return first;
};

/** How a caller is named in a log line: never their credential. */
export const callerName = (caller: ProxyCaller): string =>
  caller.kind === 'root' ? 'root' : caller.kind === 'person' ? caller.principal.id : `session ${caller.session}`;

/**
 * Who sent `request`, holding `grant`, or the refusal.
 *
 * 401 for no credential and one this host does not know; 400 for two that
 * disagree, since one of them is not this caller's; 403 for a person without
 * `grant` or naming a scope they are not in. Root and a session are not asked
 * for a grant or a scope: a session's scope is the one `whose` answered.
 */
export async function callerOf(request: Request, options: CallerOptions, grant: Grant): Promise<Called> {
  const presented = credentialOf(request.headers);
  if (presented === false) {
    return { refusal: { status: 400, message: 'Authorization and x-api-key name different credentials; send one' } };
  }
  if (presented !== undefined && options.token !== undefined && same(options.token, presented)) return { caller: { kind: 'root' } };
  if (presented !== undefined) {
    const session = options.whose?.(presented);
    if (session !== undefined) return { caller: { kind: 'session', ...session } };
  }
  if (options.users === undefined) return { refusal: { status: 401, message: 'A connection token is required' } };
  if (presented === undefined) return { refusal: { status: 401, message: 'Sign in to use this host' } };

  let who: Principal | undefined;
  try { who = await options.users.verify(presented); }
  catch { who = undefined; }
  if (who === undefined) return { refusal: { status: 401, message: 'That credential is not one this host knows' } };
  // Removed since the token was minted: the directory re-reads its file, so
  // this is current as of this call.
  if (who.standing !== undefined && !who.standing()) return { refusal: { status: 401, message: 'Sign in to use this host' } };
  if (!who.can(grant)) return { refusal: { status: 403, message: refusalReason(who.id, grant) } };

  const named = request.headers.get(SCOPE_HEADER) ?? new URL(request.url).searchParams.get('scope') ?? undefined;
  const answer = scopeFor(who, named);
  if (answer?.refusal !== undefined) return { refusal: { status: 403, message: answer.refusal } };
  return { caller: { kind: 'person', principal: who, ...(answer?.scope === undefined ? {} : { scope: answer.scope }) } };
}
