import { AhpErrorCodes } from '@microsoft/agent-host-protocol';
import { RpcError, METHOD_NOT_FOUND } from '../rpc.js';
import type { Bag } from '../types/common.js';
import type { Owner } from '../types/usage.js';

export { reason } from '../utils/values.js';

/**
 * A turn's start carrying who sent it, under `ahpd.sender` on the action and
 * on its message: `chat/turnStarted` is one of the few actions that declares a
 * `_meta`, and the message is what a chat's state keeps, so a turn read back
 * says its sender there too. AHP's message origin carries a kind and no
 * person, and a namespaced `_meta` key is the protocol's place for a fact it
 * does not define.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L779-L789
 */
export const withSenderOn = (action: Bag, sender: Owner): Bag => {
  const message = (typeof action.message === 'object' && action.message !== null ? action.message : {}) as Bag;
  return {
    ...action,
    _meta: { ...(action._meta as Bag | undefined), 'ahpd.sender': sender },
    message: { ...message, _meta: { ...(message._meta as Bag | undefined), 'ahpd.sender': sender } },
  };
};

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
 *
 * `permissions` is the session's rules for its tool calls, VS Code's
 * platform property with its lists and their titles, and a description of
 * what this host reads of it: a question about a tool `deny` names is turned
 * away, and one about a tool `allow` names, and `ask` does not, is answered
 * without a person. An "Allow in this Session" answer is kept here.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostSchema.ts#L277-L310
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostSchema.ts#L378-L406
 */
export const HOSTS_TAKEN: Record<string, Record<string, unknown>> = {
  permissions: {
    type: 'object',
    title: 'Permissions',
    description: 'Rules for this session\'s tool calls, each a tool\'s name. A question about a tool that deny names is refused, and one about a tool that allow names, and ask does not, is answered without asking. Updated when a tool is allowed in this session.',
    properties: {
      allow: { type: 'array', title: 'Allowed permission rules', items: { type: 'string', title: 'Permission rule' } },
      deny: { type: 'array', title: 'Denied permission rules', items: { type: 'string', title: 'Permission rule' } },
      ask: { type: 'array', title: 'Permission Rules Requiring Confirmation', items: { type: 'string', title: 'Permission rule' } },
    },
    default: { allow: [], deny: [] },
    sessionMutable: true,
  },
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
