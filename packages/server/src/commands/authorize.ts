/**
 * Who a request is, and what it may do.
 *
 * The HTTP API runs the same commands as the terminal under the same grants, so
 * this asks the WebSocket's question once per request rather than once per
 * connection: `Authorization: Bearer <token>` names either the deployment's own
 * token, which is root, or a person, who is verified the way `authenticate`
 * verifies one and whose scopes are then checked against the command's.
 *
 * A refusal carries the sentence the WebSocket gives, so a client cannot tell
 * the two doors apart - decision `the-http-api-is-on-the-daemon-port-under-api`.
 * `HttpError` is what `serve()` maps to a status: 401 for no credentials or a
 * credential this host does not know, 403 for a grant that is missing.
 */

import { timingSafeEqual } from 'node:crypto';
import { HttpError, type ServeRequest } from '@cofold/remote';
import type { Runner } from '@cofold/commands';
import { refusalReason, type Grant, type Principal, type Users } from '@ahpd/sdk';

/** What the hook is built from: the scopes to check, and who may be here. */
export interface AuthorizeOptions {
  /** The registry the command's scopes are read off. */
  registry: Runner;
  /** The deployment's own token. Absent is a host that never configured one. */
  token?: string;
  /** The people who may sign in. Absent is a host that never configured one. */
  users?: Users;
}

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
 * host and needs no directory; then, with a directory, a person's token; and
 * with neither, a request is admitted the way a socket is - a host that
 * configured no token and no people has no gate to hold.
 */
export function authorizeOverHttp(options: AuthorizeOptions): (request: ServeRequest) => Promise<void> {
  return async (request) => {
    const presented = bearer(request.headers);
    // The deployment's key is the host, exactly as it is on the socket.
    if (options.token !== undefined && presented !== undefined && same(options.token, presented)) return;
    /*
     * No directory: the connection token is the whole of who may be here, and a
     * request without it is refused the way the handshake refuses one. A host
     * that configured neither a token nor a directory is loopback-only and had
     * no gate before this, so it keeps none.
     */
    if (options.users === undefined) {
      if (options.token === undefined) return;
      throw new HttpError(401, 'A connection token is required');
    }
    if (presented === undefined || presented === '') throw new HttpError(401, 'Sign in to use this host');
    const who: Principal | undefined = await options.users.verify(presented);
    if (who === undefined) throw new HttpError(401, 'That credential is not one this host knows');
    // Removed since they signed in: the directory re-reads its file on every
    // question, so the answer is current as of this request.
    if (who.standing !== undefined && !who.standing()) throw new HttpError(401, 'Sign in to use this host');
    const needed = options.registry.scopesFor?.(request.command) ?? request.command.scopes ?? [];
    const missing = needed.find((one) => !who.can(one as Grant));
    if (missing !== undefined) throw new HttpError(403, refusalReason(who.id, missing as Grant));
  };
}
