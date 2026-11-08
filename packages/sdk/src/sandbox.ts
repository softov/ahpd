import type { Bag } from './types/common.js';
import type {
  SandboxConfigValue, SandboxEnabledValue, SandboxUserConfiguredPaths, SessionSandboxPolicy, SessionSandboxState,
} from './types/sandbox.js';

/*
 * A chat's sandbox, resolved as VS Code's agent host resolves one: the root
 * `sandbox` settings, the chat's own switch over them, within the session's
 * floor. Each function here is VS Code's of the same name, carried with its
 * rules; what decides the inputs is the host's.
 */

/**
 * VS Code's `SandboxSettingsResolutionHelper`: local settings resolved
 * against the managed floor, saved preferences left as they are.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/sandbox/common/sandboxSettingsResolutionHelper.ts#L32-L83
 */
export const sandboxResolution = {
  resolveEnabled: (local: SandboxEnabledValue | undefined, managed: boolean | undefined): SandboxEnabledValue | undefined =>
    (managed === true ? 'on' : local),
  resolveSandboxServers: (local: boolean | undefined, managed: boolean | undefined): boolean | undefined =>
    (managed === true ? true : local),
  resolveAllowBypass: (local: boolean | undefined, managed: boolean | undefined, managedEnabled: boolean | undefined): boolean | undefined =>
    (managed === false || (managedEnabled === true && managed !== true) ? false : local),
  resolveAllowAccess: (local: boolean | undefined, managed: boolean | undefined): boolean | undefined =>
    (managed === false ? false : local),
  /** A managed allow list when present, and the block lists combined. */
  resolveNetworkHosts: (
    localAllowedHosts: readonly string[] | undefined,
    localBlockedHosts: readonly string[] | undefined,
    managedAllowedHosts: readonly string[] | undefined,
    managedBlockedHosts: readonly string[] | undefined,
  ): { allowedHosts: string[]; blockedHosts: string[] } => ({
    allowedHosts: [...new Set(managedAllowedHosts ?? localAllowedHosts ?? [])],
    blockedHosts: [...new Set([...(localBlockedHosts ?? []), ...(managedBlockedHosts ?? [])])],
  }),
  /** Managed grant lists when present, and the denied paths combined. */
  resolveFileSystemPaths: (
    local: SandboxUserConfiguredPaths | undefined,
    managed: SandboxUserConfiguredPaths | undefined,
  ): SandboxUserConfiguredPaths => ({
    readwritePaths: [...new Set(managed?.readwritePaths ?? local?.readwritePaths ?? [])],
    readonlyPaths: [...new Set(managed?.readonlyPaths ?? local?.readonlyPaths ?? [])],
    deniedPaths: [...new Set([...(local?.deniedPaths ?? []), ...(managed?.deniedPaths ?? [])])],
  }),
};

/**
 * A path's separators converted for the sandbox's execution OS, the path
 * neither resolved nor read as a pattern.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/sandbox/common/settings.ts#L27-L30
 */
