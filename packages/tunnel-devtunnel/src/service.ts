/**
 * The Dev Tunnels service, through the SDK.
 *
 * One `Cloud` is one connector's account as the SDK reaches it: a management
 * client that carries that connector's token, and the one Dev Tunnel this
 * plugin finds or makes in it. One `Service` holds a `Cloud` for each connector
 * the daemon is using, hosts each Dev Tunnel once, and puts the records' ports
 * on it.
 *
 * The split is what makes the arrangement testable without the network. The
 * service reads only `Cloud`, `Host` and the ids and labels of a `Remote`;
 * everything below that is the SDK's, and a test hands the service a cloud that
 * is a few arrays instead.
 *
 * A connector's Dev Tunnel is found as VS Code's CLI finds the tunnel it hosts
 * (`start_new_launcher_tunnel` in cli/src/tunnels/dev_tunnels.rs): by the id
 * kept for it from the last run, then by its name with the launcher label,
 * and made only when neither answers; its labels are then set to the ones it
 * should carry. The id is what a client derives its connection token from, and
 * a new id is every client pointed at nothing. The same id is why a port is
 * written with `createOrUpdate`: a kept tunnel still carries the port from the
 * last run, and a plain create answers a conflict for it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/cli/src/tunnels/dev_tunnels.rs#L575-L805
 */

import { TunnelRelayTunnelHost } from '@microsoft/dev-tunnels-connections';
import {
  TunnelAccessControlEntryType, TunnelAccessScopes, TunnelEndpoint, TunnelProtocol,
} from '@microsoft/dev-tunnels-contracts';
import type { Tunnel as DevTunnel, TunnelAccessControl, TunnelPort } from '@microsoft/dev-tunnels-contracts';
import { ManagementApiVersions, TunnelManagementHttpClient } from '@microsoft/dev-tunnels-management';
import type { TunnelManagementClient } from '@microsoft/dev-tunnels-management';
import { LABELS, LAUNCHER_LABEL } from './discovery.js';

/** One Dev Tunnel, as much of it as the service and the kind read. */
export interface Remote {
  /** The Dev Tunnel's id, which is what a client derives its token from. */
  id: string;
  /** The labels it carries, which is where its display name comes from. */
  labels: string[];
  /** The cluster it lives in, which is the region in its URL. */
  cluster?: string;
  /** How many hosts are connected to it now: another machine hosts a tunnel with one. */
  hosts?: number;
}

/** The tunnel a connector hosted, kept across runs as the CLI keeps its launcher tunnel. */
export interface Kept {
  /** The Dev Tunnel's id. */
  id: string;
  /** Its cluster. */
  cluster?: string;
  /** The name it was hosted under. */
  name: string;
}

/** What a port on one Dev Tunnel is doing now. */
export interface Shown {
  /** The Dev Tunnel's id. */
  id: string;
  /** The URL the port answers at, when the service answered one. */
  url?: string;
  /** How many hosts are connected to the relay: 0 is a relay that is down. */
  hosts: number;
  /** How many clients are connected to the tunnel. */
  clients: number;
}

/** What one port answered when it was put on the tunnel. */
export interface Served {
  /** The Dev Tunnel the port is on. */
  remote: Remote;
  /** The URL the port answers at, when the service answered one. */
  url?: string;
}

/** One Dev Tunnel's half of the SDK: the account, the tunnel, and its state. */
export interface Cloud {
  /** The tunnel kept from the last run, or nothing when the service no longer has it or refuses it. */
  get(kept: Kept): Promise<Remote | undefined>;
  /** The account's first tunnel carrying both the launcher label and this name, or nothing. */
  find(name: string): Promise<Remote | undefined>;
  /** Make one carrying these labels. */
  make(labels: string[]): Promise<Remote>;
  /** Give the tunnel `get`, `find` or `make` answered these labels, when it carries others. */
  sync(labels: string[]): Promise<Remote>;
  /** Host the tunnel `get`, `find` or `make` answered. */
  host(): Promise<Host>;
  /** What one of its ports is doing now. */
  show(port: number): Promise<Shown | undefined>;
  /** Take the tunnel away. */
  delete(): Promise<void>;
}

/**
 * One hosted Dev Tunnel, as the service adds and removes its ports.
 *
 * `refresh` is the call that matters: a relay host started before a port was
 * put on the tunnel serves what it knew when it connected, and a port added
 * afterwards is one clients cannot reach until the host is told again.
 */
