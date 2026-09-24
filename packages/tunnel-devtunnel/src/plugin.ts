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
import { create, find, host, prepare, remove, TunnelError } from './devtunnel.js';
import type { Runner, Spawner, Tunnel } from './devtunnel.js';
import { forward } from './forward.js';
import type { Forward } from './forward.js';

/** The plugin's id, unique among the plugins a daemon loads. */
export const name = 'ahpd-tunnel-devtunnel';

/** What a listing prints. */
export const title = 'Dev Tunnel';

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

const word = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

const flag = (value: unknown, fallback: boolean): boolean =>
  (typeof value === 'boolean' ? value : fallback);

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
  const keep = flag(asked.keep, defaults.keep);
  const anonymous = flag(asked.anonymous, defaults.anonymous);
  const wanted = word(asked.name);

  let held: Held | undefined;

  plugin.on('listening', async (event) => {
    // Reused before it is made, so a restart keeps the id - and therefore the
    // token a client already derived from it.
    let tunnel: Tunnel;
    try {
      tunnel = find(seams.runner) ?? create(
        nameLabel(wanted ?? hostname()) ?? undefined,
        seams.runner,
      );
      prepare(tunnel, anonymous, seams.runner);
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
      if (!keep) remove(tunnel, seams.runner);
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
  });

  plugin.on('stopping', async () => {
    const stood = held;
    held = undefined;
    if (stood === undefined) return;
    stood.child.kill();
    await stood.hop?.close();
    // Kept unless the run asked otherwise, because the id is what the
    // connection token is derived from: a new tunnel is a new token and every
    // client pointed at the old one is pointed at nothing.
    if (!stood.keep) remove(stood.tunnel, seams.runner);
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
