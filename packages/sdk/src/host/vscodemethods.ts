import { lookup } from 'node:dns/promises';
import { stat } from 'node:fs/promises';
import { INTERNAL_ERROR, METHOD_NOT_FOUND, RpcError } from '../rpc.js';
import { idOf } from '../catalog.js';
import { hostLogPath } from '../debuglogs.js';
import { localPath, uriOf } from '../fileuri.js';
import { need, reason } from './common.js';
import type { LogFile } from '../debuglogs.js';
import type { ContainerConnect, ContainerConnectResult, ContainerSink } from '../types/containers.js';
import type { ConnectionContext, HostContext } from './context.js';

/** The proxy variables the network diagnostics report, when set. */
const PROXY_ENV = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'] as const;
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

/** How much of the launcher's output is kept to explain an ending. */
const CONTAINER_TAIL = 24;

/**
 * The methods the reference window asks of its own host, and the diagnostics
 * it asks the process about.
 *
 * The worktree handles it holds, the session state file and the logs it
 * collects, its own shutdown, and the four devContainer requests the relay is
 * decided on - decision `the-relay-surface-is-the-reference-one`.
 */
export interface VscodeMethods {
  'vscode/createAgentHostDetachedWorktree': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/claimAgentHostDetachedWorktree': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/setAgentHostDetachedWorktreeArchived': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/deleteAgentHostDetachedWorktree': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/reconcileAgentHostDetachedWorktrees': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/removeSessionArtifact': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/getAgentHostSessionStateFile': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/collectAgentHostDebugLogs': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/readAgentHostDebugLogsChunk': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/isDockerAvailable': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/connect': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/disconnect': (params: Record<string, unknown>) => Promise<unknown>;
  'vscode/devContainers/relaySend': (params: Record<string, unknown>) => Promise<unknown>;
  shutdown: (params: Record<string, unknown>) => Promise<unknown>;
  getNetworkDiagnosticsInfo: (params: Record<string, unknown>) => Promise<unknown>;
  getManagedSettingsDiagnostics: (params: Record<string, unknown>) => Promise<unknown>;
  diagnosticsFetch: (params: Record<string, unknown>) => Promise<unknown>;
}