export interface Host {
  /** Put a port on the tunnel with its access, and answer its URL. */
  add(port: number, anonymous: boolean): Promise<string | undefined>;
  /** Change a port's access without moving it. */
  access(port: number, anonymous: boolean): Promise<void>;
  /** Take a port off the tunnel. */
  remove(port: number): Promise<void>;
  /** Serve the ports the tunnel carries now. */
  refresh(): Promise<void>;
  /** Drop the relay and connect it again, which is what a restart is. */
  restart(): Promise<void>;
  /** Close the relay, leaving the tunnel and its ports in the service. */
  close(): Promise<void>;
}

/** The ports on one connector's tunnel, as the daemon holds them. */
export interface Service {
  /** Put a port on the connector's Dev Tunnel, making and hosting it if needed. */
  add(connector: string, port: number, anonymous: boolean): Promise<Served>;
  /** Change one hosted port's access. */
  access(connector: string, port: number, anonymous: boolean): Promise<void>;
  /** Move a port to another number without closing the host. */
  replace(connector: string, from: number, to: number, anonymous: boolean): Promise<string | undefined>;
  /**
   * Take a port off the connector's Dev Tunnel.
   *
   * The host closes when its last port goes. The Dev Tunnel is deleted on that
   * last stop only when `keep` is false.
   */
  remove(connector: string, port: number, keep: boolean): Promise<void>;
  /** Connect the connector's relay again. */
  restart(connector: string): Promise<void>;
  /** What a port on the connector's tunnel is doing now. */
  show(connector: string, port: number): Promise<Shown | undefined>;
  /** Close every host, leaving the tunnels in the service. */
  close(): Promise<void>;
}

/** What the SDK side is built with. */
export interface ServiceOptions {
  /**
   * The token of one open connector, or nothing when it is not open.
   *
   * It answers once a refresh that is running has ended, so no call goes out
   * with the token that refresh replaces.
   */
  token(connector: string): Promise<{ token: string } | undefined>;
  /** What the Dev Tunnel is called: the plugin's `name` option, or the machine's, as VS Code names it. */
  name: string;
  /** Where the tunnel each connector hosted is kept between runs. */
  kept?: {
    read(connector: string): Promise<Kept | undefined>;
    write(connector: string, kept: Kept): Promise<void>;
  };
  /**
   * Build the SDK's half for one connector.
   *
   * Replaced in tests, which have no service to reach. Every call the plugin
   * makes goes through this, so a fake is the whole of what a test stands in.
   */
  cloud?: (connector: string) => Cloud;
}

/** The labels a tunnel carries, as the CLI's `get_labels` gives them: its name, the protocol and the launcher. */
export function labelsOf(name: string): string[] {
  return [name, ...LABELS];
}

/**
 * What a name with a tunnel another machine hosts is refused with, in the
 * CLI's words (`CodeError::TunnelActiveAndInUse`, cli/src/util/errors.rs L518).
 */
const inUse = (name: string): string =>
  `A tunnel with the name ${name} exists and is in-use. Please pick a different name or stop the existing tunnel.`;

