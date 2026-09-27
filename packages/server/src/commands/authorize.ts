/**
 * Who a request is.
 *
 * `Authorization: Bearer <token>` names either the deployment's own token,
 * which is root, or a person, who is verified the way `authenticate` verifies
 * one. What this answers is passed on by `serve()` as `context.request.actor`,
 * and the registry's `authorize` hook holds that caller to the command's
 * scopes: identifying and allowing are separate questions, and only the second
 * needs the declaration.
 *
 * `HttpError` is what `serve()` maps to a status: 401 for no credentials or a
 * credential this host does not know. A missing grant is the registry hook's
 * 403, carrying the sentence the WebSocket gives - decision
 * `the-http-api-is-on-the-daemon-port-under-api`.
 */

import { timingSafeEqual } from 'node:crypto';
import { HttpError, type ServeRequest } from '@cofold/remote';
import type { Principal, Users } from '@ahpd/sdk';

/** What the hook is built from: who may be here. */
export interface AuthorizeOptions {
  /** The deployment's own token. Absent is a host that never configured one. */
  token?: string;
  /** The people who may sign in. Absent is a host that never configured one. */
  users?: Users;
}

/** A caller who holds every grant, which is what the deployment's own token is. */
export const ROOT: Principal = {
  id: 'the deployment token',
  roles: [],
  can: () => true,
};

/** Whether a caller is the deployment's own token, rather than a person. */
export const isRoot = (actor: unknown): boolean => actor === ROOT;

/** What a request with no credential is told, by the door and by the grant hook. */
export const SIGN_IN = 'Sign in to use this host';

/** The bearer a request presented, or nothing. */
const bearer = (headers: ServeRequest['headers']): string | undefined => {
  const raw = headers.authorization;
  const held = Array.isArray(raw) ? raw[0] : raw;
  return /^Bearer\s+(.+)$/iu.exec(held ?? '')?.[1];
};

/**
 * Two secrets compared without stopping at the first difference.
 *
 * The lengths still differ observably, which is why a token is generated rather
 * than chosen: they are all the same length. The same comparison the door
 * makes, because the same secret is being presented.
 */
const same = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * The hook `serve()` asks once per request, before the command runs.
 *
 * The order is the door's: the deployment's own token first, because it is the
 * host and needs no directory; then, with a directory, a person's token. A host
 * with neither is refused at startup, so there is no case here where nobody is
 * asking and everybody is admitted.
 */
export function authorizeOverHttp(options: AuthorizeOptions): (request: ServeRequest) => Promise<unknown> {
  return async (request) => {
    const presented = bearer(request.headers);
    // The deployment's key is the host, exactly as it is on the socket.
    if (options.token !== undefined && presented !== undefined && same(options.token, presented)) return ROOT;
    /*
     * No directory: the connection token is the whole of who may be here, and a
     * request without it is refused the way the handshake refuses one.
     */
    if (options.users === undefined) throw new HttpError(401, 'A connection token is required');
    if (presented === undefined || presented === '') throw new HttpError(401, SIGN_IN);
    const who: Principal | undefined = await options.users.verify(presented);
    if (who === undefined) throw new HttpError(401, 'That credential is not one this host knows');
    // Removed since they signed in: the directory re-reads its file on every
    // question, so the answer is current as of this request.
    if (who.standing !== undefined && !who.standing()) throw new HttpError(401, 'Sign in to use this host');
    return who;
  };
}