export const normalizeSandboxFileSystemPath = (path: string, platform: NodeJS.Platform): string =>
  (platform === 'win32' ? path.replace(/\//g, '\\') : path);

/**
 * A chat's enablement from its selection (`default`, `on`, `off`), the
 * session's floor and the last enablement this host applied: an applied off
 * within a floor that allows bypass stays authorized.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionSandbox.ts#L98-L110
 */
export const resolveSandboxEnabled = (
  rawSelection: unknown,
  policy: SessionSandboxPolicy | undefined,
  appliedEnabled: boolean | undefined,
): SandboxEnabledValue | undefined => {
  const selection = rawSelection === 'default' || rawSelection === 'on' || rawSelection === 'off' ? rawSelection : undefined;
  const authorizedDisable = policy?.allowBypass === true && appliedEnabled === false;
  const localEnabled: SandboxEnabledValue | undefined = selection === 'on' ? 'on'
    : selection === 'off' ? 'off'
      : policy?.enabled ? 'on' : undefined;
  return sandboxResolution.resolveEnabled(localEnabled, policy?.enabled === true && !authorizedDisable);
};

/** The toggles a chat's selection and its floor decide, VS Code's `getSessionSandboxOverrides`. */
export type SandboxOverrides = Pick<SandboxConfigValue,
  'enabled' | 'allowUnsandboxedCommands' | 'allowNetwork' | 'allowLocalNetwork' | 'allowDevToolAccess'
  | 'sandboxMcpServers' | 'sandboxLspServers' | 'authenticateGit' | 'authenticateGh'>;

/**
 * A chat's toggle overrides, global settings left as they are.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionSandbox.ts#L71-L96
 */
export const sessionSandboxOverrides = (
  selection: unknown,
  policy: SessionSandboxPolicy | undefined,
  appliedEnabled: boolean | undefined,
): SandboxOverrides => {
  const enabled = resolveSandboxEnabled(selection, policy, appliedEnabled);
  const allowUnsandboxedCommands = sandboxResolution.resolveAllowBypass(undefined, policy?.allowBypass, policy?.enabled);
  const allowNetwork = sandboxResolution.resolveAllowAccess(undefined, policy?.allowOutbound);
  const allowLocalNetwork = sandboxResolution.resolveAllowAccess(undefined, policy?.allowLocalNetwork);
  const allowDevToolAccess = sandboxResolution.resolveAllowAccess(undefined, policy?.allowDevToolAccess);
  const sandboxMcpServers = sandboxResolution.resolveSandboxServers(undefined, policy?.sandboxMcpServers);
  const sandboxLspServers = sandboxResolution.resolveSandboxServers(undefined, policy?.sandboxLspServers);
  const authenticateGit = sandboxResolution.resolveAllowAccess(undefined, policy?.authenticateGit);
  const authenticateGh = sandboxResolution.resolveAllowAccess(undefined, policy?.authenticateGh);
  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(allowUnsandboxedCommands !== undefined ? { allowUnsandboxedCommands } : {}),
    ...(allowNetwork !== undefined ? { allowNetwork } : {}),
    ...(allowLocalNetwork !== undefined ? { allowLocalNetwork } : {}),
    ...(allowDevToolAccess !== undefined ? { allowDevToolAccess } : {}),
    ...(sandboxMcpServers !== undefined ? { sandboxMcpServers } : {}),
    ...(sandboxLspServers !== undefined ? { sandboxLspServers } : {}),
    ...(authenticateGit !== undefined ? { authenticateGit } : {}),
    ...(authenticateGh !== undefined ? { authenticateGh } : {}),
  };
};

/**
 * A chat's sandbox for the host that runs it, whatever OS or source the
 * client has: the root settings, the chat's selection over them, within the
 * session's floor, each path's separators the executing OS's.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionSandbox.ts#L17-L69
 */
export const sessionSandboxConfig = (
  root: SandboxConfigValue | undefined,
  selection: unknown,
  policy: SessionSandboxPolicy | undefined,
  appliedEnabled: boolean | undefined,
  platform: NodeJS.Platform = process.platform,
): SandboxConfigValue => {
  const sandbox: SandboxConfigValue = { ...root, ...sessionSandboxOverrides(selection, policy, appliedEnabled) };
  const addCurrentWorkingDirectory = sandboxResolution.resolveAllowAccess(sandbox.addCurrentWorkingDirectory, policy?.addCurrentWorkingDirectory);
  if (addCurrentWorkingDirectory !== undefined) sandbox.addCurrentWorkingDirectory = addCurrentWorkingDirectory;
  if (sandbox.allowedNetworkDomains !== undefined || sandbox.deniedNetworkDomains !== undefined
    || policy?.allowedHosts !== undefined || policy?.blockedHosts !== undefined) {
    const hosts = sandboxResolution.resolveNetworkHosts(
      sandbox.allowedNetworkDomains, sandbox.deniedNetworkDomains,
      policy?.allowedHosts, policy?.blockedHosts,
    );
    sandbox.allowedNetworkDomains = hosts.allowedHosts;
    sandbox.deniedNetworkDomains = hosts.blockedHosts;
  }
  if (sandbox['fileSystem.userConfiguredPaths'] !== undefined || policy?.readwritePaths !== undefined
    || policy?.readonlyPaths !== undefined || policy?.deniedPaths !== undefined) {
    sandbox['fileSystem.userConfiguredPaths'] = sandboxResolution.resolveFileSystemPaths(
      sandbox['fileSystem.userConfiguredPaths'],
      policy && {
        ...(policy.readwritePaths ? { readwritePaths: [...policy.readwritePaths] } : {}),
        ...(policy.readonlyPaths ? { readonlyPaths: [...policy.readonlyPaths] } : {}),
        ...(policy.deniedPaths ? { deniedPaths: [...policy.deniedPaths] } : {}),
      },
    );
  }
  const fileSystemKey = platform === 'win32' ? 'fileSystem.windows' : platform === 'darwin' ? 'fileSystem.mac' : 'fileSystem.linux';
  const fileSystem = sandbox[fileSystemKey];
  if (fileSystem) {
    const normalized = { ...fileSystem };
    for (const key of ['allowRead', 'allowWrite', 'denyRead', 'denyWrite'] as const) {
      const paths = fileSystem[key];
      if (paths) normalized[key] = paths.map((path) => normalizeSandboxFileSystemPath(path, platform));
    }
    sandbox[fileSystemKey] = normalized;
  }
  return sandbox;
};

/** The session `_meta` key the floor is published under. */
const POLICY_KEY = 'vscode.resolvedSandboxPolicy';
/** The key an older host published the floor under, which a write of the floor removes. */
const LEGACY_POLICY_KEY = 'vscode.sandboxPolicy';
/** The session `_meta` key each chat's applied sandbox is published under. */
const STATE_KEY = 'vscode.sandboxState';

const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((one) => typeof one === 'string');

/**
 * The floor a session's `_meta` carries; a slot that is missing or not an
 * object asserts none.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/agentSandboxPolicyMeta.ts#L30-L55
 */
export const readSessionSandboxPolicy = (source: { _meta?: Bag } | undefined): SessionSandboxPolicy | undefined => {
  const value = source?._meta?.[POLICY_KEY];
  if (!isBag(value)) return undefined;
  const held = value as Partial<SessionSandboxPolicy>;
  return {
    enabled: held.enabled as boolean,
    ...(held.allowBypass !== undefined ? { allowBypass: held.allowBypass } : {}),
    ...(held.allowOutbound !== undefined ? { allowOutbound: held.allowOutbound } : {}),
    ...(held.allowLocalNetwork !== undefined ? { allowLocalNetwork: held.allowLocalNetwork } : {}),
    ...(isStrings(held.allowedHosts) ? { allowedHosts: [...held.allowedHosts] } : {}),
    ...(isStrings(held.blockedHosts) ? { blockedHosts: [...held.blockedHosts] } : {}),
    ...(isStrings(held.readwritePaths) ? { readwritePaths: [...held.readwritePaths] } : {}),
    ...(isStrings(held.readonlyPaths) ? { readonlyPaths: [...held.readonlyPaths] } : {}),
    ...(isStrings(held.deniedPaths) ? { deniedPaths: [...held.deniedPaths] } : {}),
    ...(held.allowDevToolAccess !== undefined ? { allowDevToolAccess: held.allowDevToolAccess } : {}),
    ...(typeof held.addCurrentWorkingDirectory === 'boolean' ? { addCurrentWorkingDirectory: held.addCurrentWorkingDirectory } : {}),
    ...(held.sandboxMcpServers !== undefined ? { sandboxMcpServers: held.sandboxMcpServers } : {}),
    ...(held.sandboxLspServers !== undefined ? { sandboxLspServers: held.sandboxLspServers } : {}),
    ...(held.authenticateGit !== undefined ? { authenticateGit: held.authenticateGit } : {}),
    ...(held.authenticateGh !== undefined ? { authenticateGh: held.authenticateGh } : {}),
    ...(held.failClosed !== undefined ? { failClosed: held.failClosed } : {}),
  };
};

/**
 * A session's `_meta` with the floor written, the older host's slot removed.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/agentSandboxPolicyMeta.ts#L57-L81
 */
export const withSessionSandboxPolicy = (meta: Bag | undefined, policy: SessionSandboxPolicy | undefined): Bag => {
  const result: Bag = {
    ...meta,
    [POLICY_KEY]: policy ? {
      enabled: policy.enabled,
      ...(policy.allowBypass !== undefined ? { allowBypass: policy.allowBypass } : {}),
      ...(policy.allowOutbound !== undefined ? { allowOutbound: policy.allowOutbound } : {}),
      ...(policy.allowLocalNetwork !== undefined ? { allowLocalNetwork: policy.allowLocalNetwork } : {}),
      ...(policy.allowedHosts !== undefined ? { allowedHosts: [...policy.allowedHosts] } : {}),
      ...(policy.blockedHosts !== undefined ? { blockedHosts: [...policy.blockedHosts] } : {}),
      ...(policy.readwritePaths !== undefined ? { readwritePaths: [...policy.readwritePaths] } : {}),
      ...(policy.readonlyPaths !== undefined ? { readonlyPaths: [...policy.readonlyPaths] } : {}),
      ...(policy.deniedPaths !== undefined ? { deniedPaths: [...policy.deniedPaths] } : {}),
      ...(policy.allowDevToolAccess !== undefined ? { allowDevToolAccess: policy.allowDevToolAccess } : {}),
      ...(policy.addCurrentWorkingDirectory !== undefined ? { addCurrentWorkingDirectory: policy.addCurrentWorkingDirectory } : {}),
      ...(policy.sandboxMcpServers !== undefined ? { sandboxMcpServers: policy.sandboxMcpServers } : {}),
      ...(policy.sandboxLspServers !== undefined ? { sandboxLspServers: policy.sandboxLspServers } : {}),
      ...(policy.authenticateGit !== undefined ? { authenticateGit: policy.authenticateGit } : {}),
      ...(policy.authenticateGh !== undefined ? { authenticateGh: policy.authenticateGh } : {}),
      ...(policy.failClosed !== undefined ? { failClosed: policy.failClosed } : {}),
    } : undefined,
  };
  delete result[LEGACY_POLICY_KEY];
  return result;
};

/**
 * One state entry, read as VS Code reads it: a malformed entry is absent, and
 * absent is a state nobody knows, never off.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/agentSandboxStateMeta.ts#L53-L77
 */
const parseSandboxState = (value: unknown): SessionSandboxState | undefined => {
  if (!isBag(value)) return undefined;
  const { enabled, error, rejectedSelection } = value;
  if (enabled !== undefined && typeof enabled !== 'boolean') return undefined;
  if (rejectedSelection !== undefined && typeof rejectedSelection !== 'boolean') return undefined;
  if (error === undefined) {
    return enabled === undefined ? undefined : { enabled, ...(rejectedSelection === true ? { rejectedSelection } : {}) };
  }
  if (!isBag(error)) return undefined;
  const { id, clientId, clientSeq, message } = error;
  if (typeof id === 'string' && id.length > 0 && typeof message === 'string' && clientId === undefined && clientSeq === undefined) {
    return { ...(enabled === undefined ? {} : { enabled }), ...(rejectedSelection === true ? { rejectedSelection } : {}), error: { id, message } };
  }
  if (id !== undefined || enabled === undefined || typeof clientId !== 'string' || typeof clientSeq !== 'number'
    || !Number.isSafeInteger(clientSeq) || typeof message !== 'string') return undefined;
  return { enabled, ...(rejectedSelection === true ? { rejectedSelection } : {}), error: { clientId, clientSeq, message } };
};

/**
 * The session-level state, the default chat's, which older clients read.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/agentSandboxStateMeta.ts#L24-L26
 */
export const readSessionSandboxState = (source: { _meta?: Bag } | undefined): SessionSandboxState | undefined =>
  parseSandboxState(source?._meta?.[STATE_KEY]);

/**
 * One chat's last successful sandbox application, from the per-chat map of
 * the session's slot.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/agentSandboxStateMeta.ts#L28-L37
 */
export const readChatSandboxState = (source: { _meta?: Bag } | undefined, chat: string): SessionSandboxState | undefined => {
  const value = source?._meta?.[STATE_KEY];
  const chats = isBag(value) ? value['chats'] : undefined;
  return isBag(chats) ? parseSandboxState(chats[chat]) : undefined;
};

/**
 * The session-level state, which older clients read, the per-chat map kept;
 * clearing it clears every chat's state too.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/agentSandboxStateMeta.ts#L79-L87
 */
export const withSessionSandboxState = (meta: Bag | undefined, state: SessionSandboxState | undefined): Bag => {
  if (!state) return { ...meta, [STATE_KEY]: undefined };
  const current = meta?.[STATE_KEY];
  const chats = isBag(current) ? current['chats'] : undefined;
  return { ...meta, [STATE_KEY]: { ...(isBag(chats) ? { chats } : {}), ...state } };
};

/**
 * One chat's state set, or removed with `undefined`, the rest of the slot kept.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/agentSandboxStateMeta.ts#L89-L102
 */
export const withChatSandboxState = (meta: Bag | undefined, chat: string, state: SessionSandboxState | undefined): Bag => {
  const current = meta?.[STATE_KEY];
  const slot: Bag = isBag(current) ? { ...current } : {};
  const chats: Bag = isBag(slot['chats']) ? { ...slot['chats'] } : {};
  if (state) chats[chat] = state;
  else delete chats[chat];
  slot['chats'] = chats;
  return { ...meta, [STATE_KEY]: slot };
};
