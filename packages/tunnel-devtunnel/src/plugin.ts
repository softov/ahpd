/**
 * The package as a plugin.
 *
 * It registers no agent, no tool and no port: everything it does happens on
 * the two moments the daemon raises around its socket. At `listening` the port
 * is bound and there is something to forward; at `stopping` the socket is
 * still open and there is still a tunnel to take down. That is the whole
 * shape, and it is why a tunnel is a plugin rather than a flag on the daemon:
 * nothing about `devtunnel` has to be true of a host that does not use it.
 *
 * What it says on the way up is the point of it. A tunnel URL that only the
 * log knows is a URL nobody pastes, so the address goes through `say`, into
 * what the daemon announces and therefore into `ahpd status`.
 */

import type { Plugin } from '@ahpd/sdk';
import type { ChildProcess } from 'node:child_process';
import { hostname as machineName } from 'node:os';
import {
  deriveConnectionToken, displayLabel, IDENTITY_LABEL, nameLabel, TUNNEL_PORT,
} from './discovery.js';
import { create, find, host, prepare, remove, show, TunnelError } from './devtunnel.js';
import type { Runner, Shown, Spawner, Tunnel } from './devtunnel.js';
import { forward } from './forward.js';
import type { Forward } from './forward.js';
import { sameState, tunnelView } from './view.js';
import type { TunnelState } from './view.js';

/** The plugin's id, unique among the plugins a daemon loads. */
export const name = 'tunnel-devtunnel';

/** What a listing prints. */
export const title = 'Dev Tunnel';

/**
 * How often the tunnel's state is read from the service, in milliseconds.
 *
 * A relay that drops and comes back shows on the plugin's page within this
 * long. Each read is one `devtunnel show` process and one request to the
 * service, and the numbers it answers change rarely, so this is slow on
 * purpose.
 */
export const POLL_MS = 30_000;

/** What an option falls back to. */
export const defaults = {
  keep: true,
  anonymous: false,
} as const;

/** The options this plugin understands, after the defaults. */
export interface Options {
  /**
   * What to call the tunnel, as a client will list it.
   *
   * The machine's own name when nothing is said, because a person picking a
   * host out of a list is picking a machine.
   */
  name?: string;
  /**
   * Whether the tunnel survives the daemon.
   *
   * Kept by default: a tunnel deleted on every stop is a new id on every
   * start, and the id is what the connection token is derived from, so a
   * client would have to be pointed at it again after every restart.
   */
  keep?: boolean;
  /**
   * Whether somebody not signed in to this Dev Tunnels account may reach it.
   *
   * Off by default. The token a client presents over a tunnel is computed
   * from the tunnel id rather than kept secret, so the account boundary is
   * the thing actually deciding who may connect.
   */
  anonymous?: boolean;
}

/** What was stood up, so `stopping` can take it back down. */
interface Held {
  tunnel: Tunnel;
  child: ChildProcess;
  hop?: Forward;
  keep: boolean;
}

/**
 * How the CLI is reached, for a test that has no CLI.
 *
 * Not an option a person sets: it is named in the type so the plugin can be
 * driven in a test, and left out everywhere else so the real one is used.
 */
export interface Seams {
  runner?: Runner;
  spawner?: Spawner;
}