/** The service over the SDK, with one management client and one host for each connector. */
export function sdkService(options: ServiceOptions): Service {
  interface Entry {
    cloud: Cloud;
    remote: Remote;
    host?: Host;
    ports: Set<number>;
  }

  /** One entry for each connector the daemon is using. */
  const served = new Map<string, Entry>();

  /** The cloud of one connector, which is the SDK unless a test stands in. */
  const cloudOf = (connector: string): Cloud =>
    options.cloud?.(connector) ?? sdkCloud(connector, options);

  /**
   * The connector's tunnel, found or made on first use, as the CLI finds the
   * tunnel it hosts: the kept one by its id; else the account's tunnel of this
   * name with the launcher label, refused while another machine hosts it; else
   * a new one. Its labels are then the ones it should carry, a changed name
   * among them, and what was hosted is kept for the next run.
   */
  const entryOf = async (connector: string): Promise<Entry> => {
    const already = served.get(connector);
    if (already !== undefined) return already;
    const cloud = cloudOf(connector);
    const kept = await options.kept?.read(connector);
    let found = kept === undefined ? undefined : await cloud.get(kept);
    if (found === undefined) {
      const named = await cloud.find(options.name);
      if (named !== undefined && (named.hosts ?? 0) > 0) throw new Error(inUse(options.name));
      found = named ?? await cloud.make(labelsOf(options.name));
    }
    const remote = await cloud.sync(labelsOf(options.name));
    if (kept === undefined || kept.id !== remote.id || kept.name !== options.name) {
      await options.kept?.write(connector, {
        id: remote.id,
        ...(remote.cluster === undefined ? {} : { cluster: remote.cluster }),
        name: options.name,
      });
    }
    const made: Entry = { cloud, remote, ports: new Set<number>() };
    served.set(connector, made);
    return made;
  };

  /** The connector's entry, with its Dev Tunnel hosted. */
  const hosted = async (connector: string): Promise<{ one: Entry; host: Host }> => {
    const one = await entryOf(connector);
    const host = one.host ?? await one.cloud.host();
    one.host = host;
    return { one, host };
  };

  return {
    add: async (connector, port, anonymous) => {
      const { one, host } = await hosted(connector);
      const url = await host.add(port, anonymous);
      one.ports.add(port);
      // The host connected before this port was on the tunnel, so it has to be
      // told about it again.
      await host.refresh();
      return { remote: one.remote, ...(url === undefined ? {} : { url }) };
    },

    access: async (connector, port, anonymous) => {
      const one = served.get(connector);
      if (one?.host === undefined || !one.ports.has(port)) return;
      await one.host.access(port, anonymous);
    },

    replace: async (connector, from, to, anonymous) => {
      const { one, host } = await hosted(connector);
      await host.remove(from);
      one.ports.delete(from);
      const url = await host.add(to, anonymous);
      one.ports.add(to);
      await host.refresh();
      return url;
    },

    remove: async (connector, port, keep) => {
      const one = served.get(connector);
      if (one === undefined) return;
      if (one.host !== undefined) {
        await one.host.remove(port);
        one.ports.delete(port);
        await one.host.refresh();
      } else {
        one.ports.delete(port);
      }
      if (one.ports.size > 0) return;
      // Forgotten before the two calls that leave: a stop that fails halfway
      // still leaves nothing on the daemon's side to take down twice.
      served.delete(connector);
      await one.host?.close();
      if (!keep) await one.cloud.delete();
    },

    restart: async (connector) => {
      const one = served.get(connector);
      if (one?.host === undefined) return;
      await one.host.restart();
    },

    show: async (connector, port) => {
      const one = served.get(connector);
      if (one === undefined) return undefined;
      return await one.cloud.show(port);
    },

    close: async () => {
      const held = [...served.values()];
      served.clear();
      for (const one of held) {
        try { await one.host?.close(); }
        catch { /* a host that will not close is going away with the daemon */ }
      }
    },
  };
}

/**
 * The SDK's half of one connector.
 *
 * The token callback is read at every request rather than taken once, because
 * the adapter rotates the token while the daemon runs and the newer one is the
 * one that works. The service reads a GitHub token under its own `github`
 * scheme, not `Bearer`, and nothing else.
 */
