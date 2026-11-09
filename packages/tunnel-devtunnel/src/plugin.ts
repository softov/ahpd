/**
 * The package as a plugin.
 *
 * It registers the `devtunnel` connector, which signs one GitHub account in,
 * and the `devtunnel` kind, which puts a record's port on that connector's Dev
 * Tunnel. The host's own tunnel is a record of the same kind with
 * `purpose: system`: it forwards the well-known port `31546`, and it is the one
 * this plugin announces and draws.
 *
 * Nothing here names the `devtunnel` CLI. The service is reached through the
 * SDK, with the token of an open connector, so a host needs a sign-in rather
 * than an installed program, and the daemon reaches the service itself instead
 * of spawning a process that does.
 *
 * What it says about the system tunnel is still the point of it. A tunnel URL
 * that only the log knows is a URL nobody pastes, so the address goes through
 * `say`, into what the daemon announces and therefore into `ahpd status`.
 */

import { reason } from '@ahpd/sdk';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import type { Plugin, PluginHost, PluginPeer } from '@ahpd/sdk';
import { hostname as machineName } from 'node:os';
import { devtunnelAdapter, OpenTunnels } from './adapter.js';
import { normalizeTunnelName, tunnelNameFromHostname } from './discovery.js';
import { devtunnelKind, NAME as KIND } from './kind.js';
import { sdkService } from './service.js';
import type { Service } from './service.js';

/** The plugin's id, unique among the plugins a daemon loads. */
export const name = 'tunnel-devtunnel';

/** What a listing prints. */
export const title = 'Dev Tunnel';

/** How often the system tunnel's state is read from the service, in milliseconds. */
export { POLL_MS } from './kind.js';

/** What an option falls back to. */
export const defaults = {
  keep: true,
  anonymous: false,
  allowAccountChange: false,
} as const;

/** The options this plugin understands, after the defaults. */
export interface Options {
  /**
   * The `devtunnel` connector this host's own tunnel uses.
   *
   * Absent, no system tunnel is added: the plugin still registers the kind, so
   * a person can make a tunnel of it, and it says on its row what is missing.
   */
  connector?: string;
  /**
   * What to call a Dev Tunnel this plugin makes, as a client will list it.
   *
   * The machine's own name when nothing is said, because a person picking a
   * host out of a list is picking a machine.
   */
  name?: string;
  /**
   * Whether a Dev Tunnel survives the daemon.
   *
   * Kept by default: a tunnel deleted on every stop is a new id on every
   * start, and the id is what the connection token is derived from, so a
   * client would have to be pointed at it again after every restart.
   */
  keep?: boolean;
  /**
   * Whether somebody not signed in to this Dev Tunnels account may reach the
   * host's own tunnel.
   *
   * Off by default. The token a client presents over a tunnel is computed
   * from the tunnel id rather than kept secret, so the account boundary is
   * the thing actually deciding who may connect.
   */
  anonymous?: boolean;
  /**
   * Whether a second sign-in may replace a connector's GitHub account.
   *
   * Off by default: a connector is one person's one account, and a sign-in
   * from another account on the same id is a mistake rather than an edit.
   */
  allowAccountChange?: boolean;
}

/**
 * How the service is reached, for a test that has no account.
 *
 * Not an option a person sets: it is named in the type so the plugin can be
 * driven by a fake service, and left out everywhere else so the real one is
 * used.
 */
export interface Seams {
  service?: Service;
}

/**
 * The client name this plugin's own connection to its host gives.
 *
 * The same id the daemon loads the plugin under, so a grant in its entry is
 * the grant its connection holds.
 */
const CLIENT = name;

/**
 * The two calls the `devtunnel` adapter makes on its host's side.
 *
 * An adapter refreshes its token, and the vault is the host's: a plugin writes
 * a secret back through `x-ahpd/connectors/secret`, and asks for a check
 * through `x-ahpd/connectors/check`, as the Claude plugin does for its logins.
 * The connection opens by the first of them and is kept for the load; the
 * daemon closes it on `stopping`.
 *
 * `connect` is only answered from `listening` on, and a stored connector may
 * open while the host is still being built. So the first call waits for that
 * event rather than reporting a failure the next tick would have avoided.
 *
 * The handshake offers every version the package speaks, most preferred
 * first, as the spec has a client offer them (docs/specification/versioning.md
 * at spec/v1.0.0, "Negotiation").
 */