export const apply: Plugin['apply'] = (plugin, options) => {
  const asked: Options = options;
  const seams = options as Seams;
  const keep = asked.keep ?? defaults.keep;
  const anonymous = asked.anonymous ?? defaults.anonymous;
  const wanted = asked.name;

  let held: Held | undefined;
  /** The state the page draws, so a poll that found nothing new says nothing. */
  let drawn: TunnelState | undefined;
  /** The poll, once the tunnel is hosted. */
  let poll: ReturnType<typeof setInterval> | undefined;
  /** Whether the read before this one failed, so one run of failures is logged once. */
  let failing = false;

  /**
   * Read the tunnel's state and draw it, when it is not what the page shows.
   *
   * A read that fails keeps the page as it was: a short loss of the network
   * should not empty it. The first failure of a run is logged and the rest of
   * that run is not, so a tunnel that stays unreachable costs one line.
   */
  const read = async (tunnel: Tunnel): Promise<void> => {
    let shown: Shown;
    try {
      shown = await show(tunnel, seams.runner);
    }
    catch (error) {
      if (!failing) plugin.log(`${name}: ${error instanceof TunnelError ? error.message : String(error)}`);
      failing = true;
      return;
    }
    // A stop, or a new tunnel, may have happened while the CLI was answering.
    if (held?.tunnel.tunnelId !== tunnel.tunnelId) return;
    failing = false;
    const next: TunnelState = {
      id: tunnel.tunnelId,
      port: TUNNEL_PORT,
      ...(shown.url === undefined ? {} : { url: shown.url }),
      hosts: shown.hosts,
      clients: shown.clients,
    };
    if (drawn !== undefined && sameState(drawn, next)) return;
    drawn = next;
    plugin.showView(tunnelView(next));
  };

  plugin.on('listening', async (event) => {
    // Reused before it is made, so a restart keeps the id - and therefore the
    // token a client already derived from it.
    let tunnel: Tunnel;
    try {
      tunnel = await find(seams.runner) ?? await create(
        nameLabel(wanted ?? hostname()) ?? undefined,
        seams.runner,
      );
      await prepare(tunnel, anonymous, seams.runner);
    }
    catch (error) {
      // A tunnel that could not be made costs the tunnel and not the daemon:
      // the socket is already bound and a client on this machine can reach it.
      plugin.log(`${name}: ${error instanceof TunnelError ? error.message : String(error)}`);
      return;
    }

    let hop: Forward | undefined;
    try {
      /*
       * The well-known port, unless the daemon happens to be on it.
       *
       * A tunnel forwards a port number to the same number, and the
       * convention fixes which number a client opens, so the two meet either
       * because the daemon bound it or because something on loopback carries
       * it across.
       */
      if (event.port !== TUNNEL_PORT) {
        hop = await forward(TUNNEL_PORT, event.port, plugin.log);
      }
    }
    catch (error) {
      plugin.log(`${name}: nothing can listen on ${TUNNEL_PORT}: ${error instanceof Error ? error.message : String(error)}`);
      if (!keep) await remove(tunnel, seams.runner).catch(() => undefined);
      return;
    }

    const child = host(tunnel, plugin.log, seams.spawner);
    held = { tunnel, child, keep, ...(hop === undefined ? {} : { hop }) };

    const shown = displayLabel(tunnel.labels);
    plugin.say(`tunnel ${tunnel.tunnelId}${shown === undefined ? '' : ` (${shown})`}, port ${TUNNEL_PORT}`);
    /*
     * A guarded daemon and this convention cannot both be satisfied.
     *
     * A client connecting over a tunnel presents a token it derived from the
     * tunnel id; it never asks a person for one and never reads one off the
     * tunnel. So a daemon started with a connection token of its own refuses
     * exactly the client this plugin exists to let in, unless that token is
     * the derived one.
     *
     * Said rather than refused: the tunnel still works for anything that
     * presents the right token, and a daemon that would not start because a
     * plugin disapproved of its token is worse than one that says what will
     * happen and what to set to make it work.
     */
    if (event.guarded) {
      plugin.say(
        `tunnel token ${await deriveConnectionToken(tunnel.tunnelId)}`
        + ' - what a client presents over the tunnel; this daemon requires its own',
      );
    }

    // The page first, and then the same question every `POLL_MS` while the
    // tunnel is up: the relay and the clients change without this plugin's
    // doing, and the page is where a person looks for them.
    await read(tunnel);
    // A stop during that first read has already cleared the poll it would start.
    if (held?.tunnel !== tunnel) return;
    clearInterval(poll);
    poll = setInterval(() => { void read(tunnel); }, POLL_MS);
  });

  plugin.on('stopping', async () => {
    if (poll !== undefined) {
      clearInterval(poll);
      poll = undefined;
    }
    drawn = undefined;
    failing = false;
    const stood = held;
    held = undefined;
    if (stood === undefined) return;
    // The page has no tunnel behind it any more.
    plugin.clearView();
    stood.child.kill();
    await stood.hop?.close();
    // Kept unless the run asked otherwise, because the id is what the
    // connection token is derived from: a new tunnel is a new token and every
    // client pointed at the old one is pointed at nothing.
    if (!stood.keep) await remove(stood.tunnel, seams.runner).catch(() => undefined);
  });

  plugin.log(`${name}: labelled ${IDENTITY_LABEL}, forwarding ${TUNNEL_PORT}`);
};

/**
 * This machine's name, which is what a person calls the host they connect to.
 *
 * Only reached when nothing was configured, and it falls back to the daemon's
 * own name: a machine that reports nothing usable should still leave a tunnel
 * with something on it to read.
 */
function hostname(): string {
  const found = machineName().trim();
  return found === '' || found === 'localhost' ? 'ahpd' : found;
}
