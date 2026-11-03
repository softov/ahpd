import { RpcError, METHOD_NOT_FOUND } from '../rpc.js';

export { reason } from '../utils/values.js';

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

/** What a request that would start something is refused with once the host is closing. */
export const CLOSING = 'This host is closing, so nothing new starts on it';

/** What a session start without a provider hears on a host that serves no agent yet. */
export const NO_AGENT = 'This host serves no agent yet, so no session can start. Install or enable an agent plugin';

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
 * person rather than only under a `worktrees` port. `connectors` is a ninth:
 * the aliases this session's connectors go by, which this host resolves and
 * never hands to a backend.
 */
export const HOSTS_OWN = [
  'isolation', 'branch', 'worktreeIncludeFiles', 'worktreeSymlinkFolders',
  'worktreeBranchPrefix', 'worktreeCreateNewBranch', 'worktreeBranchTrack',
  'scope', 'connectors',
];

/**
 * The config properties this host takes on a running session and reads
 * itself, each with the property every session's schema declares.
 *
 * Such a key moves on a running session, and no backend is asked about it or
 * handed it. `sensitiveEditLocations` is the workspace-relative
 * paths whose writes always ask: VS Code sends it before each turn, and its host
 * declares the property on its sessions and reads it when it judges a write.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/agentHostSchema.ts#L347-L366
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2273-L2286
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/sessionPermissions.ts#L774-L815
 */
export const HOSTS_TAKEN: Record<string, Record<string, unknown>> = {
  sensitiveEditLocations: {
    type: 'array',
    title: 'Sensitive Edit Locations',
    description: 'Workspace-relative customization locations whose edits always require confirmation.',
    items: {
      type: 'object',
      title: 'Sensitive Edit Location',
      properties: {
        path: { type: 'string', title: 'Path' },
        isDirectory: { type: 'boolean', title: 'Directory' },
      },
      required: ['path', 'isDirectory'],
    },
    readOnly: true,
    sessionMutable: true,
  },
};
