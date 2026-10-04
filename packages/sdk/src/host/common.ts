import { RpcError, METHOD_NOT_FOUND } from '../rpc.js';

/**
 * A port this host was not given.
 *
 * Refused the way anything else it does not have is refused, and with the same
 * words: a host without a filesystem does not serve `resourceRead`, and saying
 * so is what lets a client draw the screen it can rather than wait for one it
 * cannot.
 */
export const need = <T>(port: T | undefined, method: string): T => {
  if (port === undefined)
    throw new RpcError(METHOD_NOT_FOUND, `This host does not serve ${method} yet`);
  return port;
};

export const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What a request that would start something is refused with once the host is closing. */
export const CLOSING = 'This host is closing, so nothing new starts on it';

/**
 * The character that turns a message into a command.
 *
 * The protocol standardises the convention rather than the behaviour: a host
 * advertises what it recognises, and `"!"` is what every implementation uses.
 * A lone `!`, or one followed only by spaces, is not a command - it is
 * somebody typing an exclamation mark, and it goes to the agent.
 */
export const BANG = '!';

/**
 * The config properties this host owns, rather than the backend.
 *
 * The protocol's schema is deliberately generic - a backend advertises
 * whatever names it likes - and these seven are the conventional ones the
 * *host* answers, named in the reference client's `sessionConfigKeys.ts` as
 * host-owned and "not passed to agents". So they are merged over what the
 * backend said and stripped back out before it is handed anything.
 *
 * `scope` is an eighth of the same kind, and is offered whenever there is a
 * person rather than only under a `worktrees` port.
 */
export const HOSTS_OWN = [
  'isolation', 'branch', 'worktreeIncludeFiles', 'worktreeSymlinkFolders',
  'worktreeBranchPrefix', 'worktreeCreateNewBranch', 'worktreeBranchTrack',
  'scope',
];
