import { lookup } from 'node:dns/promises';
import { realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { AhpErrorCodes } from '@microsoft/agent-host-protocol';
import { INTERNAL_ERROR, INVALID_PARAMS, METHOD_NOT_FOUND, RpcError, optionalStringParam, stringParam } from '../rpc.js';
import { idOf } from '../sessions/catalog.js';
import { hostLogPath } from '../sessions/debuglogs.js';
import { localPath, uriOf } from '../resources/fileuri.js';
import { ROOT, spaceOf } from './channels.js';
import { need, reason } from './common.js';
import { ARCHIVE_COMMIT_MESSAGE, symlinkFolders } from './lifecycle.js';
import { requireTrust } from './trust.js';
import type { LogFile } from '../sessions/debuglogs.js';
import type { ContainerConnect, ContainerConnectResult, ContainerSink } from '../types/containers.js';
import type { ConnectionContext, DetachedWorktree, HostContext } from './context.js';

/**
 * The proxy variables the network diagnostics report, when set: the reference
 * host's list.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/networkDiagnosticsService.ts#L44-L48
 */
const PROXY_ENV = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy', 'COPILOT_PROXY_KERBEROS_SPN'] as const;
/** How long a network probe waits, and how much of the body it keeps. */
const PROBE_TIMEOUT = 10_000;
const MAX_BODY = 64 * 1024;

/** One address lookup for the network diagnostics, timed and never thrown. */
const resolved = async (host: string, family: 4 | 6): Promise<{ address?: string; durationMs: number; error?: string }> => {
  const began = Date.now();
  try {
    const { address } = await Promise.race([
      lookup(host, { family }),
      new Promise<never>((_, reject) => { setTimeout(() => { reject(new Error(`Timed out after ${PROBE_TIMEOUT / 1000}s`)); }, PROBE_TIMEOUT).unref?.(); }),
    ]);
    return { address, durationMs: Date.now() - began };
  }
  catch (error) {
    return { durationMs: Date.now() - began, error: reason(error) };
  }
};

/** How long an unclaimed handle, or a claimed one nobody has seen, is kept before a reconcile may reap it. */
const DETACHED_GRACE = 24 * 60 * 60 * 1000;

/**
 * The shape of a handle this host hands out for a tree the window made: a
 * UUID, as VS Code checks one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/meta/vscode/agentDevContainerWorktreeMeta.ts#L17-L19
 */
const WORKTREE_HANDLE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** How much of the launcher's output is kept to explain an ending. */
const CONTAINER_TAIL = 24;

/** The source a session names to be placed in a folder's own dev container. */
const DEV_CONTAINER_SOURCE = 'devcontainer://';

/**
 * A dev container's folder as a path of the platform the host runs on. On
 * Windows a host URI's path, `/c:/work`, names the file it is the path of,
 * and every separator is a backslash, as VS Code's protocol reads one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L26-L34
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/uri.ts#L636-L660
 */
export const normalizeDevContainerWorkspaceFolder = (workspaceFolder: string, platform: NodeJS.Platform): string => {
  if (platform !== 'win32') return workspaceFolder;
  const letter = workspaceFolder.charCodeAt(1);
  const drive = workspaceFolder.startsWith('/') && !workspaceFolder.startsWith('//') && workspaceFolder.charAt(2) === ':'
    && ((letter >= 65 && letter <= 90) || (letter >= 97 && letter <= 122));
  return (drive ? workspaceFolder.slice(1) : workspaceFolder).replaceAll('/', '\\');
};

/**
 * The methods the reference window asks of its own host, and the diagnostics
 * it asks the process about.
 *
 * The worktree handles it holds, the session state file and the logs it
 * collects, its own shutdown, and the devContainer requests the relay is
 * decided on.
 */
export interface VscodeMethods {
  'vscode/createAgentHostDetachedWorktree': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/claimAgentHostDetachedWorktree': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/setAgentHostDetachedWorktreeArchived': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/deleteAgentHostDetachedWorktree': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/reconcileAgentHostDetachedWorktrees': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/removeSessionArtifact': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/stopBackgroundWork': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/getAgentHostSessionStateFile': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/collectAgentHostDebugLogs': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/cancelAgentHostDebugLogs': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/readAgentHostDebugLogsChunk': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/isDockerAvailable': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/connect': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/disconnect': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/relaySend': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/stop': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/remove': (params: Record<string, unknown>) => Promise<unknown>;
  shutdown: (params: Record<string, unknown>) => Promise<unknown>;
  getNetworkDiagnosticsInfo: (params: Record<string, unknown>) => Promise<unknown>;
  getManagedSettingsDiagnostics: (params: Record<string, unknown>) => Promise<unknown>;
  diagnosticsFetch: (params: Record<string, unknown>) => Promise<unknown>;
}

export function createVscodeMethods(ctx: HostContext, conn: ConnectionContext): VscodeMethods {
  const { connection } = conn;
  const {
    agents, byChat, detached, dirOf, kept, leadOf, log, logs, options, ownerFor, owners,
    sessionFor, sessions, setArtifacts,
  } = ctx;

  /** The folders linked into a session's tree, whose links are not work in it. */
  const linkedOf = (session: string): string[] => symlinkFolders(kept.config(idOf(session)) ?? ctx.decided.get(session) ?? {});

  /*
   * A Dev Container's folder vouched for by the window asking, before one is
   * started, stopped or removed there, and refused PermissionDenied in the
   * reference host's words otherwise.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L103-L108
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L166-L169
   */
  const vouchedFor = async (folder: string, refusal: string): Promise<void> => {
    await requireTrust({ folder, sender: connection, trust: ctx.rootConfig.workspaceTrust, autoApproved: false })
      .catch(() => { throw new RpcError(AhpErrorCodes.PermissionDenied, refusal); });
  };

  /**
   * The backend's own file for a session, or for one chat of it.
   *
   * A chat here is its own backend session with an id of its own, so a chat
   * named is that id, a live one's or the one its record holds; a session
   * named is its lead's. A row that is not running has the id in its URI,
   * which is what the catalogue listed it by. A chat named is checked against
   * the session its record says owns it, as the reference host resolves a
   * chat's owner from its records, so a chat of a session nobody runs passes.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4326-L4331
   */
  const stateFileOf = (session: string, chat?: string): string | undefined => {
    const uri = sessions.has(session) ? session : sessionFor(session);
    if (chat !== undefined && (spaceOf(chat) !== 'chat' || sessionFor(chat) !== uri)) {
      throw new RpcError(INVALID_PARAMS, 'chat must belong to the requested Agent Session');
    }
    const held = sessions.get(uri);
    const agent = held?.agent ?? owners.get(uri);
    const dir = dirOf(uri);
    if (agent?.stateFile === undefined || dir === undefined) return undefined;
    const own = chat === undefined
      ? (held ? leadOf(held)?.agentId() : undefined)
      : byChat.get(chat)?.chat.agentId() ?? ctx.recordedChat(idOf(uri), chat)?.backendId;
    return agent.stateFile(own ?? idOf(uri), dir);
  };

  /**
   * The `connectionId` a container request names, checked once.
   *
   * A `connectionId` is a name a client chose, so it is bounded: non-empty,
   * no NUL, and short enough to be an identifier rather than a payload. A
   * `connect` and a `disconnect` refuse it in one sentence, which is why the
   * check is one function rather than two.
   */
  const connectionIdOf = (params: Record<string, unknown>): string => {
    const id = typeof params.connectionId === 'string' ? params.connectionId : '';
    if (id.trim() === '' || id.length > 256 || id.includes('\0')) {
      throw new RpcError(INVALID_PARAMS, 'connectionId must be a non-empty identifier');
    }
    return id;
  };

  /**
   * The other two strings a `connect` carries, checked with the id: an
   * absolute folder on this host and a name, refused in one sentence, as
   * VS Code's protocol checks a connect.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L88-L95
   *
   * Whether the folder exists and has a container definition is the
   * launcher's to answer, because that is a question about a filesystem.
   * The owner is not among them: the client does not name one, and the
   * call below fills it from the connection the ask arrived on.
   */
  const containerAsk = (params: Record<string, unknown>): ContainerConnect => {
    const id = connectionIdOf(params);
    const folder = normalizeDevContainerWorkspaceFolder(typeof params.workspaceFolder === 'string' ? params.workspaceFolder : '', process.platform);
    const name = typeof params.name === 'string' ? params.name : '';
    if (!isAbsolute(folder) || folder.includes('\0') || name.trim() === '' || name.includes('\0')) {
      throw new RpcError(INVALID_PARAMS, 'workspaceFolder must be an absolute host path and name must be non-empty');
    }
    return { connectionId: id, workspaceFolder: folder, name };
  };

  /**
   * The one string a `disconnect` or a `relaySend` carries.
   *
   * The reference sends `{ connectionId }` and `{ connectionId, data }`,
   * so a folder is not asked for again: the connection was made with one.
   */
  const namedContainer = (params: Record<string, unknown>): string => connectionIdOf(params);

  /**
   * The folder a `stop` or a `remove` names: an absolute folder on this host,
   * as VS Code's protocol checks one.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L139-L149
   *
   * The reference sends `{ workspaceFolder }` for both, and the folder is the
   * whole of what a dev container is: its `devcontainer.json` is the
   * definition and the machine is that folder's. A relative path is refused:
   * the folder it reaches depends on this process's working directory, which
   * no client chose.
   */
  const devFolder = (params: Record<string, unknown>): string => {
    const folder = normalizeDevContainerWorkspaceFolder(typeof params.workspaceFolder === 'string' ? params.workspaceFolder : '', process.platform);
    if (!isAbsolute(folder) || folder.includes('\0')) {
      throw new RpcError(INVALID_PARAMS, 'workspaceFolder must be an absolute host path');
    }
    return folder;
  };

  /** A folder as one path, so two spellings of one folder are one folder. */
  const atPath = (folder: string): string => {
    try { return realpathSync(folder); }
    catch { return resolve(folder); }
  };

  /**
   * Whether a connection other than this one still holds a relay on a folder.
   *
   * The reference host's own question, and the reason it answers `false` rather
   * than stopping a container another window has open. Every live connection's
   * map is held on the host for exactly this, since a name a client chose
   * reaches no other client and the folders are what can be compared.
   */
  const relayedByAnother = (folder: string): boolean => {
    const here = atPath(folder);
    for (const [who, held] of ctx.relays) {
      if (who === connection) continue;
      for (const one of held.values()) if (atPath(one.folder) === here) return true;
    }
    return false;
  };

  /**
   * Whether a session of this host is running in the folder's computer.
   *
   * The user the reference host has none of. A dev container is a `computer://`
   * machine here, and the sessions placed on one are this host's own. A session
   * that asked for the container by folder is what `sessionMachines` holds,
   * under the source it named; the folder is compared as a path, because the
   * source is a spelling a client chose and the folder a client names here is
   * another.
   */
  const placedOn = (folder: string): boolean => {
    const here = atPath(folder);
    for (const one of ctx.sessionMachines.values()) {
      if (!one.source.startsWith(DEV_CONTAINER_SOURCE)) continue;
      if (atPath(one.source.slice(DEV_CONTAINER_SOURCE.length).trim()) === here) return true;
    }
    return false;
  };

  /** The time on the host's clock, which a test moves. */
  const clock = (): number => (options.now?.() ?? new Date()).getTime();

  /** The handle a detached worktree request names, refused in VS Code's words when it is no handle this host hands out. */
  const handleOf = (params: Record<string, unknown>): string => {
    const { handle } = params;
    if (typeof handle !== 'string' || !WORKTREE_HANDLE.test(handle)) {
      throw new RpcError(INVALID_PARAMS, 'handle must be a valid worktree handle');
    }
    return handle;
  };

  /*
   * Whether anything uses a tree the window made: a session of this host
   * working in it, a relay into a container of that folder, or a session
   * placed on one, as VS Code keeps a folder another session uses.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostWorktreeCleanupService.ts#L413-L416
   */
  const treeInUse = async (path: string): Promise<boolean> => {
    const here = atPath(path);
    if ((await ctx.allRows()).some((row) => row.workingDirectories.some((one) => atPath(localPath(one)) === here))) return true;
    for (const held of ctx.relays.values()) {
      for (const one of held.values()) if (atPath(one.folder) === here) return true;
    }
    return placedOn(path);
  };

  /*
   * A tree the window made, taken away once nothing uses it, its branch kept
   * so an unarchive can put it back, as VS Code's host removes one. Work
   * nobody committed keeps it, as it keeps a session's own tree: an archive
   * under `archiveDirtyWorktree: commit` commits the work on the branch
   * first. Answers whether the tree is gone.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L1786-L1846
   */
  const takeDown = async (handle: string, held: DetachedWorktree, archiving: boolean): Promise<boolean> => {
    const port = options.worktrees;
    if (port === undefined) return false;
    if (!await stat(held.path).then(() => true, () => false)) return true;
    if (await treeInUse(held.path)) {
      log(`kept ${held.path}: it is in use`);
      return false;
    }
    const clean = async (): Promise<boolean> => await port.dirty(held.path, held.linked).catch(() => true) === false;
    if (!await clean()) {
      if (!archiving || ctx.archiveDirtyWorktree !== 'commit' || port.commit === undefined) {
        log(`kept ${held.path}: it has changes nobody committed`);
        return false;
      }
      const failed = await port.commit(held.path, ARCHIVE_COMMIT_MESSAGE, held.linked).then(() => undefined, reason);
      if (failed !== undefined || !await clean()) {
        log(`kept ${held.path}: ${failed === undefined ? 'it still has changes after the commit' : `could not commit its changes: ${failed}`}`);
        return false;
      }
    }
    return port.remove(held.repository, held.path, undefined, held.linked).then(
      () => { log(`removed ${held.path} for ${handle}, keeping ${held.branch ?? held.base}`); return true; },
      (error: unknown) => { log(`kept ${held.path}: ${reason(error)}`); return false; },
    );
  };

  /**
   * Stop or remove the computer a folder is, unless somebody else is using it.
   *
   * The reference host's own order: the folder's relays are ended, then the
   * container is stopped or removed, and the answer is whether anything was
   * done. This connection's own relays go first, so the host inside a container
   * is not left running in one that is about to stop; a relay another
   * connection holds, or a session placed on the computer, is what makes the
   * answer `false` instead.
   */
  const devContainerStopped = async (verb: 'stop' | 'remove', params: Record<string, unknown>): Promise<boolean> => {
    const method = `vscode/devContainers/${verb}`;
    const port = need(options.containers, method);
    const folder = devFolder(params);
    const act = verb === 'stop' ? port.stop : port.remove;
    // A launcher that cannot reach the runtime's own stop is refused as an
    // absent launcher is, a method this host does not have.
    if (act === undefined) throw new RpcError(METHOD_NOT_FOUND, `Method not found: ${method}`);
    await vouchedFor(folder, 'Workspace trust is required to manage a Dev Container');
    if (relayedByAnother(folder) || placedOn(folder)) return false;
    const here = atPath(folder);
    for (const [id, held] of [...conn.containers]) {
      if (atPath(held.folder) !== here) continue;
      conn.containers.delete(id);
      await port.disconnect(id);
    }
    return await act.call(port, folder);
  };

  return {
    /*
     * A tree of the window's own for a creating session whose tree is
     * pending, answered by the handle the window holds it under and its
     * folder, as VS Code's host makes one; the lifecycle refuses any other
     * session in VS Code's words.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3997-L4025
     */
    'vscode/createAgentHostDetachedWorktree': async (params) => {
      const session = stringParam(params, 'session', 'a URI string');
      stringParam(params, 'prompt');
      if (!URL.canParse(session)) throw new RpcError(INVALID_PARAMS, 'session must be a valid URI string');
      const uri = sessionFor(session);
      const handle = crypto.randomUUID();
      const tree = await ctx.createDetachedWorktree(uri, handle);
      const now = clock();
      detached.set(handle, {
        repository: tree.repository,
        path: tree.path,
        base: tree.base,
        ...(tree.branch !== undefined ? { branch: tree.branch } : {}),
        linked: linkedOf(uri),
        claimed: false,
        archived: false,
        deleting: false,
        createdAt: now,
        lastSeenAt: now,
      });
      log(`${connection.clientId || 'a client'} holds ${handle} on ${tree.path}`);
      return { handle, resource: uriOf(tree.path) };
    },
    /*
     * A session started in the tree: the handle is in use and seen now. One
     * this host never handed out, or one the window asked to delete, is
     * refused in VS Code's words.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostWorktreeCleanupService.ts#L402-L407
     */
    'vscode/claimAgentHostDetachedWorktree': async (params) => {
      const handle = handleOf(params);
      const held = detached.get(handle);
      if (held === undefined || held.deleting) throw new RpcError(INTERNAL_ERROR, `Unknown detached worktree handle: ${handle}`);
      held.claimed = true;
      held.lastSeenAt = clock();
      return {};
    },
    /*
     * Archived is the tree taken down once nothing uses it, its branch kept
     * so it can come back; unarchived is the tree put back on that branch.
     * A handle nobody holds is nothing to do, as VS Code's host answers it.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostWorktreeCleanupService.ts#L371-L400
     */
    'vscode/setAgentHostDetachedWorktreeArchived': async (params) => {
      const handle = handleOf(params);
      if (typeof params.archived !== 'boolean') throw new RpcError(INVALID_PARAMS, 'archived must be a boolean');
      const held = detached.get(handle);
      if (held === undefined || held.deleting) return {};
      held.archived = params.archived;
      if (held.archived) {
        await takeDown(handle, held, true);
        return {};
      }
      const port = options.worktrees;
      if (port === undefined || held.branch === undefined || await stat(held.path).then(() => true, () => false)) return {};
      await port.create({
        repository: held.repository,
        base: held.branch,
        path: held.path,
        ...(held.linked.length > 0 ? { symlink: held.linked } : {}),
      })
        .then(() => { log(`put ${held.path} back on ${held.branch ?? ''} for ${handle}`); })
        .catch((error: unknown) => { log(`could not put ${held.path} back: ${reason(error)}`); });
      return {};
    },
    /*
     * The window is done with the tree: it goes once nothing uses it, its
     * branch kept, and the handle with it, as VS Code's host queues the
     * removal. A tree in use, or one with work nobody committed, keeps its
     * handle, and each reconcile tries it again.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostWorktreeCleanupService.ts#L418-L432
     */
    'vscode/deleteAgentHostDetachedWorktree': async (params) => {
      const handle = handleOf(params);
      const held = detached.get(handle);
      if (held === undefined) return {};
      held.deleting = true;
      if (await takeDown(handle, held, false)) detached.delete(handle);
      return {};
    },
    /*
     * The handles the window still holds, under the scope of one tree's
     * folder, as VS Code's host reconciles them: a handle it names is seen
     * again, and one it does not name is let go once the grace has passed,
     * its tree taken away when nothing uses it and nobody's work is in it,
     * and its handle kept until then. Each removal the window asked for that
     * is still owed is tried again, whatever the scope.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4069-L4084
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/worktreeIsolation.ts#L805-L908
     */
    'vscode/reconcileAgentHostDetachedWorktrees': async (params) => {
      const { scope, activeHandles } = params;
      if (typeof scope !== 'string' || scope === '') throw new RpcError(INVALID_PARAMS, 'scope must be a non-empty string');
      if (!Array.isArray(activeHandles) || !activeHandles.every((one) => typeof one === 'string' && WORKTREE_HANDLE.test(one))) {
        throw new RpcError(INVALID_PARAMS, 'activeHandles must contain valid worktree handles');
      }
      const here = atPath(localPath(scope));
      const active = new Set<unknown>(activeHandles);
      const now = clock();
      for (const [handle, held] of [...detached]) {
        const inScope = atPath(held.path) === here;
        const named = !held.deleting && inScope && active.has(handle);
        if (named) held.lastSeenAt = now;
        const owed = held.deleting || held.archived;
        if (!owed && (named || !inScope || now - (held.claimed ? held.lastSeenAt : held.createdAt) < DETACHED_GRACE)) continue;
        if (await takeDown(handle, held, held.archived && !held.deleting) && !held.archived) detached.delete(handle);
      }
      return {};
    },
    /*
     * An artifact taken off a session, as the reference host takes one: the
     * params checked and refused in its words, the session restored first, a
     * session it cannot restore refused in its restore's words, and an id the
     * session does not hold left as it is.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3400-L3417
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3600-L3612
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L2292-L2305
     */
    'vscode/removeSessionArtifact': async (params) => {
      const session = stringParam(params, 'session', 'a URI string');
      const artifactId = stringParam(params, 'artifactId');
      if (artifactId.trim() === '') throw new RpcError(INVALID_PARAMS, 'artifactId must be a non-empty string');
      if (!URL.canParse(session)) throw new RpcError(INVALID_PARAMS, 'session must be a valid URI string');
      const parsed = new URL(session);
      if (!parsed.pathname.startsWith('/') || parsed.pathname.length < 2 || parsed.host !== ''
        || parsed.search !== '' || parsed.hash !== '' || spaceOf(session) === 'chat') {
        throw new RpcError(INVALID_PARAMS, 'session must be an Agent Session URI');
      }
      if (!sessions.has(session) && (ctx.unavailableProvider(idOf(session)) !== undefined
        || await ctx.restoreSession(idOf(session)) === undefined || ctx.nameOf(idOf(session)) !== session)) {
        throw new RpcError(AhpErrorCodes.SessionNotFound, `No agent for session: ${session}`);
      }
      const held = kept.artifacts(idOf(session)) ?? [];
      const left = held.filter((one) => one.id !== artifactId);
      if (left.length !== held.length) setArtifacts(session, left);
      return {};
    },
    /**
     * Stop a chat's background task.
     *
     * The two strings are checked here rather than in `background`: a request
     * that names no id, or something that is not a chat, is refusable on its
     * own terms, and answering `{ stopped: false }` for it would say the task
     * had already ended.
     *
     * Everything after that is one answer, `false`, because the client is not
     * told which of an unknown chat, an unknown id and a task with nothing to
     * stop it was - the reference host's own shape, and a client shows the
     * same thing after each.
     */
    'vscode/stopBackgroundWork': async (params) => {
      const chat = stringParam(params, 'chat', 'an AHP chat URI');
      const id = stringParam(params, 'id', 'a task id');
      // Each refusal in the reference host's words, in its order.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3432-L3444
      if (id.trim() === '') throw new RpcError(INVALID_PARAMS, 'id must be a non-empty string');
      if (!URL.canParse(chat)) throw new RpcError(INVALID_PARAMS, 'chat must be a valid URI string');
      if (spaceOf(chat) !== 'chat') throw new RpcError(INVALID_PARAMS, 'chat must be an Agent Host chat URI');
      return { stopped: await ctx.background.stop(chat, id) };
    },
    /**
     * Where the backend's own record of a session is.
     *
     * The window's "open session state file", behind
     * `_meta['vscode.getAgentHostSessionStateFile.chat']` in `initialize`
     * since it names a chat as well as a session. A backend that writes
     * no such file answers no resource, which is the reference host's
     * answer too.
     */
    'vscode/getAgentHostSessionStateFile': async (params) => {
      const session = stringParam(params, 'session', 'a URI string');
      const chat = optionalStringParam(params, 'chat', 'a URI string');
      const found = stateFileOf(session, chat);
      return found === undefined ? {} : { resource: uriOf(found) };
    },
    /**
     * The logs, packed up for a bug report.
     *
     * The host's own files under `agenthost/`, and the session's record
     * as `events.jsonl` when a session is named - the names the reference
     * host's collector gives them, so the window reads the result the
     * same. The archive is read back in chunks; the directory is opened
     * where it is.
     */
    /*
     * Followed under the client's progress token, as the reference host
     * follows a collection: a token already in use refused, `root/progress`
     * said as it goes and once more when it settles, marked as the debug
     * logs', and the collection called off by its client's cancel or when
     * that client goes.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4086-L4158
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L16074-L16101
     */
    'vscode/collectAgentHostDebugLogs': async (params) => {
      const kind = params.kind;
      if (kind !== 'archive' && kind !== 'directory') throw new RpcError(INVALID_PARAMS, 'kind must be archive or directory');
      const session = optionalStringParam(params, 'session', 'a URI string');
      const chat = optionalStringParam(params, 'chat', 'a URI string');
      const token = optionalStringParam(params, 'progressToken');
      if (session !== undefined && !URL.canParse(session)) throw new RpcError(INVALID_PARAMS, 'session must be a valid URI string');
      if (chat !== undefined && !URL.canParse(chat)) throw new RpcError(INVALID_PARAMS, 'chat must be a valid URI string');
      if (chat !== undefined && session === undefined) throw new RpcError(INVALID_PARAMS, 'chat must belong to the requested Agent Session');
      // The session's backend's file first, then the host's own, the order the
      // reference collector takes them in.
      const record = session === undefined ? undefined : stateFileOf(session, chat);
      const owning = session === undefined ? undefined : (sessions.has(session) ? session : sessionFor(session));
      const provider = owning === undefined ? undefined : (sessions.get(owning)?.agent ?? owners.get(owning))?.provider;
      const files: LogFile[] = [
        ...(record !== undefined && provider !== undefined ? [{ path: 'events.jsonl', from: record, provider }] : []),
        ...(options.diagnostics?.logs?.() ?? []).map((file) => ({ path: hostLogPath(file), from: file })),
      ];
      const said = (progress: number, total: number | undefined, message?: string): void => {
        ctx.broadcast(ROOT, 'root/progress', {
          channel: ROOT, progressToken: token, progress,
          ...(total === undefined ? {} : { total }),
          ...(message === undefined ? {} : { message }),
          _meta: { 'vscode.debugLogs': true },
        });
      };
      let last = 0;
      try {
        return await logs.collect(files, kind, token === undefined ? undefined : {
          token,
          owner: connection.clientId,
          report: (bytes, total, message) => {
            last = bytes;
            said(bytes, total > 0 ? total : undefined, message);
          },
        });
      }
      finally {
        if (token !== undefined) said(last, last);
      }
    },
    /*
     * A collection called off by the client that follows it, in the reference
     * host's words for a token it does not follow.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4148-L4159
     */
    'vscode/cancelAgentHostDebugLogs': async (params) => {
      if (typeof params.progressToken !== 'string') throw new RpcError(INVALID_PARAMS, 'progressToken must be a string');
      if (!logs.cancel(params.progressToken, connection.clientId)) throw new RpcError(INVALID_PARAMS, 'Unknown debug-log collection');
      return {};
    },
    /*
     * One chunk of an artifact, the params refused in the reference host's
     * words and a failure of the read itself left as it is, which the wire
     * answers as an internal error.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L4160-L4184
     */
    'vscode/readAgentHostDebugLogsChunk': async (params) => {
      const resource = params.resource;
      if (typeof resource !== 'string') throw new RpcError(INVALID_PARAMS, 'resource must be a URI string');
      if (!URL.canParse(resource)) throw new RpcError(INVALID_PARAMS, 'resource must be a valid URI string');
      const position = params.position;
      if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0) {
        throw new RpcError(INVALID_PARAMS, 'position must be a non-negative integer');
      }
      return await logs.read(resource, position);
    },
    /**
     * The four the window asks of its own host about itself.
     *
     * `shutdown` closes the host, every backend stopped and every store
     * closed, then the debug logs, and answers once that is done, as the
     * reference host's shutdown shuts its providers down and answers after;
     * then, the answer gone, it runs the embedder's own end, which in the
     * daemon stops it the way `ahpd stop` does, as upstream decided. The
     * reference host's process stays up because the window that owns it ends
     * it, and a daemon has no window that owns it. The network diagnostics
     * are what the process can see - the proxy variables, and the endpoints
     * its backends name - and `diagnosticsFetch` tries one. Managed settings
     * answer an empty list, the host holding no managed policy layer.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L16018-L16051
     */
    shutdown: async () => {
      await ctx.shutdown();
      await logs.close();
      const end = options.diagnostics?.shutdown;
      if (end !== undefined) {
        setTimeout(() => {
          Promise.resolve().then(end).catch((error: unknown) => {
            log(`shutdown did not end the process: ${error instanceof Error ? error.message : String(error)}`);
          });
        }, 0);
      }
      return {};
    },
    /*
     * The report as the reference host composes it: the backends' endpoints
     * once each by URL, the first account a backend is signed in as, and the
     * version where the daemon gave one.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostProviderService.ts#L199-L233
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/networkDiagnosticsService.ts#L65-L96
     */
    getNetworkDiagnosticsInfo: async () => {
      const proxyEnv: Record<string, string> = {};
      for (const key of PROXY_ENV) {
        const value = process.env[key];
        if (value) proxyEnv[key] = value;
      }
      const named = [...agents.values()].flatMap((agent) => agent.endpoints?.() ?? []);
      if (options.github !== undefined) named.push({ name: 'GitHub API', url: 'https://api.github.com/' });
      const seen = new Set<string>();
      const endpoints = named.filter((endpoint) => {
        const key = URL.canParse(endpoint.url) ? new URL(endpoint.url).toString() : endpoint.url;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const account = [...agents.values()].map((agent) => ctx.learned.get(agent.provider)?.account?.email).find((email) => email !== undefined && email !== '');
      const version = options.diagnostics?.version;
      return {
        ...(version === undefined ? {} : { version }),
        os: process.platform,
        arch: process.arch,
        ...(account === undefined ? {} : { account }),
        proxySettings: {},
        proxyEnv,
        endpoints,
      };
    },
    getManagedSettingsDiagnostics: async () => [],
    /*
     * One endpoint probed as the reference host probes it: a URL that does not
     * parse fails the request, and the result reports the proxy the probe goes
     * through. This process's fetch goes through the environment's proxy only
     * when Node is told to use it, and then through the one undici's
     * environment agent picks for the URL: NO_PROXY's entries match a host or
     * a domain under it, at a port where one is named.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/networkDiagnosticsService.ts#L106-L155
     * https://github.com/nodejs/undici/blob/v8.10.2/lib/dispatcher/env-http-proxy-agent.js#L64-L160
     */
    diagnosticsFetch: async (params) => {
      const url = stringParam(params, 'url');
      const target = new URL(url);
      const [dnsIpv4, dnsIpv6] = await Promise.all([resolved(target.hostname, 4), resolved(target.hostname, 6)]);
      const viaEnvironment = process.env.NODE_USE_ENV_PROXY === '1' || process.execArgv.includes('--use-env-proxy');
      const http = process.env.http_proxy ?? process.env.HTTP_PROXY;
      const named = target.protocol === 'https:' ? process.env.https_proxy ?? process.env.HTTPS_PROXY ?? http : http;
      const bare = target.hostname.startsWith('[') ? target.hostname.slice(1, -1) : target.hostname;
      const host = (bare.length > 1 && bare.endsWith('.') ? bare.slice(0, -1) : bare).toLowerCase();
      const port = Number(target.port) || (target.protocol === 'https:' ? 443 : 80);
      const noProxy = process.env.no_proxy ?? process.env.NO_PROXY ?? '';
      const skipped = noProxy === '*' || noProxy.split(/[,\s]/).filter((entry) => entry !== '').some((entry) => {
        const bracketed = entry.startsWith('[') ? entry.indexOf(']:') : -1;
        const single = entry.indexOf(':') === entry.lastIndexOf(':') ? entry.lastIndexOf(':') : -1;
        const cut = bracketed > 0 ? bracketed + 1 : single;
        const digits = cut > 0 ? entry.slice(cut + 1) : '';
        const at = digits !== '' && [...digits].every((one) => one >= '0' && one <= '9') ? Number(digits) : 0;
        const raw = at > 0 ? entry.slice(0, cut) : entry;
        const unbracketed = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
        const dotless = unbracketed.startsWith('*.') ? unbracketed.slice(2) : unbracketed.startsWith('.') ? unbracketed.slice(1) : unbracketed;
        const name = (dotless.length > 1 && dotless.endsWith('.') ? dotless.slice(0, -1) : dotless).toLowerCase();
        return (at === 0 || at === port) && (host === name || host.endsWith(`.${name}`));
      });
      const proxyUrl = viaEnvironment && named !== undefined && named !== '' && !skipped ? named : undefined;
      const base = { url, ...(proxyUrl === undefined ? {} : { proxyUrl }), dnsIpv4, dnsIpv6 };
      const began = Date.now();
      try {
        const answer = await fetch(target, { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
        const body = await answer.text();
        return {
          ...base,
          statusCode: answer.status,
          body: body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body,
          durationMs: Date.now() - began,
        };
      }
      catch (error) {
        return { ...base, error: reason(error), durationMs: Date.now() - began };
      }
    },
    /*
     * The dev container surface, name for name.
     *
     * The reference client asks these four, and it reads the capability key
     * on `initialize` before it offers the flow at all, so the names and
     * the shapes are another program's on purpose. What crosses here is a
     * nested host's own frames: this host carries them and does not read
     * them, which is what makes the container the container's and not
     * this host's pretending to be there.
     */
    'vscode/devContainers/isDockerAvailable': async () =>
      need(options.containers, 'vscode/devContainers/isDockerAvailable').docker(),
    'vscode/devContainers/connect': async (params) => {
      const launcher = need(options.containers, 'vscode/devContainers/connect');
      const one = containerAsk(params);
      // In VS Code's words for a connection id this client holds.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L159-L162
      if (conn.containers.has(one.connectionId)) {
        throw new RpcError(INVALID_PARAMS, 'Dev Container connectionId is already in use');
      }
      // Held before the first await, so a second connect under the same
      // name cannot slip in while this one is building an image.
      conn.containers.set(one.connectionId, { name: one.name, folder: one.workspaceFolder, tail: [] });
      await vouchedFor(one.workspaceFolder, 'Workspace trust is required to start a Dev Container')
        .catch((refused: unknown) => { conn.containers.delete(one.connectionId); throw refused; });
      /*
       * A starting line, because "asked for" and "never asked" otherwise
       * look the same in this log: the only other thing written about a
       * container is its ending, and by then the question has moved on.
       */
      log(`dev container ${one.connectionId} starting in ${one.workspaceFolder}`);
      /**
       * The relay ended, whoever ended it.
       *
       * The map is what says whether this connection still owns it: an
       * explicit `disconnect` forgets the name first, so the client that
       * asked is not told what it already knows.
       */
      const ended = (why?: string): void => {
        const held = conn.containers.get(one.connectionId);
        if (!conn.containers.delete(one.connectionId)) return;
        connection.peer.notify('vscode/devContainers/relayClose', { connectionId: one.connectionId });
        connection.peer.notify('vscode/devContainers/closeConnection', { connectionId: one.connectionId });
        if (why !== undefined && why !== '') {
          /*
           * The launcher's own last words, which are usually the reason.
           *
           * `ended: exit 1` was all this said, and the cause - a path that
           * does not exist inside the container, an install that failed -
           * was sent only to whichever client happened to be watching.
           */
          const tail = (held?.tail ?? []).filter((line) => line.trim() !== '').slice(-8);
          log(`dev container ${one.connectionId} ended: ${why}${
            tail.length === 0 ? '' : `\n  ${tail.join('\n  ')}`}`);
        }
      };
      const sink: ContainerSink = {
        message: (data) => {
          connection.peer.notify('vscode/devContainers/relayMessage', { connectionId: one.connectionId, data });
        },
        output: (data) => {
          connection.peer.notify('vscode/devContainers/output', { connectionId: one.connectionId, data });
          // Kept for an ending to explain itself, bounded so a long build
          // cannot grow the daemon's memory with output nobody will read.
          const held = conn.containers.get(one.connectionId);
          if (held === undefined) return;
          for (const line of String(data).split('\n')) {
            if (line.trim() !== '') held.tail.push(line);
          }
          if (held.tail.length > CONTAINER_TAIL) {
            held.tail.splice(0, held.tail.length - CONTAINER_TAIL);
          }
        },
        close: (why) => { ended(why); },
      };
      let result: ContainerConnectResult;
      try {
        /*
         * Whose the container is, which the client cannot say.
         *
         * The connection is the whole of the answer: a person who has signed
         * in owns what their relay runs, and a connection the host made for
         * itself is the host.
         */
        const owner = ownerFor(connection);
        result = await launcher.connect(owner === undefined ? one : { ...one, owner }, sink);
        log(`dev container ${one.connectionId} up: ${result.address} (${result.remoteWorkspaceFolder})`);
      }
      catch (error) {
        // Nothing left running: the launcher is told to release whatever it
        // had begun, and the name is free again.
        conn.containers.delete(one.connectionId);
        try { await launcher.disconnect(one.connectionId); } catch { /* already gone */ }
        log(`dev container ${one.connectionId} failed: ${reason(error)}`);
        throw error;
      }
      if (!conn.alive) {
        // The client went while the image was building. Its containers are
        // not something to leave behind for nobody.
        conn.containers.delete(one.connectionId);
        try { await launcher.disconnect(one.connectionId); } catch { /* already gone */ }
        log(`dev container ${one.connectionId} abandoned: the client went away while it was starting`);
        throw new Error(`The connection went away while ${one.connectionId} was starting`);
      }
      return { connectionId: one.connectionId, name: one.name, ...result };
    },
    'vscode/devContainers/disconnect': async (params) => {
      const launcher = need(options.containers, 'vscode/devContainers/disconnect');
      const id = namedContainer(params);
      // A connection this client does not hold, in VS Code's words.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L151-L157
      if (!conn.containers.delete(id)) {
        throw new RpcError(-32008, 'Dev Container connection is not owned by this client');
      }
      // Nothing is notified: the client asked for this, and the reference
      // host's own client forgets the connection on its side as it does.
      await launcher.disconnect(id);
    },
    'vscode/devContainers/relaySend': async (params) => {
      const launcher = need(options.containers, 'vscode/devContainers/relaySend');
      const id = namedContainer(params);
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/devContainerAgentHostProtocol.ts#L151-L157
      if (!conn.containers.has(id)) {
        throw new RpcError(-32008, 'Dev Container connection is not owned by this client');
      }
      const data = stringParam(params, 'data');
      // The frame is written and not read: the nested host is the one that
      // answers it, and what it answers with comes back as `relayMessage`.
      await launcher.send(id, data);
    },
    /*
     * The two the reference host sends when a dev container is idle or gone.
     *
     * Both take `{ workspaceFolder }` and answer a boolean, because a dev
     * container is a folder's here and not a connection's: the reference ends
     * the folder's relays, stops or removes the container, and answers `false`
     * while another client still uses it. This host answers the same, with one
     * more user than the reference has - a session placed on the folder's
     * computer, which after `container/03` is a machine ahpd sessions run in.
     */
    'vscode/devContainers/stop': async (params) => await devContainerStopped('stop', params),
    'vscode/devContainers/remove': async (params) => await devContainerStopped('remove', params),
  };
}