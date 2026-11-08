/**
 * The agent sandbox, in VS Code's shapes.
 *
 * Where a session runs is its `computer` setting; whether a chat's commands
 * run inside the sandbox runtime is a second setting, VS Code's switch per
 * chat, resolved against the host's root `sandbox` settings within the floor
 * the operator sets. These are the shapes the three are read in.
 */

/**
 * The root `sandbox` key, and VS Code's keys inside it, prefix-free.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sandboxConfigSchema.ts#L17-L47
 */
export const SANDBOX_ROOT_KEY = 'sandbox';

/**
 * The session key a chat's switch is written under, VS Code's platform
 * session key, whose values are `default`, `on` and `off`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostSchema.ts#L378-L386
 */
export const SANDBOX_ENABLED_KEY = 'sandboxEnabled';

/** Whether the sandbox is on, as VS Code's `AgentSandboxEnabledValue` says it. */
export type SandboxEnabledValue = 'on' | 'off';

/** A chat's switch: `default` follows the root settings. */
export type SessionSandboxEnabled = 'default' | 'on' | 'off';

/** Paths a sandboxed process reads and writes, reads only, or cannot reach. */
export interface SandboxUserConfiguredPaths {
  readwritePaths?: string[];
  readonlyPaths?: string[];
  deniedPaths?: string[];
}

/** One platform's filesystem rules, the terminal engine's per-OS setting. */
export interface SandboxFileSystemSetting {
  allowRead?: string[];
  allowWrite?: string[];
  denyRead?: string[];
  denyWrite?: string[];
}

/** Environment variables masked by the sandbox and injected at the hosts named for each. */
export interface SandboxMaskedCredentials {
  envVars?: Record<string, { injectHosts: string[] }>;
}

/**
 * The root `sandbox` value, and a chat's resolved sandbox, VS Code's
 * `ISandboxConfigValue`: one object of prefix-free keys.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sandboxConfigSchema.ts#L49-L69
 */
export interface SandboxConfigValue {
  enabled?: SandboxEnabledValue;
  allowNetwork?: boolean;
  allowLocalNetwork?: boolean;
  allowUnsandboxedCommands?: boolean;
  sandboxMcpServers?: boolean;
  sandboxLspServers?: boolean;
  authenticateGit?: boolean;
  authenticateGh?: boolean;
  credentials?: SandboxMaskedCredentials;
  allowDevToolAccess?: boolean;
  addCurrentWorkingDirectory?: boolean;
  'fileSystem.userConfiguredPaths'?: SandboxUserConfiguredPaths;
  'fileSystem.linux'?: SandboxFileSystemSetting;
  'fileSystem.mac'?: SandboxFileSystemSetting;
  'fileSystem.windows'?: SandboxFileSystemSetting;
  'advanced.runtime'?: Record<string, unknown>;
  allowedNetworkDomains?: string[];
  deniedNetworkDomains?: string[];
}

/**
 * The floor of one session's sandbox, which no chat lowers: VS Code's
 * `ISessionSandboxPolicy`, the runtime-resolved policy its host publishes as
 * `vscode.resolvedSandboxPolicy`. On this host the operator's managed setting
 * is its source.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/agentSandboxPolicyMeta.ts#L10-L28
 */
export interface SessionSandboxPolicy {
  enabled: boolean;
  allowBypass?: boolean;
  allowOutbound?: boolean;
  allowLocalNetwork?: boolean;
  allowedHosts?: string[];
  blockedHosts?: string[];
  readwritePaths?: string[];
  readonlyPaths?: string[];
  deniedPaths?: string[];
  allowDevToolAccess?: boolean;
  addCurrentWorkingDirectory?: boolean;
  sandboxMcpServers?: boolean;
  sandboxLspServers?: boolean;
  authenticateGit?: boolean;
  authenticateGh?: boolean;
  failClosed?: boolean;
}

/**
 * A chat's last successful sandbox application, with a failure a client's
 * request or this host met: VS Code's `ISessionSandboxState`, published per
 * chat in the session's `vscode.sandboxState`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/agentSandboxStateMeta.ts#L10-L22
 */
export interface SessionSandboxState {
  enabled?: boolean;
  rejectedSelection?: boolean;
  error?: { clientId: string; clientSeq: number; message: string } | { id: string; message: string };
}
