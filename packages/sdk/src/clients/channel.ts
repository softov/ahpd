/**
 * `x-ahpd-clients`: the connections this host is serving, and the drop each takes.
 *
 * One row for each open socket, keyed by the number the listener gave it as a
 * string. A row is what the connection said at `initialize` - its client id,
 * name, protocol version and locale - with the person it signed in as, the
 * address the listener reported and the `X-Forwarded-For` text the request
 * carried. The claim is kept as sent and is never read as an address: only
 * `address` is what the socket itself reported.
 *
 * The rows come from the client registry, which keeps no copy of them: a socket
 * is a row while it is open, and the channel is refreshed on each arrival and
 * departure. A connection the listener gave no socket number is left out,
 * because the number is the row's id.
 *
 * A row also carries the frames and bytes its socket has carried, in each
 * direction, when the channel is given a `counters`. They are read at each
 * refresh and sent to a reader at most once each 5 seconds, on a timer that
 * runs only while the list has a subscriber.
 *
 * The state also carries `operations`, and this list offers one. `drop` runs on
 * a row, needs `client:drop`, and closes that connection after its answer is on
 * the wire. A drop is not a ban: the client may connect again at once, and is a
 * new row, because a row's id is the socket and not the client.
 *
 * `?owner=me` is refused: a connection is the host's, and the grant is the whole
 * of who may read the list.
 */

import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { recordsChannel, type RecordsChannel } from '../resources/recordschannel.js';
import type { OperationChannel } from '../kinds/operations.js';
import type { ClientRegistry, ConnectedClient } from '../types/host.js';
import type { Operation } from '../types/kinds.js';
import type { ChannelHandle, PluginChannel } from '../types/plugin.js';
import type { Grant } from '../types/users.js';

/** The channel's scheme, and the URI its state is read at. */
const SCHEME = 'x-ahpd-clients';
const URI = `${SCHEME}://`;

/** The grant that opens the list, and the one that drops a connection. */
const READ = 'client:read' as Grant;
const DROP = 'client:drop' as Grant;

/** How often the counters are sent to a reader, in milliseconds. */
const EVERY_MS = 5_000;

/** What one socket has carried, in each direction. */
export interface ClientCounts {
  /** Frames the client sent. */
  framesIn: number;
  /** Frames the host sent. */
  framesOut: number;
  /** UTF-8 bytes of the frames the client sent. */
  bytesIn: number;
  /** UTF-8 bytes of the frames the host sent. */
  bytesOut: number;
}

/** How a clients channel reaches the registry. */
export interface ClientsChannelOptions {
  /** The host's connections, read at each call, and absent until the host is built. */
  registry(): ClientRegistry | undefined;
  /** What one socket has carried, or nothing when nothing counts it. */
  counters?(socket: number): ClientCounts | undefined;
  /** Where a list that could not be read is said, as one line. */
  onProblem?(message: string): void;
}

/** A clients channel, and the operations list beside it. */
export interface ClientsChannel {
  /** What `servedRecords` takes. */
  channel: RecordsChannel;
  /** The `x-ahpd-clients://` side of `x-ahpd/invokeOperation`. */
  operations: OperationChannel;
  /** Send every subscriber what the list is now. */
  refresh(): Promise<void>;
  /** Stop the counter timer, as the daemon does when it goes down. */
  stop(): void;
}

