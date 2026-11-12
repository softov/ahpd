/**
 * The `devtunnel` kind: one port on the Dev Tunnel of a connector.
 *
 * A record is a connector, a port and whether the port is anonymous. Starting
 * it puts the port on the connector's Dev Tunnel and refreshes the relay host,
 * so the tunnel reaches this machine. The Dev Tunnel itself is the connector's
 * and is shared: two tunnels of one connector are two ports on one host.
 *
 * The system tunnel is the one the host adds for its own reachability. It
 * forwards the well-known port `31546`, which is the number a client opens,
 * and crosses the daemon's own port onto it when the two differ. Its lines and
 * its page are the ones this plugin has always said and drawn, now read
 * through the management client rather than the CLI.
 *
 * A connector that is not open is not an error in the daemon: the record says
 * why and stays, because a sign-in is the next thing the person will do.
 */

import { reason } from '@ahpd/sdk';
import type {
  KindOperation, PluginHost, ReportTunnel, Tunnel, TunnelKind,
} from '@ahpd/sdk';
import { deriveConnectionToken, displayLabel, TUNNEL_PORT } from './discovery.js';
import { forward } from './forward.js';
import type { Forward } from './forward.js';
import type { Service, Shown } from './service.js';
import { sameState, tunnelView } from './view.js';
import type { TunnelState } from './view.js';

/** The kind's name, which every record of it carries. */
export const NAME = 'devtunnel';

/** What a client prints for the kind. */
export const TITLE = 'Dev Tunnel';

/** One sentence on what a tunnel of this kind is. */
export const DESCRIPTION = 'A port on a Microsoft Dev Tunnel, reached at the URL the service assigns.';

/**
 * How often the system tunnel's state is read from the service, in
 * milliseconds.
 *
 * A relay that drops and comes back shows on the plugin's page within this
 * long. The numbers change rarely, so this is slow on purpose.
 */
export const POLL_MS = 30_000;

/** The alert's ref, so one warning replaces the last. */
const REF = 'tunnel';

/** What a record says when its connector is not open. */
const NOT_OPEN = 'The connector is not open. Sign in to this connector again, then enable this tunnel.';

/** What a tunnel of this kind is made of, as a client draws the form. */
export const SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    connector: {
      type: 'string',
      minLength: 1,
      title: 'Connector',
      description: 'The devtunnel connector that signs in to the Dev Tunnels service.',
      'x-ahpd-connector': NAME,
    },
    port: {
      type: 'number',
      minimum: 1,
      maximum: 65535,
      title: 'Port',
      description: 'The port on this machine this tunnel forwards.',
    },
    anonymous: {
      type: 'boolean',
      title: 'Anonymous',
      description: 'Whether somebody who is not signed in to this account may reach the tunnel.',
      default: false,
    },
  },
  required: ['connector', 'port'],
};

/**
 * The verbs a person may run.
 *
 * The host starts and stops a tunnel when it is enabled and disabled, so these
 * two are here to offer a person the same verbs on a row. `restart` is the one
 * that reconnects a relay without touching the Dev Tunnel, and `anonymous` is
 * the one that changes who may reach the port.
 */
export const OPERATIONS: KindOperation[] = [
  {
    id: 'start',
    label: 'Start',
    description: 'Puts the port on the Dev Tunnel and serves it.',
    icon: 'play',
    offered: (record) => record['status'] !== 'running',
  },
  {
    id: 'stop',
    label: 'Stop',
    description: 'Takes the port off the Dev Tunnel.',
    icon: 'stop',
    offered: (record) => record['status'] === 'running',
  },
  {
    id: 'restart',
    label: 'Restart',
    description: 'Reconnects the relay without changing the Dev Tunnel.',
    icon: 'restart',
    offered: (record) => record['status'] === 'running',
  },
  {
    id: 'anonymous',
    label: 'Anonymous access',
    description: 'Whether somebody who is not signed in to this account may reach the tunnel.',
    input: {
      type: 'object',
      properties: { on: { type: 'boolean', title: 'Anonymous access' } },
      required: ['on'],
    },
  },
];

