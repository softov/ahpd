import { INTERNAL_ERROR, RpcError } from '../rpc.js';
import { bag } from '../utils/values.js';
import { ROOT } from './channels.js';
import { fromAgentClientUri, toAgentClientUri } from './clienturi.js';
import type { Clients, Connection } from '../types/host.js';
import type { Entry, Metadata, Read, ResourceChange, ResourceProvider, Watcher } from '../types/resources.js';
import type { HostContext } from './context.js';

/**
 * How long a request for a client whose last connection has closed waits for
 * it to come back: VS Code's client filesystem holds a client's slot for this
 * long, so an operation in a reconnect's window waits for the replacement.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostFileSystemProvider.ts#L205-L216
 */
const CONNECTION_GRACE_MS = 5_000;

/** A client's resources as the store their scheme is served by, with the access request a client answers. */
export type ClientResources = Required<Pick<ResourceProvider, 'list' | 'resolve' | 'watch' | 'write' | 'remove' | 'mkdir' | 'move' | 'copy'>>
  & Pick<ResourceProvider, 'read'>
  & { request(uri: string, access: { read?: boolean; write?: boolean }): Promise<unknown> };

/** The connected clients, as places a resource can come from. */
export interface Relay {
  readonly clients: Clients;
  /** The resources clients serve, under VS Code's client scheme. */
  readonly clientResources: ClientResources;
  ownId(clientId: string): boolean;
  claimsId(one: Connection): boolean;
  /** An action envelope a client sent on a watch channel this host subscribed to on that connection. */
  heard(connection: Connection, envelope: Record<string, unknown>): void;
  /** A connection that has closed: what it reported stops, and a request for its client waits out the grace. */
  clientGone(connection: Connection): void;
  /** A connection that answers for its client's id: every request and watch waiting on that client goes on. */
  clientBack(clientId: string): void;
}

