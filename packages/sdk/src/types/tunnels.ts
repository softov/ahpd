/**
 * A kind of tunnel, and one tunnel as its kind is handed it.
 *
 * A kind is what a plugin offers, as an adapter is: a form for the settings a
 * tunnel of it needs, the operations a person may run, and the handlers the
 * host calls. The host owns the list, the records and the grants; the kind
 * owns what a tunnel actually is, so a host that loads no kind holds an empty
 * list and pays nothing for the mechanism.
 *
 * The tunnel the host hands a handler is the stored record with every secret
 * resolved: each `secret` field the schema marks is the value the vault holds
 * rather than the reference the record keeps. `report` is how the kind says
 * what changed - the status, the address, the error, or a setting of the
 * record - without the kind having to know where the record is or who
 * subscribed to it.
 */

import type { Icon } from '@microsoft/agent-host-protocol';
import type { ConnectorOwner } from './connectors.js';
import type { Catalogs } from '../i18n.js';
import type { KindOperation } from './kinds.js';

/**
 * What a kind says a tunnel is doing.
 *
 * `running` is a tunnel a client can reach, `stopped` is one that is stored
 * and not up, and `error` is one whose last attempt failed. A kind reports the
 * state as it knows it; the host keeps it in memory and merges it into the
 * record a client reads.
 */
export type TunnelStatus = 'running' | 'stopped' | 'error';

/**
 * What a kind reports while it works on a tunnel.
 *
 * Every member is optional, because a kind says only what changed: a call may
 * report a new status with no new URL, or an error with no status. A report
 * with no members says nothing.
 */
export interface TunnelReport {
  /** How the tunnel is doing now. */
  status?: TunnelStatus;
  /**
   * The address a client reaches it at.
   *
   * Absolute, because a client opens it as it is. A tunnel that answers no
   * address yet reports none rather than an empty string.
   */
  url?: string;
  /** Why the last attempt failed, for a person reading the row. */
  error?: string;
  /**
   * Settings of the record the kind changed while it worked.
   *
   * A kind that turns a setting on as it runs reports it here, and the host
   * saves it, so the row and the next start see the change. Only the fields
   * named are saved, and every other setting is left as it was. A field the
   * schema marks `secret` is moved to the vault as a put moves it, so a kind
   * reports the value and never the reference.
   */
  settings?: Record<string, unknown>;
}

/**
 * How a kind reports on a tunnel.
 *
 * A function rather than a returned value, because one call may have several
 * things to say over its life: a `start` reports `running` and its URL when
 * the relay is up, and an error later if it drops. No answer, error or log
 * carries a secret setting.
 */
export type ReportTunnel = (report: TunnelReport) => void;

/**
 * Why a tunnel is on the list.
 *
 * The host sets it and no person types it. `system` is the one tunnel of each
 * kind the host adds for its own reachability, and `person` is one somebody
 * made. The canvas plan adds its own purpose here; this plan knows the two.
 */
export type TunnelPurpose = 'system' | 'person';

/**
 * One tunnel, as the host hands it to its kind.
 *
 * The fields are the stored record's, with `settings` holding the values the
 * vault answered for every secret field. `owner` is absent when the tunnel is
 * the host's own, which is what a `create` without an owner gives.
 */
export interface Tunnel {
  /** The record's id, which is also what a client names in a target. */
  id: string;
  /** The `name` of the kind this tunnel is one of. */
  kind: string;
  /** The plugin that registered the kind, so a row can name who opened it. */
  plugin: string;
  /** Why the tunnel is on the list, as the host set it. */
  purpose: TunnelPurpose;
  /** Whether the host should keep it up, which a person turns on and off. */
  enabled: boolean;
  /** Whose tunnel it is: a team's or a person's. Absent, the host's own. */
  owner?: ConnectorOwner;
  /**
   * The tunnel's own settings, with each secret resolved.
   *
   * The fields are the kind's schema's, and a field the schema marks `secret`
   * is the vault's value here rather than the reference a record carries.
   */
  settings: Record<string, unknown>;
}