export function createVscodeMethods(ctx: HostContext, conn: ConnectionContext): VscodeMethods {
  const { connection } = conn;
  const {
    agents, byChat, chatOf, detached, dirOf, kept, leadOf, log, logs, options, ownerFor, owners,
    sessionFor, sessions, setArtifacts, worktrees,
  } = ctx;

  /**
   * The backend's own file for a session, or for one chat of it.
   *
   * A chat here is its own backend session with an id of its own, so a chat
   * named is that id; a session named is its lead's. A row that is not
   * running has the id in its URI, which is what the catalogue listed it by.
   */
  const stateFileOf = (session: string, chat?: string): string | undefined => {
    const uri = sessions.has(session) ? session : sessionFor(session);
    const held = sessions.get(uri);
    const agent = held?.agent ?? owners.get(uri);
    const dir = dirOf(uri);
    const chosen = chat === undefined ? undefined : byChat.get(chatOf(chat));
    if (chat !== undefined && chosen?.uri !== uri) throw new RpcError(-32602, 'chat must belong to the requested Agent Session');
    if (agent?.stateFile === undefined || dir === undefined) return undefined;
    const live = chosen?.chat ?? (held ? leadOf(held) : undefined);
    return agent.stateFile(live?.agentId() ?? idOf(uri), dir);
  };

  /**
   * The three strings a connect carries from the client, checked once.
   *
   * A `connectionId` is a name a client chose, so it is bounded: non-empty,
   * no NUL, and short enough to be an identifier rather than a payload.
   * Whether the folder exists and has a container definition is the
   * launcher's to answer, because that is a question about a filesystem.
   * The owner is not among them: the client does not name one, and the
   * call below fills it from the connection the ask arrived on.
   */
  const containerAsk = (params: Record<string, unknown>): ContainerConnect => {
    const id = typeof params.connectionId === 'string' ? params.connectionId : '';
    if (id.trim() === '' || id.length > 256 || id.includes('\0')) {
      throw new RpcError(-32602, 'connectionId must be a non-empty identifier');
    }
    const folder = typeof params.workspaceFolder === 'string' ? params.workspaceFolder : '';
    if (folder.trim() === '' || folder.includes('\0')) {
      throw new RpcError(-32602, 'workspaceFolder must be a path on this host');
    }
    const name = typeof params.name === 'string' ? params.name : '';
    if (name.trim() === '' || name.includes('\0')) {
      throw new RpcError(-32602, 'name must be non-empty');
    }
    return { connectionId: id, workspaceFolder: folder, name };
  };

  /**
   * The one string a `disconnect` or a `relaySend` carries.
   *
   * The reference sends `{ connectionId }` and `{ connectionId, data }`,
   * so a folder is not asked for again: the connection was made with one.
   */
  const namedContainer = (params: Record<string, unknown>): string => {
    const id = typeof params.connectionId === 'string' ? params.connectionId : '';
    if (id.trim() === '' || id.length > 256 || id.includes('\0')) {
      throw new RpcError(-32602, 'connectionId must be a non-empty identifier');
    }
    return id;
  };

  return {
    /**
     * A handle on a session's worktree, for the window that manages it.
     *
     * The reference host makes the tree here, ahead of the session, from the
     * prompt; this host made it when the session was created, so the answer
     * is that tree and `prompt` has nothing left to name. A session with no
     * tree is not one the window can hold a handle on, and says so in the
     * reference host's words.
     */
    'vscode/createAgentHostDetachedWorktree': async (params) => {
      if (typeof params.session !== 'string') throw new RpcError(-32602, 'session must be a URI string');
      if (typeof params.prompt !== 'string') throw new RpcError(-32602, 'prompt must be a string');
      const uri = sessionFor(params.session);
      const tree = worktrees.get(uri);
      if (tree === undefined) {
        throw new RpcError(-32602, sessions.has(uri)
          ? `Session is not configured for worktree isolation: ${params.session}`
          : `Session not found: ${params.session}`);
      }
      const handle = crypto.randomUUID();
      const now = Date.now();
      detached.set(handle, {
        session: uri,
        repository: tree.repository,
        path: tree.path,
        ...(tree.branch !== undefined ? { branch: tree.branch } : {}),
        claimed: false,
        archived: false,
        createdAt: now,
        lastSeenAt: now,
      });
      log(`${connection.clientId || 'a client'} holds ${handle} on ${tree.path}`);
      return { handle, resource: uriOf(tree.path) };
    },
    /** The session started in the tree: the handle is in use, and stays until the window lets go. */
    'vscode/claimAgentHostDetachedWorktree': async (params) => {
      const handle = String(params.handle ?? '');
      const held = detached.get(handle);
      if (held === undefined) throw new RpcError(-32602, `Unknown detached worktree handle: ${handle}`);
      held.claimed = true;
      held.lastSeenAt = Date.now();
      return {};
    },
    /**
     * Archived is the tree taken down, and the branch kept so it can
     * come back; unarchived is the tree put back on that branch.
     *
     * Not while a session is running in it, and not with work nobody
     * committed in it - the same two judgements a disposal makes. A
     * handle nobody holds is nothing to do, the way the reference host
     * answers it.
     */
    'vscode/setAgentHostDetachedWorktreeArchived': async (params) => {
      const handle = String(params.handle ?? '');
      const archived = params.archived === true;
      const held = detached.get(handle);
      if (held === undefined) return {};
      held.archived = archived;
      const port = options.worktrees;
      if (port === undefined) return {};
      const present = await stat(held.path).then(() => true, () => false);
      if (archived) {
        if (!present) return {};
        if (sessions.has(held.session)) {
          log(`kept ${held.path}: ${held.session} is running in it`);
          return {};
        }
        if (await port.dirty(held.path).catch(() => true)) {
          log(`kept ${held.path}: it has changes nobody committed`);
          return {};
        }
        await port.remove(held.repository, held.path)
          .then(() => { log(`removed ${held.path} for the archived ${handle}`); })
          .catch((error: unknown) => { log(`kept ${held.path}: ${error instanceof Error ? error.message : String(error)}`); });
        return {};
      }
      if (held.branch === undefined || present) return {};
      await port.create({ repository: held.repository, base: held.branch, path: held.path })
        .then(() => { log(`put ${held.path} back on ${held.branch ?? ''} for ${handle}`); })
        .catch((error: unknown) => { log(`could not put ${held.path} back: ${error instanceof Error ? error.message : String(error)}`); });
      return {};
    },
    /** The window is done with the tree: gone, branch and all, unless a session is still in it. */
    'vscode/deleteAgentHostDetachedWorktree': async (params) => {
      const handle = String(params.handle ?? '');
      const held = detached.get(handle);
      if (held === undefined) return {};
      if (sessions.has(held.session)) throw new RpcError(-32004, `${held.session} is running in ${held.path}; dispose the session first`);
      detached.delete(handle);
      worktrees.delete(held.session);
      // Already gone with its session, which is the ordinary order of things.
      if (!await stat(held.path).then(() => true, () => false)) return {};
      await options.worktrees?.remove(held.repository, held.path, held.branch)
        .then(() => { log(`removed ${held.path} for ${handle}`); })
        .catch((error: unknown) => {
          throw new RpcError(INTERNAL_ERROR, `Could not remove ${held.path}: ${error instanceof Error ? error.message : String(error)}`);
        });
      return {};
    },
    /**
     * The set the window still knows about, under one scope.
     *
     * A handle it names is seen again; one it does not name, in that
     * scope, is let go once the grace has passed - the tree removed when
     * it is clean and nobody is in it, and kept when either is not so. A
     * scope is the repository the trees were made from, or the tree's
     * own path, since the reference client's spelling of it is its own.
     */
    'vscode/reconcileAgentHostDetachedWorktrees': async (params) => {
      const scope = localPath(String(params.scope ?? '')).replace(/\/$/, '');
      const active = new Set(Array.isArray(params.activeHandles) ? params.activeHandles.map(String) : []);
      const now = Date.now();
      for (const [handle, held] of detached) {
        if (held.repository !== scope && held.path !== scope) continue;
        if (active.has(handle)) {
          held.lastSeenAt = now;
          continue;
        }
        if (now - (held.claimed ? held.lastSeenAt : held.createdAt) < DETACHED_GRACE) continue;
        detached.delete(handle);
        if (sessions.has(held.session)) continue;
        const port = options.worktrees;
        if (port === undefined || await port.dirty(held.path).catch(() => true)) continue;
        worktrees.delete(held.session);
        await port.remove(held.repository, held.path, held.branch)
          .then(() => { log(`removed ${held.path}: the window let ${handle} go`); })
          .catch((error: unknown) => { log(`kept ${held.path}: ${error instanceof Error ? error.message : String(error)}`); });
      }
      return {};
    },
    'vscode/removeSessionArtifact': async (params) => {
      const session = String(params.session ?? '');
      const artifactId = String(params.artifactId ?? '').trim();
      if (session === '' || artifactId === '') throw new RpcError(-32602, 'session and artifactId must be non-empty strings');
      const uri = sessions.has(session) ? session : sessionFor(session);
      const held = kept.artifacts(idOf(uri)) ?? [];
      const left = held.filter((one) => one.id !== artifactId);
      if (left.length !== held.length) setArtifacts(uri, left);
      return {};
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
      if (typeof params.session !== 'string') throw new RpcError(-32602, 'session must be a URI string');
      if (params.chat !== undefined && typeof params.chat !== 'string') throw new RpcError(-32602, 'chat must be a URI string');
      const found = stateFileOf(params.session, params.chat);
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
    'vscode/collectAgentHostDebugLogs': async (params) => {
      const kind = params.kind;
      if (kind !== 'archive' && kind !== 'directory') throw new RpcError(-32602, 'kind must be archive or directory');
      if (params.session !== undefined && typeof params.session !== 'string') throw new RpcError(-32602, 'session must be a URI string');
      if (params.chat !== undefined && typeof params.chat !== 'string') throw new RpcError(-32602, 'chat must be a URI string');
      if (params.chat !== undefined && params.session === undefined) throw new RpcError(-32602, 'chat must belong to the requested Agent Session');
      const files: LogFile[] = (options.diagnostics?.logs?.() ?? []).map((file) => ({ path: hostLogPath(file), from: file }));
      const record = params.session === undefined ? undefined : stateFileOf(params.session, params.chat);
      if (record !== undefined) files.push({ path: 'events.jsonl', from: record, provider: true });
      return await logs.collect(files, kind);
    },
    'vscode/readAgentHostDebugLogsChunk': async (params) => {
      if (typeof params.resource !== 'string') throw new RpcError(-32602, 'resource must be a URI string');
      if (typeof params.position !== 'number') throw new RpcError(-32602, 'position must be a number');
      try { return await logs.read(params.resource, params.position); }
      catch (error) { throw new RpcError(-32602, error instanceof Error ? error.message : String(error)); }
    },
    /**
     * The four the window asks of its own host about itself.
     *
     * `shutdown` answers first and stops after, so the window hears yes
     * rather than a dropped socket. The network diagnostics are what the
     * process can see - the proxy variables, and the endpoints its
     * backends name - and `diagnosticsFetch` tries one. Managed settings
     * are a policy layer this host has no counterpart to, and an empty
     * list is the honest shape of that.
     */
    shutdown: async () => {
      const stop = options.diagnostics?.shutdown;
      if (stop === undefined) throw new RpcError(METHOD_NOT_FOUND, 'This host does not serve shutdown');
      setTimeout(() => { void Promise.resolve(logs.close()).then(() => stop()); }, 0);
      return {};
    },
    getNetworkDiagnosticsInfo: async () => {
      const proxyEnv: Record<string, string> = {};
      for (const key of PROXY_ENV) {
        const value = process.env[key];
        if (value) proxyEnv[key] = value;
      }
      const endpoints = [...agents.values()].flatMap((agent) => agent.endpoints?.() ?? []);
      if (options.github !== undefined) endpoints.push({ name: 'GitHub API', url: 'https://api.github.com/' });
      return {
        version: options.diagnostics?.version ?? '0.0.1',
        os: process.platform,
        arch: process.arch,
        proxySettings: {},
        proxyEnv,
        endpoints,
      };
    },
    getManagedSettingsDiagnostics: async () => [],
    diagnosticsFetch: async (params) => {
      if (typeof params.url !== 'string') throw new RpcError(-32602, 'url must be a string');
      let target: URL;
      try { target = new URL(params.url); }
      catch { throw new RpcError(-32602, `${params.url} is not a URL`); }
      const [dnsIpv4, dnsIpv6] = await Promise.all([resolved(target.hostname, 4), resolved(target.hostname, 6)]);
      const began = Date.now();
      try {
        const answer = await fetch(target, { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
        const body = await answer.text();
        return {
          url: params.url, dnsIpv4, dnsIpv6,
          statusCode: answer.status, statusMessage: answer.statusText,
          body: body.length > MAX_BODY ? body.slice(0, MAX_BODY) : body,
          durationMs: Date.now() - began,
        };
      }
      catch (error) {
        return { url: params.url, dnsIpv4, dnsIpv6, error: reason(error), durationMs: Date.now() - began };
      }
    },
    /*
     * The dev container surface, name for name.
     *
     * The reference client asks these four, and it reads the capability key
     * on `initialize` before it offers the flow at all, so the names and
     * the shapes are another program's on purpose - decision
     * `the-relay-surface-is-the-reference-one`. What crosses here is a
     * nested host's own frames: this host carries them and does not read
     * them, which is what makes the container the container's and not
     * this host's pretending to be there.
     */
    'vscode/devContainers/isDockerAvailable': async () =>
      need(options.containers, 'vscode/devContainers/isDockerAvailable').docker(),
    'vscode/devContainers/connect': async (params) => {
      const launcher = need(options.containers, 'vscode/devContainers/connect');
      const one = containerAsk(params);
      if (conn.containers.has(one.connectionId)) {
        throw new RpcError(-32602, `Dev Container connectionId ${one.connectionId} is already in use`);
      }
      // Held before the first await, so a second connect under the same
      // name cannot slip in while this one is building an image.
      conn.containers.set(one.connectionId, { name: one.name, folder: one.workspaceFolder, tail: [] });
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
         * itself is the host - decision
         * `a-relay-container-is-owned-by-who-connected`.
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
      if (!conn.containers.delete(id)) {
        throw new RpcError(-32008, `${id} is not a dev container this client opened`);
      }
      // Nothing is notified: the client asked for this, and the reference
      // host's own client forgets the connection on its side as it does.
      await launcher.disconnect(id);
    },
    'vscode/devContainers/relaySend': async (params) => {
      const launcher = need(options.containers, 'vscode/devContainers/relaySend');
      const id = namedContainer(params);
      if (!conn.containers.has(id)) {
        throw new RpcError(-32008, `${id} is not a dev container this client opened`);
      }
      if (typeof params.data !== 'string') throw new RpcError(-32602, 'data must be a string');
      // The frame is written and not read: the nested host is the one that
      // answers it, and what it answers with comes back as `relayMessage`.
      await launcher.send(id, params.data);
    },
  };
}