export function createRelay(ctx: HostContext): Relay {
  const { connections, holders, log } = ctx;

  /**
   * Whether a client id is one a person can hold: a client that names none
   * is `anonymous` (or empty), which is every such client and nobody's.
   */
  const ownId = (clientId: string): boolean => clientId !== '' && clientId !== 'anonymous';
  /**
   * Whether a connection answers for its client id: always with no users
   * directory and for the door, never for a connection with no id of its
   * own, and otherwise when nobody holds the id (`holders`) or the person
   * signed in on it does and still stands.
   */
  const claimsId = (one: Connection): boolean => {
    if (ctx.options.users === undefined || one.root === true) return true;
    if (!ownId(one.clientId)) return false;
    const holder = holders.get(one.clientId);
    if (holder === undefined) return true;
    const who = one.principal;
    return who !== undefined && who.id === holder && (who.standing === undefined || who.standing());
  };
  /** The connection answering for a client id now, the newest where it has several. */
  const connectedAs = (clientId: string): Connection | undefined =>
    [...connections].reverse().find((one) => one.clientId === clientId && claimsId(one));
  /**
   * The clients whose last connection closed inside the grace, each with what
   * waits on its return: a request settles with the connection that comes
   * back, or with nothing once the grace is out.
   */
  const lapsing = new Map<string, { timer: ReturnType<typeof setTimeout>; waits: ((one: Connection | undefined) => void)[] }>();
  /** What reattaches each client's watches once a connection answers for it again. */
  const reattach = new Map<string, Set<() => void>>();
  /** The watch channels this host subscribed to on each connection, and whom each change goes to. */
  const listening = new Map<Connection, Map<string, (changes: ResourceChange[]) => void>>();

  /**
   * The connection to ask for a client's resource.
   *
   * A client whose connection closed inside the grace is waited for, and one
   * that is not back by its end, or was never here, is refused in VS Code's
   * words, as its client filesystem refuses an authority it has no
   * connection for.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostFileSystemProvider.ts#L598-L624
   */
  const connectionFor = async (clientId: string): Promise<Connection> => {
    const now = connectedAs(clientId);
    if (now !== undefined) return now;
    const held = lapsing.get(clientId);
    const back = held === undefined ? undefined : await new Promise<Connection | undefined>((resolve) => { held.waits.push(resolve); });
    if (back === undefined) throw new RpcError(INTERNAL_ERROR, `No connection for authority: ${clientId}`);
    return back;
  };
  /**
   * One request to a client, with the channel every one of the ten declares.
   *
   * The client's refusal goes back as the client said it, and is written down
   * here: `-32009` from a client that published a directory read-only and
   * `-32009` from one that has not finished working out who is asking are the
   * same three digits to whoever asked, and the only place the method, the
   * URI and the client are visible together is this log.
   */
  const ask = async (client: string, method: string, params: Record<string, unknown>): Promise<unknown> => {
    const held = await connectionFor(client);
    const about = String(params.uri ?? params.source ?? '');
    return await held.peer.request(method, { ...params, channel: ROOT }).catch((error: unknown) => {
      const code = (error as { code?: unknown }).code;
      const said = error instanceof Error ? error.message : String(error);
      log(`${client} refused ${method} for ${about}${typeof code === 'number' ? ` (${String(code)})` : ''}: ${said}`);
      throw error;
    });
  };
  /** The client a URI under the client scheme names and the URI as that client knows it. */
  const addressed = (uri: string): { client: string; original: string } => {
    const at = fromAgentClientUri(uri);
    if (at === undefined) throw new RpcError(INTERNAL_ERROR, `${uri} names no client`);
    return at;
  };

  /**
   * A client's resources, as VS Code's host reaches them: each request goes to
   * the client the URI's authority names, about the URI as that client knows
   * it, and a move or a copy goes to the source's client with both URIs as it
   * knows them.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostFileSystemProvider.ts#L432-L561
   */
  const clientResources: ClientResources = {
    read: async (uri, wanted) => {
      const at = addressed(uri);
      return await ask(at.client, 'resourceRead', { uri: at.original, ...(wanted !== undefined ? { encoding: wanted } : {}) }) as Read;
    },
    list: async (uri) => {
      const at = addressed(uri);
      const entries = bag(await ask(at.client, 'resourceList', { uri: at.original })).entries;
      return Array.isArray(entries) ? entries as Entry[] : [];
    },
    /*
     * The answer under the URI it was asked about, as VS Code's host reports a
     * stat it reads through a client, and a client's root a directory without
     * asking, as its client filesystem answers one.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostFileSystemProvider.ts#L432-L464
     */
    resolve: async (uri, followSymlinks) => {
      const at = addressed(uri);
      const path = URL.canParse(at.original) ? new URL(at.original).pathname : '';
      if (path === '/' || path === '') {
        const epoch = new Date(0).toISOString();
        return { uri, type: 'directory', size: 0, mtime: epoch, ctime: epoch };
      }
      const answer = await ask(at.client, 'resourceResolve', { uri: at.original, ...(followSymlinks !== undefined ? { followSymlinks } : {}) });
      return { ...bag(answer), uri } as unknown as Metadata;
    },
    write: async (uri, content) => {
      const at = addressed(uri);
      await ask(at.client, 'resourceWrite', { ...content, uri: at.original });
    },
    remove: async (uri, recursive) => {
      const at = addressed(uri);
      await ask(at.client, 'resourceDelete', { uri: at.original, ...(recursive !== undefined ? { recursive } : {}) });
    },
    mkdir: async (uri) => {
      const at = addressed(uri);
      await ask(at.client, 'resourceMkdir', { uri: at.original });
    },
    move: async (source, destination, failIfExists) => {
      const at = addressed(source);
      await ask(at.client, 'resourceMove', {
        source: at.original, destination: fromAgentClientUri(destination)?.original ?? destination,
        ...(failIfExists !== undefined ? { failIfExists } : {}),
      });
    },
    copy: async (source, destination, failIfExists) => {
      const at = addressed(source);
      await ask(at.client, 'resourceCopy', {
        source: at.original, destination: fromAgentClientUri(destination)?.original ?? destination,
        ...(failIfExists !== undefined ? { failIfExists } : {}),
      });
    },
    request: async (uri, access) => {
      const at = addressed(uri);
      return await ask(at.client, 'resourceRequest', { uri: at.original, ...access });
    },
    /**
     * A watch on a client's resource, as the protocol runs one this host is
     * the caller of: the client is asked for a watch and answers its channel,
     * this host subscribes to that channel on the client's connection, and
     * the client sends each batch back over the action envelope, which is
     * said here under the client scheme. Unsubscribed at the close. A client
     * that drops and comes back is asked again on its new connection, as VS
     * Code's client filesystem attaches a watch again across a reconnect.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/resource-watch-channel.md#L32-L54
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/specification/resource-watch-channel.md#L83
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostFileSystemProvider.ts#L309-L415
     */
    watch: async (uri, options, onChange): Promise<Watcher> => {
      const at = addressed(uri);
      let live: { connection: Connection; channel: string } | undefined;
      let closed = false;
      const told = (changes: ResourceChange[]): void => {
        onChange(changes.map((one) => ({ ...one, uri: toAgentClientUri(one.uri, at.client) })));
      };
      const attach = async (): Promise<void> => {
        const owner = await connectionFor(at.client);
        const channel = String(bag(await owner.peer.request('createResourceWatch', {
          channel: ROOT,
          uri: at.original,
          recursive: options.recursive === true,
          ...(options.excludes !== undefined && options.excludes.length > 0 ? { excludes: { items: options.excludes } } : {}),
          ...(options.includes !== undefined && options.includes.length > 0 ? { includes: { items: options.includes } } : {}),
        })).channel ?? '');
        if (channel === '') throw new RpcError(INTERNAL_ERROR, `${at.client} answered no watch channel for ${at.original}`);
        const heard = listening.get(owner) ?? new Map<string, (changes: ResourceChange[]) => void>();
        listening.set(owner, heard.set(channel, told));
        await owner.peer.request('subscribe', { channel });
        if (closed) {
          heard.delete(channel);
          owner.peer.notify('unsubscribe', { channel });
          return;
        }
        live = { connection: owner, channel };
      };
      const again = (): void => {
        if (closed || (live !== undefined && connections.has(live.connection))) return;
        live = undefined;
        attach().catch((error: unknown) => { log(`${at.client} would not watch ${at.original} again: ${String(error)}`); });
      };
      await attach();
      reattach.set(at.client, (reattach.get(at.client) ?? new Set<() => void>()).add(again));
      return {
        close: () => {
          closed = true;
          reattach.get(at.client)?.delete(again);
          if (live === undefined) return;
          listening.get(live.connection)?.delete(live.channel);
          if (connections.has(live.connection)) live.connection.peer.notify('unsubscribe', { channel: live.channel });
        },
      };
    },
  };

  const heard = (connection: Connection, envelope: Record<string, unknown>): void => {
    const action = bag(envelope.action);
    if (action.type !== 'resourceWatch/changed') return;
    const told = listening.get(connection)?.get(String(envelope.channel ?? ''));
    const items = bag(action.changes).items;
    if (told === undefined || !Array.isArray(items) || items.length === 0) return;
    told(items.filter((one): one is ResourceChange => typeof bag(one).uri === 'string' && typeof bag(one).type === 'string'));
  };

  const clientGone = (connection: Connection): void => {
    listening.delete(connection);
    const { clientId } = connection;
    if (!ownId(clientId) || connectedAs(clientId) !== undefined || lapsing.has(clientId)) return;
    const timer = setTimeout(() => {
      const held = lapsing.get(clientId);
      lapsing.delete(clientId);
      for (const wait of held?.waits ?? []) wait(undefined);
    }, CONNECTION_GRACE_MS);
    lapsing.set(clientId, { timer, waits: [] });
  };

  const clientBack = (clientId: string): void => {
    const one = connectedAs(clientId);
    if (one === undefined) return;
    const held = lapsing.get(clientId);
    if (held !== undefined) {
      clearTimeout(held.timer);
      lapsing.delete(clientId);
      for (const wait of held.waits) wait(one);
    }
    for (const again of reattach.get(clientId) ?? []) again();
  };

  /**
   * The connected clients, for a plugin: ten named methods over one request,
   * each to the client it names and about the URI as that client knows it.
   */
  const clients: Clients = {
    ids: () => [...connections].filter(claimsId).map((one) => one.clientId).filter((one) => one !== ''),
    owner: (uri) => {
      const client = fromAgentClientUri(uri)?.client;
      return client === undefined || connectedAs(client) === undefined ? undefined : client;
    },
    read: async (client, uri, encoding) => await ask(client, 'resourceRead', {
      uri, ...(encoding !== undefined ? { encoding } : {}),
    }),
    list: async (client, uri) => await ask(client, 'resourceList', { uri }),
    resolve: async (client, uri) => await ask(client, 'resourceResolve', { uri }),
    write: async (client, uri, content) => await ask(client, 'resourceWrite', { uri, ...content }),
    remove: async (client, uri, recursive) => await ask(client, 'resourceDelete', {
      uri, ...(recursive !== undefined ? { recursive } : {}),
    }),
    move: async (client, source, destination, failIfExists) => await ask(client, 'resourceMove', {
      source, destination, ...(failIfExists !== undefined ? { failIfExists } : {}),
    }),
    copy: async (client, source, destination, failIfExists) => await ask(client, 'resourceCopy', {
      source, destination, ...(failIfExists !== undefined ? { failIfExists } : {}),
    }),
    mkdir: async (client, uri) => await ask(client, 'resourceMkdir', { uri }),
    watch: async (client, uri, watching) => await ask(client, 'createResourceWatch', { uri, ...watching }),
    request: async (client, uri, access) => await ask(client, 'resourceRequest', { uri, ...access }),
  };

  return { clients, clientResources, ownId, claimsId, heard, clientGone, clientBack };
}
