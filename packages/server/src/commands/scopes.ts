/**
 * The grant check every registry runs before a command body.
 *
 * The terminal's caller is the process owner, who already holds the files and
 * the process, so nothing is checked there. A request's caller is what
 * `authorizeOverHttp` resolved and `serve()` passed on as
 * `context.request.actor`: the deployment's token, which is root, or a person
 * whose grants are held to the command's scopes - decision
 * `ahpd-commands-are-declared-with-cofold-commands`.
 */

import type { AuthorizeRequest } from '@cofold/commands';
import { HttpError } from '@cofold/remote';
import { refusalReason, type Grant, type Principal } from '@ahpd/sdk';
import { isRoot, SIGN_IN } from './authorize.js';

declare module '@cofold/commands' {
  interface CommandMeta {
    /**
     * A command only the deployment's own token may run over HTTP.
     *
     * Installing or removing a plugin runs code in the daemon's process, which
     * no grant a person may hold should confer - decision
     * `installing-a-plugin-over-http-is-root-only`.
     */
    deploymentTokenOnly?: boolean;
  }
}

/** What a person is told when a command belongs to the deployment alone. */
const deploymentOnly = (id: string): string =>
  `${id} may not install or remove a plugin here; only the deployment token may`;

export function checkScopes(request: AuthorizeRequest): void {
  if (request.context.surface === 'cli') return;
  const actor = request.context.request?.actor as Principal | undefined;
  // A request that reached a command with nobody behind it is refused where a
  // credential would have been asked for, rather than served as a stranger.
  if (actor === undefined) throw new HttpError(401, SIGN_IN);
  if (request.command.meta?.deploymentTokenOnly === true && !isRoot(actor)) {
    throw new HttpError(403, deploymentOnly(actor.id));
  }
  const missing = request.scopes.find((one) => !actor.can(one as Grant));
  if (missing !== undefined) throw new HttpError(403, refusalReason(actor.id, missing as Grant));
}