export function clientsChannel(options: ClientsChannelOptions): ClientsChannel {
  /** The handle `servedRecords` hands over, which is where the subscriber list is read. */
  let handle: ChannelHandle | undefined;

  /** The rows the registry holds now, in arrival order, without the sockets no number was given. */
  const rows = (): ConnectedClient[] => (options.registry()?.connected() ?? []).filter((one) => one.socket !== undefined);

  /** One connection as a row: the socket number is the id, the person is their id, and the counts are the socket's. */
  const rowOf = (client: ConnectedClient): Record<string, unknown> => {
    const counts = client.socket === undefined ? undefined : options.counters?.(client.socket);
    return {
      ...client,
      id: String(client.socket),
      ...(client.principal === undefined ? {} : { principal: client.principal.id }),
      ...(counts === undefined ? {} : counts),
    };
  };

  const source = {
    ids: async (): Promise<string[]> => rows().map((one) => String(one.socket)),
    find: async (id: string): Promise<Record<string, unknown> | undefined> => {
      const found = rows().find((one) => String(one.socket) === id);
      return found === undefined ? undefined : rowOf(found);
    },
  };

  /** The one operation the list offers: a drop, on one row. */
  const operationsOf = (): Operation[] => [{
    id: 'drop',
    kind: 'host',
    label: 'Drop',
    description: 'Closes this connection. The client may connect again at once.',
    confirmation: 'Drop this client? Its connection closes now, and it may reconnect at once.',
    scopes: ['client'],
    grant: DROP,
    status: 'idle',
  }];

  const records = recordsChannel(SCHEME, source, {
    grant: READ,
    describe: () => ({
      title: 'Clients',
      description: 'The clients this host is serving, and the connection each one holds.',
    }),
    ...(options.onProblem === undefined ? {} : { onProblem: options.onProblem }),
  });

  /** The timer that sends a reader the counters, while the list has one. */
  let timer: ReturnType<typeof setInterval> | undefined;

  /** Whether anyone reads the list now. */
  const listening = (): boolean => (handle?.subscribers(URI).length ?? 0) > 0;

  const stopTimer = (): void => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };

  /** Read the counters and send each reader what moved, and stop once none is left. */
  const tick = (): void => {
    if (!listening()) { stopTimer(); return; }
    void records.refresh();
  };

  /*
   * A subscribe is answered before the host records it, so the snapshot starts
   * the timer and each tick ends it once the last reader has gone. An
   * unsubscribe ends it at once, where the subscriber list is already up to
   * date.
   */
  const startTimer = (): void => {
    if (timer !== undefined) return;
    timer = setInterval(tick, EVERY_MS);
    timer.unref();
  };

  /** The list with its operations beside the records, and the timer that keeps the counts moving. */
  const channel: PluginChannel = {
    ...records.channel,
    snapshot: async (asked, reader, client) => {
      const state = await records.channel.snapshot(asked, reader, client) as Record<string, unknown>;
      startTimer();
      return { ...state, operations: operationsOf() };
    },
    left: (client) => {
      records.channel.left?.(client);
      if (!listening()) stopTimer();
    },
  };

  const run = async (operation: Operation, target: string | undefined): Promise<unknown> => {
    if (operation.id !== 'drop') throw new RpcError(INVALID_PARAMS, `${operation.id} is not an operation of ${URI}`);
    if (target === undefined) throw new RpcError(INVALID_PARAMS, `${operation.id} runs on one client, so it needs a target`);
    const registry = options.registry();
    const found = registry === undefined ? undefined : rows().find((one) => String(one.socket) === target);
    if (registry === undefined || found === undefined || found.socket === undefined) {
      throw new RpcError(-32001, `No client on socket ${target} is connected`);
    }
    const socket = found.socket;
    /*
     * Answered first, and dropped on the next turn of the loop: the answer is
     * written by the host after `run` returns, so a caller that drops its own
     * connection is told what it dropped before the socket goes.
     */
    setTimeout(() => { registry.drop(socket); }, 0);
    return rowOf(found);
  };

  const operations: OperationChannel = {
    uri: URI,
    operations: operationsOf,
    // A drop settles as soon as it answers, so the list carries no status of its own.
    begin: () => {},
    settle: () => {},
    run,
  };

  return {
    channel: {
      ...records,
      channel,
      // The handle is kept here too, because the timer reads the subscriber list from it.
      bind: (given: ChannelHandle) => {
        handle = given;
        records.bind(given);
      },
    },
    operations,
    refresh: records.refresh,
    stop: stopTimer,
  };
}