/** What the kind is built with. */
export interface KindOptions {
  /** The plugin's host: the lines, alerts and page the kind keeps there. */
  plugin: Pick<PluginHost, 'say' | 'log' | 'alert' | 'clearAlert' | 'showView' | 'clearView'>;
  /** The service its ports are put on. */
  service: Service;
  /** The connector the system tunnel uses, from the plugin's `connector` option. */
  connector?: string;
  /** Whether the system tunnel is reachable without signing in. */
  anonymous: boolean;
  /** Whether a Dev Tunnel is deleted when its last port stops. */
  keep: boolean;
  /** Whether a connector is open now. */
  open(connector: string): boolean;
  /** The port the daemon bound, once `listening` has said it. */
  daemonPort(): number | undefined;
  /** Whether the daemon requires a connection token of its own. */
  guarded(): boolean;
  /** The daemon's connection token, when it requires one, which the hop sets on each request. */
  connectionToken?(): string | undefined;
}

/** One tunnel this daemon has up, so a stop knows what to take down. */
interface Running {
  connector: string;
  port: number;
  hop?: Forward;
}

/** A non-empty string, or nothing. */
const textOf = (value: unknown): string | undefined =>
  (typeof value === 'string' && value !== '' ? value : undefined);

/** A port number, or nothing. */
const numberOf = (value: unknown): number | undefined =>
  (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535 ? value : undefined);

