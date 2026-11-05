import { AhpErrorCodes } from '@microsoft/agent-host-protocol';
import { RpcError, METHOD_NOT_FOUND } from '../rpc.js';

export { reason } from '../utils/values.js';

/**
 * A port this host was not given.
 *
 * Refused as a method the host does not have, in the reference host's words
 * for one: a host without a filesystem has no `resourceRead`, and saying so is
 * what lets a client draw the screen it can.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2763
 */
export const need = <T>(port: T | undefined, method: string): T => {
  if (port === undefined)
    throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
  return port;
};

/**
 * A store's operation, or the refusal of a store that has none: NotFound in
 * the reference host's words for a provider without the operation.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostResourceProviders.ts#L88-L95
 */
export const served = <T>(operation: T | undefined, name: string, uri: string): T => {
  if (operation === undefined)
    throw new RpcError(AhpErrorCodes.NotFound, `Resource operation '${name}' is not supported for: ${uri}`);
  return operation;
};

/** What a request that would start something is refused with once the host is closing. */
export const CLOSING = 'This host is closing, so nothing new starts on it';

/**
 * What a session start hears for a provider this host does not hold, in the
 * reference host's words, the provider named or `(none)`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6180
 */
export const noProvider = (provider: string | undefined): string => `No agent provider registered for: ${provider ?? '(none)'}`;

/** The actions that end a chat's active turn. */
export const ENDINGS = new Set(['chat/turnComplete', 'chat/turnCancelled', 'chat/error']);

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
 * The command a message's text runs, trimmed, or nothing for text that is
 * not a `!` command, as the reference host parses one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostBangCommand.ts#L11-L26
 */
export const bangCommand = (text: string): string | undefined => {
  if (!text.startsWith(BANG)) return undefined;
  const command = text.slice(BANG.length).trim();
  return command === '' ? undefined : command;
};

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
 * Such a key moves on a running session without any backend being asked about
 * it, and every backend is handed it, at its start and as it moves, as the
 * reference host hands its agents every key but its own.
 * `sensitiveEditLocations` is the workspace-relative paths whose writes
 * always ask: VS Code sends it before each turn, and its host declares the
 * property on its sessions and reads it when it judges a write.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/agentHostSchema.ts#L347-L366
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L520-L528
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
