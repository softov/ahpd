/** What a tool call asks for, as the host's approval chain reads it. */

/**
 * What a call asks to do, by VS Code's kinds.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1469-L1483
 */
export type PermissionKind =
  | 'shell' | 'write' | 'mcp' | 'read' | 'url' | 'skill' | 'custom-tool' | 'hook' | 'memory' | 'workflow'
  | 'extension-management' | 'extension-permission-access' | 'extension-env-access';

/**
 * The managed permissions an operator sets for every session on the host, in
 * VS Code's shape: rules that ask and rules that deny, written in the managed
 * rule grammar (`Shell`, `Read`, `Write`, `Domain`), the lock that takes
 * Allow All away, and the domains every fetch must stay within.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L61-L70
 */
export interface ManagedSettingsPermissions {
  /** `disable` takes Allow All away: no question is answered by it. */
  disableBypassPermissionsMode?: 'disable';
  /** Requests refused before anybody is asked. */
  deny?: string[];
  /** Requests that ask every time, Allow Once and Skip alone. */
  ask?: string[];
  /** The `Domain` rules a fetch must stay within; an empty list admits none. */
  limitTo?: string[];
}
