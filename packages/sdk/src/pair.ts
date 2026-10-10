/**
 * Two ends of one connection, in memory, with no socket between them.
 *
 * A plugin that acts on its own host is a client of it - decision
 * `plugin-contributes-host-options` - and a client reaches this host through a
 * `Peer` and a `Wire`. Both exist here without a transport: each end's `send`
 * is the other end's input, so `Host.accept` serves a plugin exactly as it
 * serves a window, and the handshake, the gate and the subscriptions are the
 * same code rather than a second door into the host.
 *
 * Delivery is asynchronous, one frame per turn of the loop, because that is
 * what a socket does: `send` returns before anything has been read, and a
 * plugin that asks a question and handles the answer in one go does not find
 * itself waiting on its own turn. Nothing is delivered after either end closes,
 * which is what makes closing a connection stop it rather than leave a frame
 * arriving against a host that has forgotten it.
 *
 * `rpc.ts` is the only framing here: this file is a `Wire` each way and the
 * pair of peers built over them, and it holds no protocol of its own.
 */

import { METHOD_NOT_FOUND, RpcError, createPeer, receive } from './rpc.js';
import type { Handler, Peer, Wire } from './types/rpc.js';
import type { PluginPeer } from './types/plugin.js';

/**
 * What the host's end of a pair is handed once a connection exists.
 *
 * The shape `Host.accept` answers with: the handler every frame from the plugin
 * reaches, and the host's own bookkeeping for letting the connection go. A pair
 * is built before this and served the moment it is; nothing is delivered in
 * between, because a plugin cannot have sent anything yet.
 */
export interface Served {
  /** One request from the plugin, as the host serves it. */
  handle: Handler;
  /** Let the connection go, as the transport does when a socket drops. */
  close(): void;
}

/** One in-memory connection: the host's end, the plugin's end, and the close. */
export interface Pair {
  /** The end handed to `Host.accept`. */
  readonly host: Peer;
  /** The end the plugin keeps. */
  readonly plugin: PluginPeer;
  /** Hand the host's end the connection `Host.accept` answered with. */
  served(connection: Served): void;
  /** Close both ends, as a socket dropping does. */
  close(): void;
}

/**
 * One in-memory pair, closed together.
 *
 * `closed` is called once, when either end closes, so whoever holds the pair
 * can let go of it.
 */
export function createPair(closed?: () => void): Pair {
  /** Whether either end is still open. Both close together, so this is one flag. */
  let open = true;
  /** The host's half, once a connection exists to serve the plugin's frames. */
  let connected: Served | undefined;
  /** Where what the host says goes, once the plugin set a place to read it. */
  let heard: ((message: Record<string, unknown>) => void) | undefined;

  /**
   * Close both ends, once.
   *
   * The host's own connection is let go as well as the two peers, because that
   * is what a socket dropping does: the connection leaves the host's set, its
   * turns stop being attributed to it, and every client is told it went away. A
   * plugin that closed its own end and left the host holding the other would be
   * a subscription nobody can see and nobody can stop.
   *
   * Guarded, because both peers call this back through their own wires.
   */
  function shut(): void {
    if (!open) return;
    open = false;
    heard = undefined;
    const held = connected;
    connected = undefined;
    hostPeer.close();
    pluginPeer.close();
    held?.close();
    closed?.();
  }

  /**
   * One frame, handed to the other end on the next turn of the loop.
   *
   * A frame the host sent is an answer when it carries no `method` - the rule
   * `receive` uses, and it has to be the same rule: a host question carries an
   * id from a counter that starts where this side's own does, so a question
   * read as an answer would settle a promise about something else and leave the
   * real question waiting out its timeout.
   */
  function deliver(text: string, to: 'host' | 'plugin'): void {
    setTimeout(() => {
      if (!open) return;
      if (to === 'host') {
        receive(text, hostPeer, handle);
        return;
      }
      const message = JSON.parse(text) as Record<string, unknown>;
      if (message.method === undefined) {
        pluginPeer.answered(message);
        return;
      }
      heard?.(message);
    }, 0);
  }

  /**
   * A frame from the plugin, before there is a connection to serve it.
   *
   * Unreachable through `connect`, which serves the pair before it answers the
   * plugin. It is here so a pair wired the other way round is refused rather
   * than answered with nothing.
   */
  const handle: Handler = (request, peer) => {
    if (connected === undefined) {
      throw new RpcError(METHOD_NOT_FOUND, `This connection is not served yet, so ${request.method} is not answered`);
    }
    return connected.handle(request, peer);
  };

  const hostWire: Wire = {
    send: (text) => { deliver(text, 'plugin'); },
    close: () => { shut(); },
    isOpen: () => open,
  };
  const pluginWire: Wire = {
    send: (text) => { deliver(text, 'host'); },
    close: () => { shut(); },
    isOpen: () => open,
  };

  const hostPeer = createPeer(hostWire);
  const pluginPeer = createPeer(pluginWire);

  return {
    host: hostPeer,
    plugin: {
      send: pluginPeer.send,
      notify: pluginPeer.notify,
      request: pluginPeer.request,
      onMessage: (one) => { heard = one; },
      /*
       * Through this end's own peer rather than `shut`, so the questions this
       * plugin is still waiting on are rejected before the connection goes:
       * `createPeer`'s close settles them and a bare `shut` would not.
       */
      close: () => { pluginPeer.close(); },
    },
    served: (connection) => { connected = connection; },
    close: shut,
  };
}