const throughHost = (host: PluginHost): {
  secret: (id: string, values: Record<string, string>) => Promise<void>;
  check: (id: string) => void;
} => {
  let listening!: () => void;
  const started = new Promise<void>((resolve) => { listening = resolve; });
  host.on('listening', () => { listening(); });
  let opened: Promise<PluginPeer> | undefined;
  const connection = async (): Promise<PluginPeer> => {
    await started;
    opened ??= (async () => {
      const conn = host.connect();
      await conn.request('initialize', { clientId: CLIENT, protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS] });
      return conn;
    })();
    const failed = (): void => { opened = undefined; };
    opened.catch(failed);
    return await opened;
  };
  return {
    secret: async (id, values) => {
      const conn = await connection();
      await conn.request('x-ahpd/connectors/secret', { id, values });
    },
    check: (id) => {
      void connection()
        .then((conn) => conn.request('x-ahpd/connectors/check', { id }))
        .catch((error: unknown) => { host.log.warn(`${name}: the host did not check connector ${id}: ${reason(error)}`); });
    },
  };
};

export const apply: Plugin['apply'] = (plugin, options) => {
  const asked: Options = options;
  const seams = options as Seams;
  const keep = asked.keep ?? defaults.keep;
  const anonymous = asked.anonymous ?? defaults.anonymous;
  const allowAccountChange = asked.allowAccountChange ?? defaults.allowAccountChange;
  /*
   * The tunnel's name as VS Code names the tunnel it hosts: a configured name
   * normalized, else the machine's host name cleaned, and `vscode` for a
   * configured name that normalizes to nothing.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/remoteTunnel/node/tunnelProcessCoordinator.ts#L424-L427
   */
  const wanted = (asked.name !== undefined ? normalizeTunnelName(asked.name) : tunnelNameFromHostname(machineName())) || 'vscode';
  const connector = asked.connector;

  /*
   * The Dev Tunnels connector, and the tokens of the ones this load holds
   * open. Signing one in is a device code the host polls; the token it answers
   * is what the tunnel kind reaches the service with.
   */
  const tunnels = new OpenTunnels();
  const through = throughHost(plugin);
  plugin.registerAdapter(devtunnelAdapter(tunnels, {
    allowAccountChange,
    log: (line, level) => { plugin.log(line, level); },
    secret: through.secret,
    check: through.check,
  }));

  /** What `listening` said, which the system tunnel's hop and token need. */
  let daemonPort: number | undefined;
  let guarded = false;
  let connectionToken: string | undefined;
  plugin.on('listening', (event) => {
    daemonPort = event.port;
    guarded = event.guarded;
    connectionToken = event.connectionToken;
  });

  /** The tunnel each connector hosted, by connector id, which the next run looks up first. */
  const kept = plugin.records('devtunnel-tunnels');
  const service = seams.service ?? sdkService({
    token: (id) => tunnels.ready(id),
    name: wanted,
    kept: {
      read: async (id) => {
        const row = await kept.get(id);
        if (row === undefined || typeof row['tunnel'] !== 'string' || typeof row['name'] !== 'string') return undefined;
        return { id: row['tunnel'], name: row['name'], ...(typeof row['cluster'] === 'string' ? { cluster: row['cluster'] } : {}) };
      },
      write: async (id, one) => {
        await kept.put({ id, tunnel: one.id, name: one.name, ...(one.cluster === undefined ? {} : { cluster: one.cluster }) });
      },
    },
  });

  plugin.registerTunnelKind(devtunnelKind({
    plugin,
    service,
    ...(connector === undefined ? {} : { connector }),
    anonymous,
    keep,
    open: (id) => tunnels.held(id) !== undefined,
    daemonPort: () => daemonPort,
    guarded: () => guarded,
    connectionToken: () => connectionToken,
  }));

  // Every host the service opened closes with the plugin that opened it, even
  // one a failed stop left behind.
  plugin.registerClose(() => service.close());

  plugin.log(`${name}: ${KIND} tunnels on ${connector === undefined ? 'no connector until one is set' : `connector ${connector}`}`);
};