/** The kind over one service, with the tunnels it has up. */
export function devtunnelKind(options: KindOptions): TunnelKind {
  const { plugin } = options;

  /** The records this daemon has up, by id. */
  const running = new Map<string, Running>();

  /** The system tunnel's page: what was drawn, and the read behind it. */
  let poll: ReturnType<typeof setInterval> | undefined;
  let watched: { connector: string; port: number } | undefined;
  let drawn: TunnelState | undefined;
  let failing = false;

  /**
   * Read the system tunnel's state and draw it, when it is not what the page
   * shows.
   *
   * A read that fails keeps the page as it was: a short loss of the network
   * should not empty it. The first failure of a run is logged and warned on
   * the row, and the rest of that run is not, so a tunnel that stays
   * unreachable costs one line. The next good read takes the warning away.
   */
  const read = async (): Promise<void> => {
    const at = watched;
    if (at === undefined) return;
    let shown: Shown | undefined;
    try {
      shown = await options.service.show(at.connector, at.port);
    } catch (error) {
      if (!failing) {
        plugin.log.error(`${NAME}: ${reason(error)}`);
        plugin.alert({ level: 'warning', ref: 'read', text: 'The tunnel\'s status could not be checked, so this page may be out of date.' });
      }
      failing = true;
      return;
    }
    // A stop, or a new port, may have happened while the service was answering.
    if (watched !== at) return;
    if (failing) plugin.clearAlert('read');
    failing = false;
    if (shown === undefined) return;
    const next: TunnelState = {
      id: shown.id,
      port: at.port,
      ...(shown.url === undefined ? {} : { url: shown.url }),
      hosts: shown.hosts,
      clients: shown.clients,
    };
    if (drawn !== undefined && sameState(drawn, next)) return;
    drawn = next;
    plugin.showView(tunnelView(next));
  };

  /** Stop the poll, empty the page and forget what it drew. */
  const unwatch = (): void => {
    clearInterval(poll);
    poll = undefined;
    watched = undefined;
    drawn = undefined;
    failing = false;
    plugin.clearAlert('read');
    plugin.clearView();
  };

  /** Watch the system tunnel: one read now, and the same question every `POLL_MS`. */
  const watch = async (connector: string, port: number): Promise<void> => {
    unwatch();
    const at = { connector, port };
    watched = at;
    await read();
    // A stop during that first read has already cleared the poll it would start.
    if (watched !== at) return;
    poll = setInterval(() => { void read(); }, POLL_MS);
  };

  /** The hop from the well-known port to the daemon's, when the two differ. */
  const hopFor = async (port: number): Promise<Forward | undefined> => {
    if (port !== TUNNEL_PORT) return undefined;
    const daemon = options.daemonPort();
    if (daemon === undefined || daemon === TUNNEL_PORT) return undefined;
    return await forward(TUNNEL_PORT, daemon, plugin.log, options.connectionToken?.());
  };

  /** Put one tunnel up, or say why it is not up. */
  const start = async (tunnel: Tunnel, report: ReportTunnel): Promise<void> => {
    const connector = textOf(tunnel.settings['connector']);
    const port = numberOf(tunnel.settings['port']);
    const anonymous = tunnel.settings['anonymous'] === true;

    if (connector === undefined || port === undefined) {
      report({ status: 'error', error: 'This tunnel needs a connector and a port.' });
      return;
    }
    // A record already up is left alone, so a second start starts nothing twice.
    if (running.has(tunnel.id)) {
      report({ status: 'running' });
      return;
    }
    if (!options.open(connector)) {
      plugin.log.warn(`${NAME}: tunnel ${tunnel.id} was not started: connector ${connector} is not open`);
      report({ status: 'error', error: NOT_OPEN });
      return;
    }

    let hop: Forward | undefined;
    try {
      if (tunnel.purpose === 'system') hop = await hopFor(port);
      const served = await options.service.add(connector, port, anonymous);
      running.set(tunnel.id, { connector, port, ...(hop === undefined ? {} : { hop }) });
      plugin.clearAlert(REF);

      if (tunnel.purpose === 'system') {
        const shown = displayLabel(served.remote.labels);
        plugin.say(`tunnel ${served.remote.id}${shown === undefined ? '' : ` (${shown})`}, port ${port}`);
        /*
         * A guarded daemon the tunnel reaches with no hop between them.
         *
         * A client connecting over a tunnel presents a token it derived from
         * the tunnel id. The hop sets the daemon's own token on every request
         * it carries, as VS Code's CLI injects its agent host's token into each
         * request arriving over a tunnel; a daemon bound to the tunnel's own
         * port has no hop, so it is reached by the derived token alone, and
         * the line says that token.
         */
        if (options.guarded() && hop === undefined) {
          plugin.say(
            `tunnel token ${await deriveConnectionToken(served.remote.id)}`
            + ' - what a client presents over the tunnel; this daemon requires its own',
          );
        }
      }

      report({ status: 'running', ...(served.url === undefined ? {} : { url: served.url }) });
      if (tunnel.purpose === 'system') await watch(connector, port);
    } catch (error) {
      const message = reason(error);
      await hop?.close();
      plugin.log.error(`${NAME}: tunnel ${tunnel.id} did not start: ${message}`);
      if (tunnel.purpose === 'system' && port === TUNNEL_PORT) {
        plugin.alert({ level: 'error', ref: REF, text: `The tunnel could not use port ${TUNNEL_PORT}: ${message}` });
      }
      report({ status: 'error', error: message });
    }
  };

  /** Take one tunnel down, and the Dev Tunnel only when it was the last port. */
  const stop = async (tunnel: Tunnel, report: ReportTunnel): Promise<void> => {
    const one = running.get(tunnel.id);
    if (one === undefined) {
      report({ status: 'stopped' });
      return;
    }
    running.delete(tunnel.id);
    try {
      await one.hop?.close();
      await options.service.remove(one.connector, one.port, options.keep);
    } catch (error) {
      const message = reason(error);
      plugin.log.error(`${NAME}: tunnel ${tunnel.id} did not stop: ${message}`);
      report({ status: 'error', error: message });
      return;
    }
    if (tunnel.purpose === 'system') unwatch();
    report({ status: 'stopped' });
  };

  /** Connect a relay again, leaving the tunnel and its ports where they are. */
  const restart = async (tunnel: Tunnel, report: ReportTunnel): Promise<void> => {
    const one = running.get(tunnel.id);
    if (one === undefined) {
      report({ status: 'stopped', error: 'The tunnel is not running, so there is no relay to connect again.' });
      return;
    }
    try {
      await options.service.restart(one.connector);
    } catch (error) {
      const message = reason(error);
      plugin.log.error(`${NAME}: tunnel ${tunnel.id} was not restarted: ${message}`);
      report({ status: 'error', error: message });
      return;
    }
    report({ status: 'running' });
    if (tunnel.purpose === 'system') await read();
  };

  /** Change who may reach a port, and keep it in the record. */
  const access = async (tunnel: Tunnel, report: ReportTunnel, input: Record<string, unknown> | undefined): Promise<void> => {
    const on = input?.['on'];
    if (typeof on !== 'boolean') throw new Error('anonymous access needs `on`, a boolean');
    const one = running.get(tunnel.id);
    if (one !== undefined) {
      try {
        await options.service.access(one.connector, one.port, on);
      } catch (error) {
        const message = reason(error);
        plugin.log.warn(`${NAME}: tunnel ${tunnel.id} kept its access: ${message}`);
        report({ error: message });
        return;
      }
    }
    // Saved by the host, so the next start puts the port on with this access.
    report({ settings: { anonymous: on } });
  };

  return {
    name: NAME,
    title: TITLE,
    description: DESCRIPTION,
    schema: SCHEMA,
    operations: OPERATIONS,

    create: start,

    remove: async (tunnel) => {
      const one = running.get(tunnel.id);
      running.delete(tunnel.id);
      if (tunnel.purpose === 'system') unwatch();
      if (one === undefined) return;
      await one.hop?.close();
      try {
        await options.service.remove(one.connector, one.port, options.keep);
      } catch (error) {
        // The record is going anyway: a port left on the service is a port the
        // next start writes again, and a person who removed the row asked for
        // the row to go.
        plugin.log.warn(`${NAME}: tunnel ${tunnel.id} was removed but its port was not: ${reason(error)}`);
      }
    },

    invoke: async (name, tunnel, report, input) => {
      if (name === 'start') { await start(tunnel, report); return; }
      if (name === 'stop') { await stop(tunnel, report); return; }
      if (name === 'restart') { await restart(tunnel, report); return; }
      if (name === 'anonymous') { await access(tunnel, report, input); return; }
      throw new Error(`${NAME} does not offer ${name}`);
    },

    update: async (tunnel, input, report) => {
      const one = running.get(tunnel.id);
      if (one === undefined) {
        report({ status: 'stopped' });
        return;
      }
      const connector = textOf(input['connector']) ?? one.connector;
      const port = numberOf(input['port']) ?? one.port;
      const anonymous = input['anonymous'] === true;

      if (connector !== one.connector) {
        // Another account: the old port goes with the old connector, and the
        // tunnel starts again on the new one.
        running.delete(tunnel.id);
        try {
          await options.service.remove(one.connector, one.port, options.keep);
        } catch (error) {
          report({ status: 'error', error: reason(error) });
          return;
        }
        await one.hop?.close();
        if (tunnel.purpose === 'system') unwatch();
        await start(tunnel, report);
        return;
      }

      if (port !== one.port) {
        let hop: Forward | undefined;
        try {
          const url = await options.service.replace(connector, one.port, port, anonymous);
          await one.hop?.close();
          if (tunnel.purpose === 'system') hop = await hopFor(port);
          running.set(tunnel.id, { connector, port, ...(hop === undefined ? {} : { hop }) });
          report({ status: 'running', ...(url === undefined ? {} : { url }) });
          if (tunnel.purpose === 'system') await watch(connector, port);
        } catch (error) {
          report({ status: 'error', error: reason(error) });
        }
        return;
      }

      try {
        await options.service.access(connector, port, anonymous);
      } catch (error) {
        report({ error: reason(error) });
        return;
      }
      report({ status: 'running' });
    },

    system: () => {
      const connector = options.connector;
      if (connector === undefined) {
        plugin.alert({
          level: 'warning',
          ref: REF,
          text: 'Sign in to a devtunnel connector on this host, then set the plugin option `connector` to it. No tunnel is opened until then.',
        });
        return undefined;
      }
      return { connector, port: TUNNEL_PORT, anonymous: options.anonymous };
    },
  };
}
