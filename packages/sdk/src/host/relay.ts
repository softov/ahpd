import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { Claiming } from './state.js';
import type { Clients, Connection } from '../types/host.js';
import { ROOT } from './channels.js';
import type { HostContext } from './context.js';

/** A URI a client published, and the client it is answered by. */
export interface Relay {
  readonly clients: Clients;
  readonly relayed: Claiming<{ owner: Connection; state: Record<string, unknown> }>;
  ownId(clientId: string): boolean;
  claimsId(one: Connection): boolean;
  ownerOf(uri: string): Connection | undefined;
  ask(client: string, method: string, params: Record<string, unknown>): Promise<unknown>;
  elsewhere(method: string, params: Record<string, unknown>): Promise<{ result: unknown } | undefined>;
}

export function createRelay(ctx: HostContext): Relay {
  const { connections, claims, holders, log } = ctx;

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
  /**
   * Which client published a URI, if a connected one did.
   *
   * `<scheme>://<clientId>/…` is how the reference host addresses a
   * client-served resource, and reading the authority is the whole of the
   * routing. `file:` is never one - it is this machine's, and this host has a
   * filesystem for it - and neither is an `ahp-` channel, whose authority is
   * part of a channel name and not a client id.
   */
  const ownerOf = (uri: string): Connection | undefined => {
    const found = /^([a-zA-Z][\w+.-]*):\/\/([^/]+)/.exec(uri);
    const scheme = found?.[1];
    const who = found?.[2];
    if (scheme === undefined || who === undefined || scheme === 'file' || scheme.startsWith('ahp-')) return undefined;
    return [...connections].find((one) => one.clientId === who && claimsId(one));
  };
  /** Ask one client one of the ten, in its own words. */
  const ask = async (client: string, method: string, params: Record<string, unknown>): Promise<unknown> => {
    const held = [...connections].find((one) => one.clientId === client && claimsId(one));
    if (held === undefined) throw new RpcError(-32008, `${client} is not a client this host has seen`);
    // The channel last, not first: every one of the ten declares it as the
    // literal `ahp-root://`, and this host refuses a client that names another
    // - so a caller here cannot be the thing that gets it wrong either.
    return await held.peer.request(method, { ...params, channel: ROOT });
  };
  /**
   * The connected clients, as places a resource can come from.
   *
   * Ten named methods over one `peer.request`, so a caller writes what it
   * means rather than a method name and a bag - and so the params each takes
   * are checked here rather than at the other end.
   */
  const clients: Clients = {
    ids: () => [...connections].filter(claimsId).map((one) => one.clientId).filter((one) => one !== ''),
    owner: (uri) => ownerOf(uri)?.clientId,
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
  /**
   * A watch channel a client minted, and the client that minted it.
   *
   * `createResourceWatch` on a URI another client publishes is answered by
   * that client, and what comes back is a channel *it* will report changes
   * on. So the channel is remembered here: its owner is allowed to dispatch
   * `resourceWatch/changed` onto it, which this host then relays to whoever
   * subscribed - and nobody else is, because a change to somebody else's
   * files is not a thing a third client may claim happened.
   */
  const relayed = new Claiming<{ owner: Connection; state: Record<string, unknown> }>(claims, 'watch');
  /**
   * One `resource*` request, answered by the client that published its URI.
   *
   * `undefined` means nobody else's: the URI is this machine's, or the client
   * that published it has hung up - and then the host's own handler answers as
   * it always did. Wrapped in an object so an owner answering `undefined` is
   * still an answer.
   *
   * Called only for the ten, and only from there: every other request must
   * reach its handler in the same turn of the event loop it arrived in, and
   * an `await` here would put a microtask between the two - which is enough
   * to lose an action dispatched while a `subscribe` is in flight.
   */
  const elsewhere = async (
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ result: unknown } | undefined> => {
    const uri = String(params.uri ?? params.source ?? '');
    const owner = ownerOf(uri);
    if (owner === undefined) return undefined;
    /*
     * Both ends of a move or a copy, or neither.
     *
     * The two methods that name two URIs are the two that could ask one
     * client to write into another's files, and neither peer could carry
     * that out: the owner of the source cannot reach the destination. Said
     * rather than half-done.
     */
    const to = params.destination === undefined ? undefined : ownerOf(String(params.destination));
    if (params.destination !== undefined && to?.clientId !== owner.clientId) {
      throw new RpcError(INVALID_PARAMS, `${uri} and ${String(params.destination)} are not the same client's`);
    }
    /*
     * The owner's refusal is the owner's, and it is written down here.
     *
     * What goes back to the asking client is whatever the owner said, code
     * and all - this host has no standing to soften somebody else's refusal.
     * But a refusal that crossed a connection is one the asking client cannot
     * attribute: `-32009` from a client that published a directory read-only
     * and `-32009` from one that has not finished working out who is asking
     * are the same three digits, and the only place both are visible at once
     * is this log.
     */
    const answer = await owner.peer.request(method, params).catch((error: unknown) => {
      const code = (error as { code?: unknown }).code;
      const said = error instanceof Error ? error.message : String(error);
      log(`${owner.clientId} refused ${method} for ${uri}${typeof code === 'number' ? ` (${String(code)})` : ''}: ${said}`);
      throw error;
    });
    /*
     * A watch the owner minted, remembered so its reports can be relayed.
     *
     * The asking client subscribes to the channel that comes back, and the
     * owner dispatches `resourceWatch/changed` onto it - which this host
     * would otherwise refuse, because that action is a host's to say.
     */
    if (method === 'createResourceWatch') {
      const channel = String((answer as { channel?: unknown } | undefined)?.channel ?? '');
      // The same `ResourceWatchState` a watch of this host's own reports: what
      // the watch *is*, which is the params it was made with. The owner keeps
      // no state this host could ask for, and the protocol's reducer keeps no
      // history - a client arriving later has missed what it was not there for.
      if (channel !== '') {
        ctx.claimable(channel, 'watch');
        relayed.set(channel, {
          owner,
          state: {
            root: uri,
            recursive: params.recursive === true,
            ...(params.excludes !== undefined ? { excludes: params.excludes } : {}),
            ...(params.includes !== undefined ? { includes: params.includes } : {}),
          },
        });
      }
    }
    log(`${owner.clientId} answered ${method} for ${uri}`);
    return { result: answer };
  };

  return { clients, relayed, ownId, claimsId, ownerOf, ask, elsewhere };
}