function sdkCloud(connector: string, options: ServiceOptions): Cloud {
  const management = new TunnelManagementHttpClient(
    'ahpd-tunnel-devtunnel (https://github.com/ahpio/ahpd)',
    ManagementApiVersions.Version20230927preview,
    async () => {
      const open = await options.token(connector);
      return open === undefined ? null : `github ${open.token}`;
    },
  );

  /** The tunnel `find` or `make` answered, which every other call names. */
  let held: DevTunnel | undefined;

  const mine = (): DevTunnel => {
    if (held === undefined) throw new Error('the Dev Tunnel was neither found nor made');
    return held;
  };

  const remoteOf = (tunnel: DevTunnel): Remote => ({
    id: tunnel.tunnelId ?? '',
    labels: tunnel.labels ?? [],
    ...(tunnel.clusterId === undefined ? {} : { cluster: tunnel.clusterId }),
    hosts: countOf(tunnel.status?.hostConnectionCount),
  });

  /*
   * A relay host for this account, connected to `tunnel`.
   *
   * The cast is a gap in the SDK's declarations, not a difference at run time:
   * the HTTP client's optional `httpsAgent` is typed `Agent | undefined`, which
   * `exactOptionalPropertyTypes` will not hand to `TunnelManagementClient`'s
   * `httpsAgent?: Agent`, though the class does implement the interface.
   */
  const relay = async (tunnel: DevTunnel): Promise<TunnelRelayTunnelHost> => {
    const host = new TunnelRelayTunnelHost(management as unknown as TunnelManagementClient);
    await host.connect(tunnel);
    return host;
  };

  return {
    get: async (kept) => {
      // A tunnel the service no longer has (404) or no longer lets this account
      // host (403) is made again, as the CLI's `get_or_create_tunnel` does.
      let found: DevTunnel | null;
      try {
        found = await management.getTunnel(
          { tunnelId: kept.id, ...(kept.cluster === undefined ? {} : { clusterId: kept.cluster }) },
          { includePorts: true },
        );
      }
      catch (error) {
        if ((error as { response?: { status?: number } }).response?.status === 403) return undefined;
        throw error;
      }
      if (found === null) return undefined;
      held = found;
      return remoteOf(found);
    },

    find: async (name) => {
      // The CLI's `get_existing_tunnel_with_name`: both labels required, the first answer taken.
      const listed = await management.listTunnels(undefined, undefined, {
        labels: [LAUNCHER_LABEL, name],
        requireAllLabels: true,
        limit: 1,
        includePorts: true,
      });
      const found = listed[0];
      if (found === undefined) return undefined;
      held = found;
      return remoteOf(found);
    },

    make: async (labels) => {
      const made = await management.createTunnel({ labels });
      if (made.tunnelId === undefined || made.tunnelId === '') {
        throw new Error('the service did not say which Dev Tunnel it made');
      }
      held = made;
      return remoteOf(made);
    },

    sync: async (labels) => {
      // The CLI's `sync_tunnel_tags`: written only when the labels differ as a set.
      const tunnel = mine();
      const now = new Set(tunnel.labels ?? []);
      if (now.size === labels.length && labels.every((label) => now.has(label))) return remoteOf(tunnel);
      const updated = await management.updateTunnel({
        ...(tunnel.tunnelId === undefined ? {} : { tunnelId: tunnel.tunnelId }),
        ...(tunnel.clusterId === undefined ? {} : { clusterId: tunnel.clusterId }),
        labels,
      });
      held = { ...tunnel, labels: updated.labels ?? labels };
      return remoteOf(held);
    },

    host: async () => {
      const tunnel = mine();
      const connected = await relay(tunnel);
      let live = connected;
      return {
        add: async (port, anonymous) => {
          const made = await management.createOrUpdateTunnelPort(tunnel, portOf(port, anonymous));
          // The service's answer, else the URL the SDK forms from the tunnel's
          // endpoint, as the CLI's `get_port_uri` forms it from `port_uri_format`.
          const endpoint = tunnel.endpoints?.find((one) => one.portUriFormat !== undefined);
          return made.portForwardingUris?.[0] ?? (endpoint === undefined ? undefined : TunnelEndpoint.getPortUri(endpoint, port));
        },
        access: async (port, anonymous) => {
          await management.updateTunnelPort(tunnel, portOf(port, anonymous));
        },
        remove: async (port) => { await management.deleteTunnelPort(tunnel, port); },
        refresh: async () => { await live.refreshPorts(); },
        restart: async () => {
          await live.dispose();
          live = await relay(tunnel);
        },
        close: async () => { await live.dispose(); },
      };
    },

    show: async (port) => {
      const now = await management.getTunnel(mine(), { includePorts: true });
      if (now === null) return undefined;
      const at = now.ports?.find((one) => one.portNumber === port);
      return {
        id: now.tunnelId ?? '',
        ...(at?.portForwardingUris?.[0] === undefined ? {} : { url: at.portForwardingUris[0] }),
        hosts: countOf(now.status?.hostConnectionCount),
        clients: countOf(now.status?.clientConnectionCount),
      };
    },

    delete: async () => { await management.deleteTunnel(mine()); },
  };
}

/**
 * A port with its protocol and its access, which is the whole of what a write
 * sets: `auto`, as the CLI forwards the agent host's port, and one anonymous
 * entry, allowing for a public port and denying for a private one, so a public
 * default on the tunnel does not open a port that is meant to be private.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/cli/src/tunnels/dev_tunnels.rs#L1119-L1130
 */
export function portOf(port: number, anonymous: boolean): TunnelPort {
  return {
    portNumber: port,
    protocol: TunnelProtocol.Auto,
    accessControl: anonymousAccess(anonymous),
  };
}

/**
 * The one anonymous entry a port carries, as the CLI's `privacy_to_tunnel_acl`
 * writes it: an allow for a public port, a deny for a private one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/cli/src/tunnels/dev_tunnels.rs#L1350-L1378
 */
function anonymousAccess(allow: boolean): TunnelAccessControl {
  return {
    entries: [{
      type: TunnelAccessControlEntryType.Anonymous,
      ...(allow ? {} : { isDeny: true }),
      // Anonymous entries name no subjects: the type is the subject.
      subjects: [],
      scopes: [TunnelAccessScopes.Connect],
    }],
  };
}

/** A connection count, which the service answers as a number or a status. */
function countOf(value: number | { current: number } | undefined): number {
  if (value === undefined) return 0;
  return typeof value === 'number' ? value : value.current;
}