/**
 * What a kind is given when the host asks it what the system tunnel should be.
 *
 * The port is the one the daemon bound, so a kind that forwards to the daemon
 * does not have to read the configuration to find it.
 */
export interface TunnelSystemContext {
  /** The port the daemon is bound to. */
  port: number;
}

/**
 * One kind of tunnel a plugin offers.
 *
 * The name is the kind's identity and is a slug, because it is also the `kind`
 * a stored tunnel carries. The schema is the form a client draws a tunnel's
 * settings from, and is what the host checks a `create` input against. The
 * handlers are called for one record at a time, with the record's secrets
 * already resolved.
 */
export interface TunnelKind {
  /** The kind's name: a slug, and the `kind` every tunnel of it carries. */
  name: string;
  /** What a client prints for the kind. */
  title: string;
  /** One sentence on what a tunnel of this kind is. */
  description: string;
  /** The JSON Schema a client draws a tunnel's settings from. */
  schema: Record<string, unknown>;
  /**
   * What a client draws beside the kind's title.
   *
   * An `src` that is a path is relative to the package of the plugin that
   * registered the kind, as an adapter's is.
   */
  icons?: Icon[];
  /**
   * The verbs a person may run on a tunnel of this kind.
   *
   * The host adds the ones it serves for every kind - `create`, `update`,
   * `remove`, `enable` and `disable` - and lists these beside them. A name the
   * host already serves is refused at registration, and one the kind lists but
   * the host needs for itself is still not offered twice.
   */
  operations?: KindOperation[];
  /**
   * Make one tunnel.
   *
   * Called for a `create` with the record already saved, and for the system
   * tunnel the host adds at `listening`. The kind starts doing what it does
   * and answers when it is done; a throw removes the record the host just
   * saved, so a tunnel that could not be made leaves nothing behind.
   */
  create(tunnel: Tunnel, report: ReportTunnel): void | Promise<void>;
  /**
   * Take one tunnel down.
   *
   * Called for a `remove` before the record and its secrets are deleted, so
   * the kind can still read the settings it needs to undo what it did.
   */
  remove(tunnel: Tunnel): void | Promise<void>;
  /**
   * Run one operation the kind listed.
   *
   * `name` is the operation's id, `input` is what the host checked against its
   * schema, and `tunnel` is the record it was pointed at. The host has already
   * checked the grant and the scope, so the kind runs the verb and reports
   * what changed.
   */
  invoke(name: string, tunnel: Tunnel, report: ReportTunnel, input?: Record<string, unknown>): void | Promise<void>;
  /**
   * Apply a change to a tunnel's settings.
   *
   * Called for an `update` after the new record is saved, with the input a
   * person sent. The kind decides whether the change applies live or needs the
   * tunnel to restart, and reports what it did. Absent, every update restarts
   * the tunnel: the host stops it and starts it again with the new settings.
   */
  update?(tunnel: Tunnel, input: Record<string, unknown>, report: ReportTunnel): void | Promise<void>;
  /**
   * What the host's own tunnel of this kind should be, when it needs one.
   *
   * Asked once after `listening`, only when the list holds no tunnel of this
   * kind with `purpose: system`. The answer is the `create` input a person
   * would have sent, or nothing when this host needs no such tunnel. The host
   * sets the purpose to `system`, so a kind never types it.
   */
  system?(context: TunnelSystemContext): Record<string, unknown> | undefined
    | Promise<Record<string, unknown> | undefined>;
}

/** One kind of tunnel as the fold keeps it, with the plugin that registered it. */
export interface ServedTunnelKind extends TunnelKind {
  /** The plugin that registered it. */
  by: string;
  /** The catalogs of that plugin, where the text of the kind's operations is translated. */
  catalogs?: Catalogs;
}
