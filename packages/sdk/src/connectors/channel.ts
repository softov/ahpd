/**
 * `x-ahpd-connectors`: the connectors made from the adapters a host serves.
 *
 * One row for each stored connector, keyed by the connector's id, holding the
 * record as it is kept, a `state` and its `alerts`. The state is `ready`,
 * `unauthorized` when it is open and its last check was denied, `failed` when
 * its adapter could not open it, `invalid` when its config does not fit the
 * adapter's schema, or `unavailable` when no plugin registers its adapter any
 * more. Each alert names one problem a person has to fix: an `env:` or a
 * `secret:` a record is missing, an `open` that failed, a `check` that did not
 * pass, or a `call` that failed. The adapters themselves are listed on
 * `x-ahpd-adapters`.
 *
 * Each row carries `operations`, the ids its record offers now: Enable on a
 * record that is off, Disable on one that is on, and Remove on every one. The
 * channel lists those three for `x-ahpd/invokeOperation`, beside the commands
 * below. Sign in is not one of them: it stays `x-ahpd/connectors/signin`, with
 * the form its adapter fills.
 *
 * A row carries `views`, by surface, when the plugin that opened the connector
 * showed one: each a view with its data model, as a plugin's own row carries
 * its page. The views are in memory only, as the alerts are, and a close, a
 * removal or an unloaded plugin takes them away. A change to one value of a
 * view's data is sent as `x-ahpd-connectors/viewData` `{ id, surface, path, value }`
 * to each reader of the connector, and the row is not sent again.
 *
 * Where an adapter's schema marks a field `secret`, the value is a secret. A
 * put moves it to the vault under `connector/<id>/<field>` in the owner's
 * scope and keeps a `{ "$secret": "<name>" }` in the record instead, so a
 * listing, a snapshot, an answer and the log never carry it. A field sent
 * empty keeps the secret the record already had, because a client is never
 * given one to send back. A host connector's field may hold
 * `{ "fromEnv": "<NAME>" }` instead, which the host reads from its own
 * environment when it opens the connector; a team's or a person's connector
 * that names one is refused.
 *
 * Three commands serve a connector. `x-ahpd/connectors/put` takes
 * `{ id, adapter, owner, title?, config }`, checks `config` against the
 * adapter's schema, closes the connector with that id, writes the record, calls
 * the adapter's `open` with each secret read back, and waits for its `check`.
 * `x-ahpd/connectors/remove` takes `{ id }`, closes it, takes its secrets out
 * of the vault and takes the record out. Both answer the row a client now
 * holds. `x-ahpd/connectors/check` takes `{ id }`, runs the adapter's `check`
 * again and answers the row, so a person who fixed the service side sees the
 * connector work without saving it again. The plugin that registered the
 * connector's adapter may ask for it with no grant.
 *
 * An adapter may also declare a `signIn`, and then two more commands are
 * served. `x-ahpd/connectors/signin` takes what a put takes, checks it the same
 * way except for the fields the sign-in fills, and answers `{ url, state }` for
 * a pasted code or `{ state, code, url, expires }` for a device code. A pasted
 * code's start keeps a PKCE verifier and the put's own params in memory for ten
 * minutes under a state. A device code's start keeps the handle, the params and
 * the starter's reader, and the host polls the adapter for as long as the code
 * lasts. `x-ahpd/connectors/signin-finish` takes `{ state, code }` for the
 * pasted code and `{ state }` alone for the device code. It runs the put's
 * owner checks again, and answers the row: the pasted code exchanges through
 * the adapter first, and the device code waits for the approval the host has
 * been polling. A state is the caller's. A pasted state is used once, and a
 * device one answers the same settled outcome until its code expires. No
 * answer, row, error or log carries the code, the verifier, the handle or the
 * key.
 *
 * `x-ahpd/connectors/note` takes `{ id, ok?, status?, error? }`, one call an
 * open connector made, and raises or clears its `call` alert as a host part's
 * outcome is kept. A note with no `ok` records no call. Only the plugin that
 * registered the connector's adapter notes, since it makes the connector's
 * calls outside `run`. It needs no grant and no owner's rule for a connector of
 * its own adapter. It answers the row.
 *
 * `x-ahpd/connectors/secret` takes `{ id, values }`, the secret fields a plugin
 * refreshed for one open connector, and writes each value to the vault under
 * `connector/<id>/<field>` in the owner's scope. Only the plugin that registered
 * the connector's adapter sends it, as only that plugin notes, with no grant. A field whose
 * record does not point at its vault name yet is written to point at it, and the
 * connector is not reopened, because the plugin holds the new value already. It
 * answers the row, and no answer, error or log carries a value.
 *
 * `x-ahpd/connectors/models` takes `{ id }` and answers the models one open
 * provider connector serves, as the model proxy's catalog last read them, with
 * the name a caller sends and whether this reader may call each one. It is
 * served on a host that hands the channel a `models` reader.
 *
 * `connector:list` reads the caller's own connectors, their teams' and the
 * host's; `connector:all` reads every connector. A caller with neither reads
 * no connector, its own included. A connector of an adapter no plugin
 * registers stays on disk and is served as `unavailable`: a disabled plugin
 * keeps its connectors.
 */

import { createHash, randomBytes } from 'node:crypto';

import { INVALID_PARAMS, INTERNAL_ERROR, RpcError } from '../rpc.js';
import { sameOwnerOrHost } from './fields.js';
import { fromEnvRef, scopeOf, secretRef } from '../access/vault.js';
import {
  CONNECTOR_SECRETS,
  DENIED,
  HELD,
  asOwner,
  forgetAll as forgetRecordSecrets,
  heldAgainst as heldSecrets,
  moveSecrets as moveRecordSecrets,
  onTeam,
  ownerAllows,
  refuseOwner,
  resolved as resolvedRecord,
  secretFields,
  secretNameOf,
  writeOnlyHeld,
} from '../channels/owners.js';
import { isRecordSlug } from '../resources/records.js';
import { recordsChannel, type RecordsChannel } from '../resources/recordschannel.js';
import { recordViews } from '../plugins/views.js';
import { alertList, dropOpenAlerts, raiseOpenAlerts } from '../plugins/alerts.js';
import { bag, isRecord, reason } from '../utils/values.js';
import type { ActionCall, CheckResult, Connector, ConnectorModels, ConnectorOwner, ConnectorRef, DeviceSignIn, DeviceSignInPoll, ProviderConnector, ServedAdapter } from '../types/connectors.js';
import type { AlertList } from '../plugins/alerts.js';
import type { OperationChannel } from '../kinds/operations.js';
import type { PluginMethod, ViewHandle } from '../types/plugin.js';
import type { RecordCollection, StoredRecord } from '../types/records.js';
import type { Grant, Principal } from '../types/users.js';
import type { Operation } from '../types/kinds.js';
import type { Owner } from '../types/usage.js';
import type { Vault } from '../types/vault.js';

/** The channel's scheme, and the domain its commands are named under. */
const SCHEME = 'x-ahpd-connectors';
const DOMAIN = 'x-ahpd/connectors';
/** The URI a client reads the list at, and the one `x-ahpd/invokeOperation` names. */
const URI = `${SCHEME}://`;
const PUT = `${DOMAIN}/put`;
const REMOVE = `${DOMAIN}/remove`;
const CHECK = `${DOMAIN}/check`;
const ENABLE = `${DOMAIN}/enable`;
const DISABLE = `${DOMAIN}/disable`;
const SIGNIN = `${DOMAIN}/signin`;
const SIGNIN_FINISH = `${DOMAIN}/signin-finish`;
const MODELS = `${DOMAIN}/models`;
const NOTE = `${DOMAIN}/note`;
const SECRET = `${DOMAIN}/secret`;

/** How long one sign-in waits for the code a person pastes, in milliseconds. */
const SIGNIN_LIMIT_MS = 10 * 60 * 1000;

/** The most started sign-ins one caller may have waiting; the oldest goes first. */
const SIGNIN_KEPT = 10;

/** How long one exchange may take. */
const EXCHANGE_LIMIT_MS = 10_000;

/** How long a check may take before its connector is called `unreachable`. */
const CHECK_LIMIT_MS = 10_000;

/** The most of an error message an alert keeps. */
const ALERT_MESSAGE_LIMIT = 500;

/** The most alerts one connector's row holds, as a plugin's row holds. */
const MAX_ALERTS = 50;

/** The least time between two refreshes that a call outcome sends. */
const NOTE_REFRESH_MS = 1000;

/** The states a connector row can be in. */
export type ConnectorState = 'ready' | 'unauthorized' | 'failed' | 'invalid' | 'unavailable' | 'disabled';

/** How a connectors channel reads its store, and who it writes a secret for. */
export interface ConnectorsChannelOptions {
  /** The `connectors` collection: one JSON record for each connector. */
  collection: RecordCollection;
  /**
   * The adapters the plugins registered, read at each call.
   *
   * Read through a function because the adapters are known only after the
   * load, and a channel built before it would hold none.
   */
  adapters(): Record<string, ServedAdapter>;
  /** The vault a secret is written to, and read back from when an adapter opens. */
  vault(): Vault | undefined;
  /**
   * Check one value against an adapter's schema, throwing the first finding.
   *
   * Taken as an option rather than imported: the sdk takes no third-party
   * runtime, and the schema checker the daemon uses belongs to the server.
   */
  check(value: unknown, schema: Record<string, unknown>, label: string): void;
  /**
   * One automation a schema field may name, by id, read at each put.
   *
   * A field marked `x-ahpd-automation: true` names one of these, and a put is
   * refused when it names none or one the connector's owner may not read.
   * Absent on a host with no automations store, which checks no reference.
   */
  automations?(id: string): { owner?: Owner | undefined } | undefined;
  /**
   * The models one open provider connector serves, for one reader.
   *
   * Taken as an option because the catalog the list is kept in, and the routes
   * and policies that say what a reader may call, belong to the server's model
   * proxy. Absent: the host serves no `x-ahpd/connectors/models`.
   */
  models?(connector: ProviderConnector, reader: Principal | undefined): Promise<ConnectorModels>;
  /** Where a connector that could not be opened is said. */
  onProblem?(message: string): void;
  /**
   * Called when the id, adapter, owner or title of a stored connector changes.
   *
   * A schema the host sends lists the connectors as a field's choices, so the
   * channels that send one are told to send it again.
   */
  onRefs?(): void;
}

/** One open connector: what `open` was handed, and what stops it. */
interface Opened {
  /** The connector as it was opened, secrets read back from the vault. */
  connector: Connector;
  /** What stops it, or nothing where the adapter answered nothing to stop. */
  stop?: () => void | Promise<void>;
}

/** The outcome a device sign-in settles on once, and a finish waits for. */
type DeviceOutcome =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: RpcError };

/** The device half of a started sign-in: its poll, its outcome and who waits. */
interface StartedDevice {
  /** The adapter's sign-in, as it was declared when the sign-in started. */
  signIn: DeviceSignIn;
  /** The handle `poll` takes, sent to nothing but the adapter. */
  handle: string;
  /** The poll's next run, or the cleanup that forgets a settled sign-in. */
  timer: ReturnType<typeof setTimeout> | undefined;
  /** The finishes waiting for the outcome, told once it settles. */
  waiting: ((outcome: DeviceOutcome) => void)[];
  /** The row or the error, kept until the expiry so a late finish answers it. */
  outcome: DeviceOutcome | undefined;
  /** Whether the values are being written, which an expiry does not cut off. */
  finishing?: boolean;
}

/**
 * One sign-in a caller started, kept in memory until its code arrives.
 *
 * The verifier is the PKCE secret the challenge was made from, and the params
 * are what the start was asked to make, with the sign-in's field left out so
 * only the exchange can fill it. A device sign-in keeps the adapter's handle
 * and its poll instead of a verifier: the host asks the adapter, not a person.
 */
interface StartedSignIn {
  /** Which sign-in this is: the pasted code or the device flow. */
  flow: 'code' | 'device';
  /** The PKCE verifier, sent to nothing but the adapter's exchange. */
  verifier: string;
  /** What the put is made with once the code is exchanged. */
  params: Record<string, unknown>;
  /** Who started it: the owner their connection works as, or nothing on a host with no users. */
  caller: Owner | undefined;
  /** Who started it, as a reader the owner's rule is asked of again when it writes. */
  reader: Principal | undefined;
  /** When it stops being finishable, in epoch milliseconds. */
  expires: number;
  /** The device half, on a device sign-in. */
  device?: StartedDevice;
}

/** What a put and a sign-in both check before anything is written. */
interface Prepared {
  /** The connector's id, already a slug. */
  id: string;
  /** The adapter the connector names, as this host serves it. */
  adapter: ServedAdapter;
  /** Who the connector belongs to. */
  owner: ConnectorOwner;
  /** What the client calls it, when it said. */
  title: string | undefined;
  /** The config as the client sent it. */
  config: Record<string, unknown>;
  /** The record the id held, when it held one. */
  before: StoredRecord | undefined;
  /** The owner the record held, when it named one. */
  was: ConnectorOwner | undefined;
  /** The secrets a record of this owner keeps, read for the fields sent empty. */
  kept: Record<string, unknown>;
}

/** A connectors channel, the commands beside it, and the connectors it has open. */
export interface ConnectorsChannel {
  /** What `servedRecords` takes. */
  channel: RecordsChannel;
  /** `x-ahpd/connectors/put`, `remove`, `check`, `note`, `signin`, `signin-finish` and `models`, by name. */
  methods: Record<string, PluginMethod>;
  /**
   * The operations `x-ahpd/invokeOperation` reads: Enable, Disable and Remove.
   *
   * Each row's `operations` names the ones it offers now, and `run` carries
   * each through the same code as its fixed command.
   */
  operations: OperationChannel;
  /**
   * Run one action on one open connector for one reader.
   *
   * The connector has to be open, its adapter has to declare an `action` of
   * that name and have a `run`, and the reader has to pass `mayRead` - the
   * same answer a listing gives, asked again at each call so a remove or a
   * lost grant takes hold at once. A reader of nothing is the daemon itself,
   * as it is for a read. `call` is what the calling session hands the
   * adapter's `run` beside the input: its attachments folder, and where the
   * call's partial content is said. The answer is the adapter's own, passed
   * on unchanged.
   */
  run(id: string, reader: Principal | undefined, action: string, input: Record<string, unknown>, call?: ActionCall): Promise<unknown>;
  /**
   * Record the outcome of one call for one connector, as `run` and a host part
   * do.
   *
   * With `ok: false` it raises the connector's `call` alert, and with `ok: true`
   * it clears it. An error is cut to 500 characters. A note with no `ok` records no call. The
   * rows that carry it go out at most once a second.
   */
  note(id: string, outcome: { ok?: boolean; status?: number; error?: string }): void;
  /**
   * Every open connector whose adapter serves models, and how to call it.
   *
   * The answer is what the model proxy routes over: each open connector of an
   * adapter with a `provider`, with its id, adapter, owner and the
   * `ModelProvider` the adapter answers from the resolved config. A provider
   * that throws leaves its connector out, and the problem is said once.
   * An adapter with a `models` adds a `models()` bound to that open connector,
   * so its list is read from the resolved config and the key stays here.
   * Nothing sends this answer: it is for the host, and a key can be in it.
   */
  providers(): ProviderConnector[];
  /** Send every reader what the connectors are now. */
  refresh(): Promise<void>;
  /**
   * Every stored connector as a save that may name one reads it, as of the
   * last read of the collection.
   *
   * Id, adapter and owner, synchronously - what an automation's save is checked
   * against, which cannot wait for a collection that answers later. Filled by
   * every listing and by this channel's own puts and removes.
   */
  refs(): readonly ConnectorRef[];
  /** Open every stored connector of a registered adapter, as a start does. */
  openAll(): Promise<void>;
}

export function connectorsChannel(options: ConnectorsChannelOptions): ConnectorsChannel {
  /** The owner of each stored connector, as the last read of the collection found it. */
  const owners = new Map<string, ConnectorOwner | undefined>();
  /** The same connectors as a reference is checked against: id, adapter, owner and title. */
  const known = new Map<string, ConnectorRef>();
  /** One record as a reference reads it. */
  const refOf = (record: StoredRecord): ConnectorRef => ({
    id: record.id,
    adapter: String(record.adapter),
    owner: asOwner(record.owner),
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
  });
  /** The references as one string, so a change is said only when there is one. */
  const refsKey = (): string => JSON.stringify([...known.values()].sort((left, right) => left.id.localeCompare(right.id)));
  /** What stops each open connector, by id; an id in the map was opened. */
  const open = new Map<string, Opened>();
  /** What the host knows of each connector's alerts, by id, in memory only. */
  const alerts = new Map<string, AlertList>();
  /** The last check result of each connector, by id, which `unauthorized` reads. */
  const checks = new Map<string, CheckResult>();
  /** The ids whose open failed, which a record reads `failed` for. */
  const openFailures = new Set<string>();
  /** The provider problems already said, so a route on every call says each one once. */
  const providerProblems = new Set<string>();
  /** The sign-ins this host has started, by state, in memory only: a restart loses them. */
  const started = new Map<string, StartedSignIn>();

  const problem = (message: string): void => { options.onProblem?.(`${SCHEME}: ${message}`); };

  /** The alert list of one record, made on the first alert it raises. */
  const alertsOf = (id: string): AlertList => {
    let list = alerts.get(id);
    if (list === undefined) {
      list = alertList(MAX_ALERTS);
      alerts.set(id, list);
    }
    return list;
  };

  /** Drop a record's list once it holds nothing. */
  const settle = (id: string): void => {
    if (alerts.get(id)?.list().length === 0) alerts.delete(id);
  };

  /** Raise a record's open alerts in place of the last open's: one per gap it is missing, or one `open`. */
  const raiseOpen = (id: string, error: unknown): void => {
    raiseOpenAlerts(alertsOf(id), error, 'the connector could not be opened', ALERT_MESSAGE_LIMIT);
  };

  /** Clear what an open that worked leaves: the `open` alert and every gap alert. */
  const clearOpen = (id: string): void => {
    openFailures.delete(id);
    const list = alerts.get(id);
    if (list === undefined) return;
    dropOpenAlerts(list);
    settle(id);
  };

  /** Raise or clear the `check` alert of one connector. */
  const noteCheck = (id: string, result: CheckResult): void => {
    const list = alerts.get(id);
    if (result.result === 'ok') {
      list?.drop('check');
      settle(id);
      return;
    }
    const fallback = result.result === 'denied'
      ? 'the check was denied'
      : result.result === 'unreachable' ? 'the check did not answer in time' : 'the check failed';
    alertsOf(id).add({
      level: result.result === 'denied' ? 'error' : 'warning',
      text: result.message === undefined ? fallback : result.message.slice(0, ALERT_MESSAGE_LIMIT),
      ref: 'check',
    });
  };

  /** Raise or clear the `call` alert of one connector. */
  const raiseCall = (id: string, outcome: { ok?: boolean; status?: number; error?: string }): void => {
    if (outcome.ok === undefined) return;
    const list = alerts.get(id);
    if (outcome.ok) {
      list?.drop('call');
      settle(id);
      return;
    }
    const text = outcome.error !== undefined
      ? outcome.error.slice(0, ALERT_MESSAGE_LIMIT)
      : outcome.status === undefined ? 'the call failed' : `the call answered ${outcome.status}`;
    alertsOf(id).add({ level: 'warning', text, ref: 'call' });
  };

  /**
   * What each open connector shows, by id and surface.
   *
   * A whole view sends the row again; one value of its data goes to the
   * connector's readers alone, and the last row sent takes the same change.
   */
  const views = recordViews({
    problem,
    changed: () => { void channel.refresh().catch(() => {}); },
    data: (id, surface, path, value) => {
      void channel.notify(id, { type: `${SCHEME}/viewData`, surface, path, value }, (record) => ({ ...record, views: views.of(id) ?? {} }));
    },
  });

  /** The config a stored record holds, as an object. */
  const configOf = (record: StoredRecord): Record<string, unknown> => bag(record.config);

  /**
   * A config with each moved secret stood in for by what a client is shown.
   *
   * A schema says a secret field is a string, and the record holds a reference
   * object instead. The reference is checked as `HELD`, so the rules a person
   * filled the value in under are asked of the record and a value nobody may
   * read is never read to ask them.
   */
  const heldAgainst = (config: Record<string, unknown>): Record<string, unknown> => heldSecrets(config, CONNECTOR_SECRETS);

  /** Whether a stored config is still one the adapter's schema describes. */
  const fits = (config: Record<string, unknown>, schema: Record<string, unknown>): boolean => {
    try {
      options.check(heldAgainst(config), schema, 'config');
      return true;
    } catch {
      return false;
    }
  };

  /** The state a stored connector is in now. */
  const stateOf = (record: StoredRecord): ConnectorState => {
    // A record that is off is not opened or checked: that it is off is the one
    // thing its row says, whatever its adapter or its config would say.
    if (record.enabled === false) return 'disabled';
    const adapter = options.adapters()[String(record.adapter)];
    if (adapter === undefined) return 'unavailable';
    if (!fits(configOf(record), adapter.schema)) return 'invalid';
    if (openFailures.has(record.id)) return 'failed';
    if (!open.has(record.id)) return 'invalid';
    // An open connector whose provider refused its credential is not one that answers.
    return checks.get(record.id)?.result === 'denied' ? 'unauthorized' : 'ready';
  };

  /**
   * Whether the reader is the plugin that registered the record's adapter.
   *
   * That plugin holds the connector's credential from the open, so it notes its
   * calls, asks for its check and writes its refreshed secrets with no grant
   * and whoever owns it.
   */
  const ownPlugin = (record: StoredRecord, reader: Principal | undefined): boolean =>
    reader?.plugin !== undefined && options.adapters()[String(record.adapter)]?.by === reader.plugin;

  /** The ids one record offers now: the toggle its state calls for, and Remove. */
  const offersOn = (state: ConnectorState): string[] => [state === 'disabled' ? 'enable' : 'disable', 'remove'];

  /**
   * One stored connector as a client is shown it: its record, its state, and
   * its alerts where it has some.
   */
  const connectorRow = (record: StoredRecord): Record<string, unknown> => {
    const held = alerts.get(record.id)?.list() ?? [];
    const shows = views.of(record.id);
    // A value its adapter marks `writeOnly` is never answered, a vault field's
    // reference aside.
    const adapter = options.adapters()[String(record.adapter)];
    const shown = adapter === undefined || record.config === undefined
      ? record
      : { ...record, config: writeOnlyHeld(adapter.schema, configOf(record)) };
    const state = stateOf(record);
    return {
      ...shown,
      state,
      operations: offersOn(state),
      ...(shows === undefined ? {} : { views: shows }),
      ...(held.length === 0 ? {} : { alerts: held }),
    };
  };

  /** The connector records the store holds, and the owner each names. */
  const stored = async (): Promise<StoredRecord[]> => {
    const records = await options.collection.list();
    const before = refsKey();
    owners.clear();
    known.clear();
    for (const one of records) {
      owners.set(one.id, asOwner(one.owner));
      known.set(one.id, refOf(one));
    }
    if (refsKey() !== before) options.onRefs?.();
    return records;
  };

  /** The fields an adapter's schema marks `x-ahpd-automation`: the ones that name an automation. */
  const automationFields = (schema: Record<string, unknown>): string[] =>
    Object.entries(bag(schema['properties']))
      .filter(([, one]) => isRecord(one) && one['x-ahpd-automation'] === true)
      .map(([field]) => field);

  /**
   * Refuse a config naming an automation this connector's owner may not read.
   *
   * Read off the adapter's schema rather than the config, so a field the
   * adapter marks and the client left out is no reference at all - the schema's
   * own rules say whether it was required.
   */
  const checkAutomationLinks = (adapter: ServedAdapter, config: Record<string, unknown>, owner: ConnectorOwner): void => {
    const lookup = options.automations;
    if (lookup === undefined) return;
    for (const field of automationFields(adapter.schema)) {
      const named = config[field];
      if (named === undefined || named === '') continue;
      if (typeof named !== 'string') {
        throw new RpcError(INVALID_PARAMS, `A connector's ${field} names an automation, so it is sent as its id`);
      }
      const found = lookup(named);
      if (found === undefined) {
        throw new RpcError(INVALID_PARAMS, `${field} names ${named}, and this host holds no such automation`);
      }
      if (!sameOwnerOrHost(owner, found.owner)) {
        throw new RpcError(INVALID_PARAMS, `${field} names ${named}, which belongs to ${found.owner ?? 'the host'}, so ${owner} may not start it`);
      }
    }
  };

  const source = {
    ids: async (): Promise<string[]> => (await stored()).map((one) => one.id).sort(),
    find: async (id: string): Promise<Record<string, unknown> | undefined> => {
      const record = await options.collection.get(id);
      owners.set(id, record === undefined ? undefined : asOwner(record.owner));
      return record === undefined ? undefined : connectorRow(record);
    },
  };

  /**
   * Whether this reader sees this row, asked of every reader.
   *
   * `connector:all` reads every connector. `connector:list` reads the ones the
   * caller owns, the ones their teams own and the host's. A reader holding
   * neither sees nothing, its own connector included.
   */
  const mayRead = (id: string, reader: Principal): boolean => {
    if (reader.can('connector:all' as Grant)) return true;
    if (!reader.can('connector:list' as Grant)) return false;
    const owner = owners.get(id);
    if (owner === undefined) return false;
    if (owner === 'host') return true;
    if (owner.startsWith('user:')) return reader.plugin === undefined && reader.id === owner.slice('user:'.length);
    return onTeam(reader, owner.slice('team:'.length));
  };

  const channel = recordsChannel(SCHEME, source, {
    /*
     * `connector:list` is the channel's own gate, because a person who may
     * make their own connector holds it. Every reader's rows go through
     * `mayRead`, the gate holder included, so `connector:list` reads its own,
     * its teams' and the host's and no one else's. `connector:all` reads every
     * row and is let in by `authorize` without `connector:list`.
     */
    grant: 'connector:list' as Grant,
    mayRead,
    mayReadEveryReader: true,
    alsoGrant: 'connector:all' as Grant,
    /*
     * A host connector belongs to everyone and to nobody, so the filter leaves
     * it out and `?owner=me` is the caller's own connectors.
     */
    ownerOf: (id, record) => {
      const owner = asOwner(record.owner);
      return owner === undefined || owner === 'host' ? undefined : owner;
    },
    describe: () => ({
      title: 'Connectors',
      description: 'The connectors made from the adapters this host serves.',
    }),
    onProblem: problem,
  });

  /** One check, or `unreachable` when it takes more than the limit to answer. */
  const within = async (check: Promise<CheckResult>): Promise<CheckResult> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<CheckResult>((done) => {
      timer = setTimeout(() => { done({ result: 'unreachable' }); }, CHECK_LIMIT_MS);
      timer.unref?.();
    });
    try {
      return await Promise.race([check, late]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  /**
   * Ask one open connector's adapter whether it works, and keep the answer.
   *
   * A connector that is not open, or whose adapter has no check, is asked
   * nothing and answers `undefined`. A check that throws is `failed` with its
   * message, and one that has not answered in ten seconds is `unreachable`.
   */
  const checkOne = async (id: string): Promise<CheckResult | undefined> => {
    const entry = open.get(id);
    if (entry === undefined) return undefined;
    const adapter = options.adapters()[entry.connector.adapter];
    if (adapter === undefined || typeof adapter.check !== 'function') return undefined;
    const check = adapter.check.bind(adapter);
    const result = await within(check(entry.connector)).catch((error: unknown): CheckResult => {
      const message = reason(error);
      return { result: 'failed', ...(message === '' ? {} : { message }) };
    });
    checks.set(id, result);
    openFailures.delete(id);
    noteCheck(id, result);
    return result;
  };

  /** A refresh queued from `note`, and when the last one went out. */
  let notedAt = 0;
  let noting: ReturnType<typeof setTimeout> | undefined;

  /** Send the rows `note` changed, at most once a second. */
  const scheduleNoteRefresh = (): void => {
    if (noting !== undefined) return;
    const wait = Math.max(0, notedAt + NOTE_REFRESH_MS - Date.now());
    noting = setTimeout(() => {
      noting = undefined;
      notedAt = Date.now();
      void channel.refresh().catch(() => {});
    }, wait);
    noting.unref?.();
  };

  /**
   * Keep one call's outcome as the connector's `call` alert.
   *
   * `run` records each action with it, and a host part records each call it
   * makes for a connector. A failed call raises a `warning` alert, and a call
   * that worked clears it. An error is cut to 500 characters so a row stays small.
   */
  const note = (id: string, outcome: { ok?: boolean; status?: number; error?: string }): void => {
    raiseCall(id, outcome);
    scheduleNoteRefresh();
  };

  /** Stop one open connector, if it is open. A close that fails is said and not thrown. */
  const close = async (id: string): Promise<void> => {
    const entry = open.get(id);
    open.delete(id);
    alerts.delete(id);
    checks.delete(id);
    openFailures.delete(id);
    views.drop(id);
    const stop = entry?.stop;
    if (stop === undefined) return;
    try {
      await stop();
    } catch (error) {
      problem(`${id} could not be closed: ${reason(error)}`);
    }
  };

  /** Open one stored connector through its adapter, and keep what stops it. */
  const openOne = async (adapter: ServedAdapter, record: StoredRecord, owner: ConnectorOwner): Promise<void> => {
    try {
      await openRecord(adapter, record, owner);
    } catch (error) {
      // The row lists why, as a failed check does, so a client shows it.
      raiseOpen(record.id, error);
      openFailures.add(record.id);
      throw error;
    }
    clearOpen(record.id);
  };

  /** Open one stored record with its adapter, in place of whatever was open under its id. */
  const openRecord = async (adapter: ServedAdapter, record: StoredRecord, owner: ConnectorOwner): Promise<void> => {
    const config = configOf(record);
    options.check(heldAgainst(config), adapter.schema, `connector ${record.id}`);
    const connector: Connector = {
      id: record.id,
      adapter: adapter.name,
      owner,
      ...(typeof record.title === 'string' ? { title: record.title } : {}),
      config: await resolvedRecord(config, owner, options.vault(), CONNECTOR_SECRETS),
    };
    await close(record.id);
    const view: ViewHandle = views.open({
      id: record.id,
      from: adapter.name,
      by: adapter.by,
      surfaces: adapter.capabilities.filter((one) => one.type === 'view').map((one) => one.name),
      methods: adapter.methods ?? {},
    });
    let stop: void | (() => void | Promise<void>);
    try {
      stop = adapter.open(connector, view);
    } catch (error) {
      // An adapter that did not open shows nothing: the handle it was handed goes.
      views.drop(record.id);
      throw error;
    }
    open.set(record.id, { connector, ...(stop === undefined ? {} : { stop }) });
  };

  /**
   * Run one action on one open connector, after the live checks.
   *
   * The order is the one a revoke or a remove changes: the connector has to be
   * open, the adapter has to declare the action and be able to run it, and the
   * reader has to pass `mayRead`. A message names the reason and never a
   * secret, because the adapter's answer and its config are the only things
   * that hold one. `note` keeps the outcome of each call, and a call that
   * throws is kept and thrown on.
   */
  const run = async (
    id: string,
    reader: Principal | undefined,
    action: string,
    input: Record<string, unknown>,
    call?: ActionCall,
  ): Promise<unknown> => {
    const entry = open.get(id);
    if (entry === undefined) throw new Error(`${id} is not an open connector`);
    const adapter = options.adapters()[entry.connector.adapter];
    if (adapter === undefined) throw new Error(`${entry.connector.adapter} is not an adapter this host serves`);
    if (typeof adapter.run !== 'function') throw new Error(`${adapter.name} runs no action`);
    if (!adapter.capabilities.some((one) => one.type === 'action' && one.name === action)) {
      throw new Error(`${adapter.name} has no action named ${action}`);
    }
    if (reader !== undefined && !mayRead(id, reader)) {
      throw new Error(`${id} is not ${reader.id}'s to use`);
    }
    try {
      const answer = await adapter.run(entry.connector, action, input, call);
      note(id, { ok: true });
      return answer;
    } catch (error) {
      note(id, { ok: false, error: reason(error) });
      throw error;
    }
  };

  /** A string param that names one connector, or a refusal saying what the command needs. */
  const idParam = (command: string, params: Record<string, unknown>): string => {
    const id = params.id;
    if (typeof id !== 'string' || !isRecordSlug(id)) {
      throw new RpcError(INVALID_PARAMS, `${command} needs id, the connector's id, a slug such as ci-deploys`);
    }
    return id;
  };

  /** One value of 32 random bytes, as base64url: a PKCE verifier and a state. */
  const random = (): string => randomBytes(32).toString('base64url');

  /** The S256 challenge of one verifier. */
  const challengeOf = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

  /**
   * The status an exchange refused with, when its message is that alone.
   *
   * An adapter's error may carry anything, so only a message that is exactly
   * `HTTP <status>` is shown to the caller. The vendor's body, the code and the
   * verifier never reach a refusal.
   */
  const statusOf = (error: unknown): string | undefined => {
    const message = reason(error).trim();
    return /^HTTP \d{3}$/u.test(message) ? message : undefined;
  };

  /**
   * Run one exchange, answering its key, and refuse when it takes too long.
   *
   * The adapter's own call may have no time limit of its own, so this is the
   * ten seconds a person waits. The marker resolves rather than rejects, so a
   * call that answers first leaves no unhandled rejection behind.
   */
  const LATE = Symbol('the exchange did not answer');
  const exchangeWithin = async (work: Promise<string>): Promise<string> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<typeof LATE>((done) => {
      timer = setTimeout(() => { done(LATE); }, EXCHANGE_LIMIT_MS);
      timer.unref?.();
    });
    try {
      const answer = await Promise.race([work, late]);
      if (answer === LATE) throw new Error('the exchange did not answer');
      return answer;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  /**
   * The owner checks a put, a sign-in start and a sign-in finish all ask.
   *
   * An id that is taken is its owner's: a put that names another owner takes it
   * from them, which is a remove for the owner it leaves. A record naming no
   * scope was written by hand, and takes `connector:remove`, as its remove does.
   */
  const ownerChecks = async (
    id: string,
    owner: ConnectorOwner,
    reader: Principal | undefined,
  ): Promise<{ before: StoredRecord | undefined; was: ConnectorOwner | undefined }> => {
    refuseOwner('connector', 'make', owner, reader, 'put');
    const before = await options.collection.get(id);
    const was = before === undefined ? undefined : asOwner(before.owner);
    const moving = before !== undefined && was !== owner;
    if (moving && was !== undefined) refuseOwner('connector', 'take', was, reader, 'remove');
    if (moving && was === undefined && reader !== undefined && !reader.can('connector:remove' as Grant)) {
      throw new RpcError(DENIED, `${id} is not ${reader.id}'s to take`);
    }
    return { before, was };
  };

  /**
   * Everything a put checks before the record is written.
   *
   * `filled` names the fields a sign-in is about to fill. The rules are asked
   * of what a person filled in, and those fields are held as `HELD`, because
   * the exchange or the device flow answers them and never the client.
   */
  const prepare = async (
    params: Record<string, unknown>,
    reader: Principal | undefined,
    asked: { command: string; filled?: string | readonly string[] },
  ): Promise<Prepared> => {
    const id = idParam(asked.command, params);
    // An edit is not a toggle: the record keeps the `enabled` it has, and a
    // client turns it off or on through the commands that say so.
    if (params.enabled !== undefined) {
      throw new RpcError(INVALID_PARAMS, `${asked.command} does not take enabled; use ${ENABLE} or ${DISABLE}`);
    }
    const adapterName = params.adapter;
    if (typeof adapterName !== 'string' || adapterName === '') {
      throw new RpcError(INVALID_PARAMS, `${asked.command} needs adapter, the name of an adapter`);
    }
    const adapter = options.adapters()[adapterName];
    if (adapter === undefined) {
      throw new RpcError(INVALID_PARAMS, `${adapterName} is not an adapter this host serves`);
    }
    const owner = asOwner(params.owner);
    if (owner === undefined) {
      throw new RpcError(INVALID_PARAMS, `${asked.command} needs owner, one of host, team:<team> or user:<id>`);
    }
    const config = params.config ?? {};
    if (!isRecord(config)) {
      throw new RpcError(INVALID_PARAMS, "A connector's config is a JSON object, and that is not one");
    }
    const title = params.title;
    if (title !== undefined && typeof title !== 'string') {
      throw new RpcError(INVALID_PARAMS, `${asked.command} takes title as a string`);
    }
    const { before, was } = await ownerChecks(id, owner, reader);
    // Nothing of an old owner's is kept, so nothing of it is read either.
    const kept = before !== undefined && was === owner ? configOf(before) : {};
    /*
     * What the client sent, with a secret it kept stood in for by `HELD`: the
     * rules are asked of what a person filled in, and an empty field that
     * keeps a secret is not refused for being empty.
     */
    const filled = asked.filled === undefined
      ? []
      : typeof asked.filled === 'string' ? [asked.filled] : [...asked.filled];
    const checked: Record<string, unknown> = { ...config };
    for (const field of secretFields(adapter.schema)) {
      if (filled.includes(field)) {
        checked[field] = HELD;
        continue;
      }
      if (checked[field] === '' && secretRef(kept[field]) !== undefined) checked[field] = HELD;
      if (fromEnvRef(checked[field]) !== undefined) checked[field] = HELD;
    }
    // A device flow fills a plain field too, such as the account, which a
    // client leaves out for the same reason.
    for (const field of filled) {
      if (checked[field] === undefined) checked[field] = HELD;
    }
    try {
      options.check(checked, adapter.schema, `connector ${id}`);
    } catch (error) {
      throw new RpcError(INVALID_PARAMS, reason(error));
    }
    checkAutomationLinks(adapter, config, owner);
    return { id, adapter, owner, title, config, before, was, kept };
  };

  /**
   * Write one connector, open it and wait for its check: what a put does.
   *
   * A sign-in finishes through here too, with the key its exchange answered in
   * the field the adapter named, so a connector a person signed in to is
   * checked and opened exactly as one a person typed.
   */
  const putOne = async (
    params: Record<string, unknown>,
    reader: Principal | undefined,
  ): Promise<Record<string, unknown>> => {
    const ready = await prepare(params, reader, { command: PUT });
    const { id, adapter, owner, title, config, before, was, kept } = ready;
    const moving = before !== undefined && was !== owner;
    const moved = await moveRecordSecrets({
      rules: CONNECTOR_SECRETS,
      fields: secretFields(adapter.schema),
      config,
      held: kept,
      owner,
      id,
      vault: options.vault(),
      problem,
    });
    const record: StoredRecord = {
      id,
      adapter: adapter.name,
      owner,
      ...(title === undefined ? {} : { title }),
      config: moved,
      // An edit keeps the switch where it was, as an agent's put does.
      ...(before?.enabled === undefined ? {} : { enabled: before.enabled }),
    };
    await close(id);
    await options.collection.put(record);
    owners.set(id, owner);
    const refsBefore = refsKey();
    known.set(id, refOf(record));
    if (refsKey() !== refsBefore) options.onRefs?.();
    // The secrets kept under the owner it left are no record's any more.
    if (moving && was !== undefined && before !== undefined) {
      await forgetRecordSecrets(configOf(before), was, id, CONNECTOR_SECRETS, options.vault(), problem);
    }
    // A record that is off is not opened or checked: it stays stored for the
    // switch, and nothing of it reaches its adapter.
    if (record.enabled === false) {
      await channel.refresh();
      return connectorRow(record);
    }
    try {
      await openOne(adapter, record, owner);
      // A put is where a person learns the key is wrong, so it waits for the check.
      await checkOne(id);
    } catch (error) {
      await channel.refresh();
      throw new RpcError(INTERNAL_ERROR, `${id} is stored, but ${adapter.name} could not open it: ${reason(error)}`);
    }
    await channel.refresh();
    return connectorRow(record);
  };

  const put: PluginMethod = {
    grant: 'connector:put' as Grant,
    describe: () => ({ title: 'Make a connector', description: 'Makes or changes one connector, and opens it.' }),
    authorize: async (params, reader) => ownerAllows('connector', asOwner(params.owner), reader, 'put'),
    handle: async (params, reader) => putOne(params, reader),
  };

  /** A positive number of seconds an adapter answered, or nothing when it is not one. */
  const secondsOf = (value: unknown): number | undefined =>
    (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined);

  /** The refusal a sign-in answers with: the vendor's status alone, or its title. */
  const refusalOf = (signIn: { title: string }, error: unknown): RpcError => {
    const status = statusOf(error);
    return new RpcError(INTERNAL_ERROR, status === undefined
      ? `${signIn.title} did not finish the sign-in`
      : `${signIn.title} answered ${status}`);
  };

  /** Tell the finishes waiting on one device sign-in its outcome, once. */
  const settleDevice = (device: StartedDevice, outcome: DeviceOutcome): void => {
    if (device.outcome !== undefined) return;
    device.outcome = outcome;
    for (const done of device.waiting.splice(0)) done(outcome);
  };

  /** The outcome a sign-in answers once its code has expired. */
  const expiredOutcome = (): DeviceOutcome => ({
    ok: false,
    error: new RpcError(INVALID_PARAMS, 'This sign-in has expired; start it again'),
  });

  /** Stop one started sign-in's poll and forget it, telling a finish that waits. */
  const dropStarted = (state: string, outcome?: DeviceOutcome): void => {
    const entry = started.get(state);
    if (entry === undefined) return;
    // The values arrived and are being written: the put's own result settles
    // this entry, so an expiry or a full table does not answer in its place.
    if (entry.device?.finishing === true) return;
    started.delete(state);
    const device = entry.device;
    if (device === undefined) return;
    if (device.timer !== undefined) {
      clearTimeout(device.timer);
      device.timer = undefined;
    }
    settleDevice(device, outcome ?? {
      ok: false,
      error: new RpcError(INVALID_PARAMS, 'This host has no such sign-in, or it has already finished'),
    });
  };

  /**
   * Settle one device sign-in on its one outcome.
   *
   * The poll stops, and the row or the error is kept until the expiry, so a
   * finish that comes after the poll still answers it. At the expiry the entry
   * is forgotten, after every waiter has been told.
   */
  const endDevice = (state: string, entry: StartedSignIn, outcome: DeviceOutcome): void => {
    const device = entry.device;
    if (device === undefined || device.outcome !== undefined) return;
    if (device.timer !== undefined) {
      clearTimeout(device.timer);
      device.timer = undefined;
    }
    settleDevice(device, outcome);
    const left = entry.expires - Date.now();
    if (left <= 0) {
      started.delete(state);
      return;
    }
    device.timer = setTimeout(() => { started.delete(state); }, left);
    device.timer.unref?.();
  };

  /** Schedule one poll, no later than the code's expiry. */
  const scheduleDevice = (state: string, entry: StartedSignIn, waitMs: number): void => {
    const device = entry.device;
    if (device === undefined || device.outcome !== undefined) return;
    if (device.timer !== undefined) clearTimeout(device.timer);
    const left = Math.max(0, entry.expires - Date.now());
    device.timer = setTimeout(() => { void pollDevice(state, entry); }, Math.min(waitMs, left));
    device.timer.unref?.();
  };

  /** Run the put with the values a device sign-in answered, and settle on it. */
  const finishDevice = async (state: string, entry: StartedSignIn, values: Record<string, string>): Promise<void> => {
    const device = entry.device;
    if (device === undefined || device.outcome !== undefined) return;
    const signIn = device.signIn;
    // An expiry may not answer in the put's place while it is writing.
    device.finishing = true;
    try {
      const id = String(entry.params['id']);
      const owner = asOwner(entry.params['owner']);
      if (owner === undefined) throw new RpcError(INVALID_PARAMS, `${SIGNIN_FINISH} holds a sign-in with no owner`);
      // The grant and the owner are asked again, as the pasted-code finish asks
      // them, and with the reader that started the sign-in: the poll runs with
      // no caller of its own.
      const { before, was } = await ownerChecks(id, owner, entry.reader);
      if (signIn.account !== undefined) {
        const now = values[signIn.account];
        const then = before !== undefined && was === owner ? bag(configOf(before))[signIn.account] : undefined;
        if (typeof now === 'string' && typeof then === 'string' && now !== then && signIn.switchAccount !== true) {
          throw new RpcError(INVALID_PARAMS, `signed in as ${now}, this connector is ${then}`);
        }
      }
      const config = { ...bag(entry.params['config']), ...bag(values) };
      const row = await putOne({ ...entry.params, config }, entry.reader);
      endDevice(state, entry, { ok: true, row });
    } catch (error) {
      endDevice(state, entry, {
        ok: false,
        error: error instanceof RpcError ? error : new RpcError(INTERNAL_ERROR, reason(error)),
      });
    }
  };

  /** Ask one device sign-in's adapter once, and schedule the next ask. */
  const pollDevice = async (state: string, entry: StartedSignIn): Promise<void> => {
    const device = entry.device;
    if (device === undefined || device.outcome !== undefined) return;
    device.timer = undefined;
    if (Date.now() >= entry.expires) {
      dropStarted(state, expiredOutcome());
      return;
    }
    let answer: DeviceSignInPoll;
    try {
      answer = await device.signIn.poll(device.handle);
    } catch (error) {
      endDevice(state, entry, { ok: false, error: refusalOf(device.signIn, error) });
      return;
    }
    // The entry may have been dropped or settled while the adapter was answering.
    if (started.get(state) !== entry || device.outcome !== undefined) return;
    if ('values' in answer) {
      await finishDevice(state, entry, bag(answer.values) as Record<string, string>);
      return;
    }
    const wait = secondsOf(answer.wait);
    if (wait === undefined) {
      endDevice(state, entry, {
        ok: false,
        error: new RpcError(INTERNAL_ERROR, `${device.signIn.title} answered no wait`),
      });
      return;
    }
    scheduleDevice(state, entry, wait * 1000);
  };

  /**
   * Wait for one device sign-in's outcome, which the poll settles.
   *
   * The wait never outlives the code: its own timer answers the expiry, so a
   * vendor's poll that never returns still leaves the caller an answer.
   */
  const waitForDevice = async (state: string, entry: StartedSignIn): Promise<DeviceOutcome> => {
    const device = entry.device;
    if (device === undefined) {
      return { ok: false, error: new RpcError(INVALID_PARAMS, 'This host has no such sign-in, or it has already finished') };
    }
    if (device.outcome !== undefined) return device.outcome;
    const left = Math.max(0, entry.expires - Date.now());
    return await new Promise<DeviceOutcome>((done) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (outcome: DeviceOutcome): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        done(outcome);
      };
      device.waiting.push(settle);
      timer = setTimeout(() => {
        timer = undefined;
        // While the values are being written, that put answers this wait.
        if (device.finishing !== true) dropStarted(state, expiredOutcome());
      }, left);
      timer.unref?.();
    });
  };

  /**
   * Drop the expired sign-ins, and the oldest of one caller's when they hold
   * ten, before another one takes its place.
   */
  const makeRoom = (caller: Owner | undefined): number => {
    const now = Date.now();
    for (const [key, one] of started) if (one.expires <= now) dropStarted(key);
    let mine = 0;
    for (const one of started.values()) if (one.caller === caller) mine += 1;
    if (mine >= SIGNIN_KEPT) {
      // A map keeps insertion order, so the oldest of this caller's goes.
      for (const [key, one] of started) {
        if (one.caller !== caller) continue;
        dropStarted(key);
        break;
      }
    }
    return now;
  };

  /** Start one device-code sign-in, and answer what a client shows. */
  const startDevice = async (
    adapterName: string,
    adapter: ServedAdapter,
    signIn: DeviceSignIn,
    params: Record<string, unknown>,
    reader: Principal | undefined,
    caller: Owner | undefined,
  ): Promise<Record<string, unknown>> => {
    // A plugin's adapter is checked when it registers, and a host adapter is
    // not: a field the schema does not keep would leave the key in the record.
    const secrets = secretFields(adapter.schema);
    if (!secrets.includes(signIn.field)) {
      throw new RpcError(INVALID_PARAMS, `${adapterName} signs in to a field its schema does not keep`);
    }
    // The device flow fills every secret, and the account field besides, so
    // none of them is a client's to send.
    const filled = signIn.account === undefined ? secrets : [...secrets, signIn.account];
    const ready = await prepare(params, reader, { command: SIGNIN, filled });
    let first;
    try {
      first = await signIn.start();
    } catch (error) {
      throw refusalOf(signIn, error);
    }
    const expires = secondsOf(first.expires);
    const interval = secondsOf(first.interval);
    if (typeof first.code !== 'string' || first.code === '' || typeof first.url !== 'string' || first.url === '') {
      throw new RpcError(INTERNAL_ERROR, `${signIn.title} answered no code`);
    }
    if (typeof first.handle !== 'string' || first.handle === '') {
      throw new RpcError(INTERNAL_ERROR, `${signIn.title} answered no handle`);
    }
    if (expires === undefined) throw new RpcError(INTERNAL_ERROR, `${signIn.title} answered no expiry`);
    if (interval === undefined) throw new RpcError(INTERNAL_ERROR, `${signIn.title} answered no interval`);
    const now = makeRoom(caller);
    const state = random();
    const config = { ...ready.config };
    // Only the device flow may fill these, so nothing a client sent is kept.
    for (const field of filled) delete config[field];
    const entry: StartedSignIn = {
      flow: 'device',
      verifier: '',
      params: {
        id: ready.id,
        adapter: adapterName,
        owner: ready.owner,
        ...(ready.title === undefined ? {} : { title: ready.title }),
        config,
      },
      caller,
      reader,
      expires: now + expires * 1000,
      device: {
        signIn,
        handle: first.handle,
        timer: undefined,
        waiting: [],
        outcome: undefined,
      },
    };
    started.set(state, entry);
    scheduleDevice(state, entry, interval * 1000);
    return { state, code: first.code, url: first.url, expires };
  };

  /*
   * A sign-in start is a put that names an adapter with a `signIn`, and it
   * checks everything a put checks except the fields the sign-in fills. What it
   * keeps is the id, the owner and the config: the grant and the owner are
   * asked again when the code comes back, because the sign-in lasts long
   * enough for both to change.
   *
   * A device sign-in starts the vendor's flow and polls it here, so it needs no
   * code from the caller and no caller to stay connected.
   */
  const signin: PluginMethod = {
    grant: 'connector:put' as Grant,
    describe: () => ({ title: 'Start a sign-in', description: 'Starts a sign-in for an adapter, and answers the URL a person opens.' }),
    authorize: async (params, reader) => ownerAllows('connector', asOwner(params.owner), reader, 'put'),
    handle: async (params, reader, _client, caller) => {
      const adapterName = params.adapter;
      if (typeof adapterName !== 'string' || adapterName === '') {
        throw new RpcError(INVALID_PARAMS, `${SIGNIN} needs adapter, the name of an adapter`);
      }
      const adapter = options.adapters()[adapterName];
      if (adapter === undefined) {
        throw new RpcError(INVALID_PARAMS, `${adapterName} is not an adapter this host serves`);
      }
      const signIn = adapter.signIn;
      if (signIn === undefined) {
        throw new RpcError(INVALID_PARAMS, `${adapterName} has no sign-in`);
      }
      if (signIn.flow === 'device') {
        return await startDevice(adapterName, adapter, signIn, params, reader, caller);
      }
      // A plugin's adapter is checked when it registers, and a host adapter is
      // not: a field the schema does not keep would leave the key in the record.
      if (!secretFields(adapter.schema).includes(signIn.field)) {
        throw new RpcError(INVALID_PARAMS, `${adapterName} signs in to a field its schema does not keep`);
      }
      const ready = await prepare(params, reader, { command: SIGNIN, filled: signIn.field });
      // An expired state is gone before a new one takes its place, so the map
      // holds no more than the sign-ins somebody may still finish.
      const now = makeRoom(caller);
      const verifier = random();
      const state = random();
      const url = signIn.url(challengeOf(verifier), state);
      const config = { ...ready.config };
      // Only the exchange may fill the field, so nothing a client sent is kept.
      delete config[signIn.field];
      started.set(state, {
        flow: 'code',
        verifier,
        params: {
          id: ready.id,
          adapter: adapterName,
          owner: ready.owner,
          ...(ready.title === undefined ? {} : { title: ready.title }),
          config,
        },
        caller,
        reader,
        expires: now + SIGNIN_LIMIT_MS,
      });
      return { url, state };
    },
  };

  /*
   * The finish takes the state and, for the pasted code, the code. The state is
   * used once, and only by the caller who started it; the put's owner checks
   * are asked again before the exchange, because a grant may be gone by now.
   *
   * A device sign-in's finish takes the state alone: the host has been polling
   * since the start, so there is no code to exchange, and the call waits for
   * the approval, a refusal or the expiry. A later finish answers the same
   * settled outcome, until the code expires.
   */
  const signinFinish: PluginMethod = {
    grant: 'connector:put' as Grant,
    describe: () => ({ title: 'Finish a sign-in', description: 'Exchanges the pasted code for the key, and makes the connector.' }),
    handle: async (params, reader, _client, caller) => {
      const state = params.state;
      if (typeof state !== 'string' || state === '') {
        throw new RpcError(INVALID_PARAMS, `${SIGNIN_FINISH} needs state, the value the start answered`);
      }
      const entry = started.get(state);
      if (entry === undefined) {
        throw new RpcError(INVALID_PARAMS, 'This host has no such sign-in, or it has already finished');
      }
      // An entry whose values are being written settles on that put instead.
      if (entry.expires <= Date.now() && entry.device?.finishing !== true) {
        dropStarted(state);
        throw new RpcError(INVALID_PARAMS, 'This sign-in has expired; start it again');
      }
      /*
       * A state is its starter's. A caller it is not gets nothing, and the
       * state stays: a stranger may not burn a sign-in somebody else started.
       */
      if (entry.caller !== caller) {
        throw new RpcError(DENIED, 'This sign-in is not yours to finish');
      }
      if (entry.flow === 'device') {
        // The device flow takes no code, and a client that sends one is told so.
        if (typeof params.code === 'string' && params.code !== '') {
          throw new RpcError(INVALID_PARAMS, `${SIGNIN_FINISH} takes state alone for a device sign-in`);
        }
        const outcome = await waitForDevice(state, entry);
        if (!outcome.ok) throw outcome.error;
        return outcome.row;
      }
      const code = params.code;
      if (typeof code !== 'string' || code === '') {
        throw new RpcError(INVALID_PARAMS, `${SIGNIN_FINISH} needs code, the code the provider showed`);
      }
      // From here the state is used once, even when the exchange refuses.
      dropStarted(state);
      const adapterName = String(entry.params['adapter']);
      const adapter = options.adapters()[adapterName];
      const signIn = adapter?.signIn;
      if (signIn === undefined || signIn.flow === 'device') {
        throw new RpcError(INVALID_PARAMS, `${adapterName} has no sign-in`);
      }
      const id = String(entry.params['id']);
      const owner = asOwner(entry.params['owner']);
      if (owner === undefined) {
        throw new RpcError(INVALID_PARAMS, `${SIGNIN_FINISH} holds a sign-in with no owner`);
      }
      await ownerChecks(id, owner, reader);
      let key: string;
      try {
        key = await exchangeWithin(signIn.exchange(code, entry.verifier));
      } catch (error) {
        const status = statusOf(error);
        throw new RpcError(INTERNAL_ERROR, status === undefined
          ? `${signIn.title} did not finish the sign-in`
          : `${signIn.title} answered ${status}`);
      }
      if (typeof key !== 'string' || key === '') {
        throw new RpcError(INTERNAL_ERROR, `${signIn.title} answered no key`);
      }
      const config = { ...bag(entry.params['config']), [signIn.field]: key };
      return await putOne({ ...entry.params, config }, reader);
    },
  };

  /** Close one connector, forget its secrets and take its record out. */
  const removeOne = async (params: Record<string, unknown>, reader: Principal | undefined): Promise<unknown> => {
    const id = idParam(REMOVE, params);
    const before = await options.collection.get(id);
    if (before === undefined) throw new RpcError(INVALID_PARAMS, `${SCHEME} holds no ${id}`);
    const owner = asOwner(before.owner);
    /*
     * A record naming no scope is one written by hand, and only a caller the
     * gate let through with `connector:remove` reaches it; a record that
     * names one is the owner's, and the gate's grant does not widen that.
     */
    if (owner !== undefined) refuseOwner('connector', 'remove', owner, reader, 'remove');
    await close(id);
    await forgetRecordSecrets(configOf(before), owner, id, CONNECTOR_SECRETS, options.vault(), problem);
    await options.collection.remove(id);
    owners.delete(id);
    known.delete(id);
    options.onRefs?.();
    await channel.refresh();
    return {};
  };

  const remove: PluginMethod = {
    grant: 'connector:remove' as Grant,
    describe: () => ({ title: 'Remove a connector', description: 'Closes one connector and takes it out.' }),
    authorize: async (params, reader) => {
      const id = params.id;
      if (typeof id !== 'string') return false;
      const before = await options.collection.get(id);
      return before !== undefined && ownerAllows('connector', asOwner(before.owner), reader, 'remove');
    },
    handle: (params, reader) => removeOne(params, reader),
  };

  /*
   * The check command takes what a put takes: who may change a connector may
   * test it. The owner's rule is asked here, as a put asks it, because a grant
   * that reads the channel says nothing about another person's connector. The
   * plugin of the connector's adapter asks with no grant, as `ownPlugin` says.
   */
  const check: PluginMethod = {
    grant: 'connector:put' as Grant,
    describe: () => ({ title: 'Check a connector', description: 'Runs one open connector\'s own check, and answers the row.' }),
    authorize: async (params, reader) => {
      const id = params.id;
      if (typeof id !== 'string') return false;
      const before = await options.collection.get(id);
      return before !== undefined && (ownPlugin(before, reader) || ownerAllows('connector', asOwner(before.owner), reader, 'put'));
    },
    handle: async (params, reader) => {
      const id = idParam(CHECK, params);
      const before = await options.collection.get(id);
      if (before === undefined) throw new RpcError(INVALID_PARAMS, `${SCHEME} holds no ${id}`);
      const owner = asOwner(before.owner);
      if (owner !== undefined && !ownPlugin(before, reader)) refuseOwner('connector', 'check', owner, reader, 'put');
      const entry = open.get(id);
      if (entry === undefined) throw new RpcError(INVALID_PARAMS, `${id} is not an open connector`);
      const adapter = options.adapters()[entry.connector.adapter];
      if (adapter === undefined || typeof adapter.check !== 'function') {
        throw new RpcError(INVALID_PARAMS, `${entry.connector.adapter} has no check`);
      }
      await checkOne(id);
      await channel.refresh();
      return connectorRow(before);
    },
  };

  /*
   * The note command keeps one call's outcome, as `note` keeps a host part's.
   *
   * Only the plugin whose adapter the connector is notes: it is the one that
   * makes the connector's calls outside `run`, as the model proxy makes a
   * provider's. A reader of nothing is the daemon itself. That plugin needs no
   * grant, as for a check and a secret.
   */
  const noteCall: PluginMethod = {
    grant: 'connector:put' as Grant,
    describe: () => ({ title: 'Note a call', description: 'Keeps one call\'s outcome as an open connector\'s call alert, for the plugin whose adapter it is.' }),
    authorize: async (params, reader) => {
      const id = params.id;
      if (typeof id !== 'string') return false;
      const before = await options.collection.get(id);
      return before !== undefined && (ownPlugin(before, reader) || ownerAllows('connector', asOwner(before.owner), reader, 'put'));
    },
    handle: async (params, reader) => {
      const id = idParam(NOTE, params);
      const { ok, status, error } = params;
      if (ok === undefined) {
        throw new RpcError(INVALID_PARAMS, `${NOTE} needs ok, whether the call worked`);
      }
      if (typeof ok !== 'boolean') throw new RpcError(INVALID_PARAMS, `${NOTE} takes ok as whether the call worked, true or false`);
      if (status !== undefined && !Number.isInteger(status)) {
        throw new RpcError(INVALID_PARAMS, `${NOTE} takes status as the status the service answered, a whole number`);
      }
      if (error !== undefined && typeof error !== 'string') {
        throw new RpcError(INVALID_PARAMS, `${NOTE} takes error as what went wrong, a string`);
      }
      const before = await options.collection.get(id);
      if (before === undefined) throw new RpcError(INVALID_PARAMS, `${SCHEME} holds no ${id}`);
      const owner = asOwner(before.owner);
      if (owner !== undefined && !ownPlugin(before, reader)) refuseOwner('connector', 'note', owner, reader, 'put');
      const entry = open.get(id);
      if (entry === undefined) throw new RpcError(INVALID_PARAMS, `${id} is not an open connector`);
      const by = options.adapters()[entry.connector.adapter]?.by;
      if (reader !== undefined && (by === undefined || reader.plugin !== by)) {
        throw new RpcError(DENIED, `${id}'s calls are noted by the plugin of ${entry.connector.adapter}, not ${reader.id}`);
      }
      note(id, {
        ok,
        ...(status === undefined ? {} : { status: status as number }),
        ...(error === undefined ? {} : { error: error as string }),
      });
      return connectorRow(before);
    },
  };

  /*
   * The secret command replaces the secret fields a plugin refreshed for one
   * open connector, as a rotating vendor token does.
   *
   * Only the plugin whose adapter the connector is sends it, as only that
   * plugin notes: the plugin already holds the new value, and no caller should
   * be able to write a secret its adapter was never handed. The connector is
   * not closed and reopened, because the plugin has the value already. The
   * record is written only when a field does not point at its vault name yet.
   */
  const secretCall: PluginMethod = {
    grant: 'connector:put' as Grant,
    describe: () => ({ title: 'Keep a refreshed secret', description: 'Writes the secret fields a plugin refreshed to the vault of an open connector.' }),
    authorize: async (params, reader) => {
      const id = params.id;
      if (typeof id !== 'string') return false;
      const before = await options.collection.get(id);
      return before !== undefined && (ownPlugin(before, reader) || ownerAllows('connector', asOwner(before.owner), reader, 'put'));
    },
    handle: async (params, reader) => {
      const id = idParam(SECRET, params);
      const values = params.values;
      if (!isRecord(values) || Object.keys(values).length === 0) {
        throw new RpcError(INVALID_PARAMS, `${SECRET} needs values, the secret fields the plugin refreshed`);
      }
      for (const [field, value] of Object.entries(values)) {
        // The value is a secret, so the message names only the field.
        if (typeof value !== 'string' || value === '') {
          throw new RpcError(INVALID_PARAMS, `${SECRET} takes ${field} as a non-empty string`);
        }
      }
      const before = await options.collection.get(id);
      if (before === undefined) throw new RpcError(INVALID_PARAMS, `${SCHEME} holds no ${id}`);
      const owner = asOwner(before.owner);
      if (owner !== undefined && !ownPlugin(before, reader)) refuseOwner('connector', 'secret', owner, reader, 'put');
      const entry = open.get(id);
      if (entry === undefined) throw new RpcError(INVALID_PARAMS, `${id} is not an open connector`);
      const adapter = options.adapters()[entry.connector.adapter];
      if (reader !== undefined && (adapter === undefined || reader.plugin !== adapter.by)) {
        throw new RpcError(DENIED, `${id}'s secrets are written by the plugin of ${entry.connector.adapter}, not ${reader.id}`);
      }
      if (adapter === undefined) throw new RpcError(INVALID_PARAMS, `${id} names an adapter this host does not serve`);
      const fields = secretFields(adapter.schema);
      for (const field of Object.keys(values)) {
        if (!fields.includes(field)) {
          throw new RpcError(INVALID_PARAMS, `${SECRET} takes ${field} as a field the schema marks secret`);
        }
      }
      const vault = options.vault();
      if (vault === undefined) {
        throw new RpcError(INTERNAL_ERROR, 'This host has no vault, so a secret cannot be kept');
      }
      const config = { ...configOf(before) };
      let changed = false;
      for (const [field, value] of Object.entries(values) as [string, string][]) {
        const name = secretNameOf(CONNECTOR_SECRETS.subject, entry.connector.owner, id, field);
        try {
          scopeOf(name);
        } catch (error) {
          throw new RpcError(INVALID_PARAMS, reason(error));
        }
        await vault.set(name, value);
        if (secretRef(config[field]) !== name) {
          config[field] = { $secret: name };
          changed = true;
        }
      }
      const after: StoredRecord = changed ? { ...before, config } : before;
      if (changed) {
        await options.collection.put(after);
        await channel.refresh();
      }
      return connectorRow(after);
    },
  };

  /** Every open connector whose adapter serves models, as `providers` answers them. */
  const providers = (): ProviderConnector[] => {
    const adapters = options.adapters();
    const listed: ProviderConnector[] = [];
    for (const [id, entry] of open) {
      const adapter = adapters[entry.connector.adapter];
      if (adapter === undefined || typeof adapter.provider !== 'function') continue;
      try {
        /*
         * The list is read here, bound to this open connector, so the caller
         * gets the models and never the resolved config or the key.
         */
        const read = adapter.models;
        listed.push({
          id,
          adapter: adapter.name,
          owner: entry.connector.owner,
          provider: adapter.provider(entry.connector),
          ...(typeof read === 'function' ? { models: () => read(entry.connector) } : {}),
        });
      } catch (error) {
        const line = `${id} serves no model: ${reason(error)}`;
        if (providerProblems.has(line)) continue;
        providerProblems.add(line);
        problem(line);
      }
    }
    return listed.sort((one, two) => one.id.localeCompare(two.id));
  };

  /*
   * The owner is read fresh before the reader check, as `check` reads it, so a
   * connector made since the last listing is not refused for want of one.
   */
  const models: PluginMethod = {
    grant: 'connector:all' as Grant,
    describe: () => ({ title: 'List a connector\'s models', description: 'Answers the models one open provider connector serves, and which of them the caller may call.' }),
    authorize: async (params, reader) => {
      const id = params.id;
      if (typeof id !== 'string') return false;
      const before = await options.collection.get(id);
      if (before === undefined) return false;
      owners.set(id, asOwner(before.owner));
      return mayRead(id, reader);
    },
    handle: async (params, reader) => {
      const id = idParam(MODELS, params);
      const read = options.models;
      if (read === undefined) throw new RpcError(INVALID_PARAMS, `this host lists no connector's models`);
      const before = await options.collection.get(id);
      if (before === undefined) throw new RpcError(INVALID_PARAMS, `${SCHEME} holds no ${id}`);
      owners.set(id, asOwner(before.owner));
      if (reader !== undefined && !mayRead(id, reader)) throw new RpcError(DENIED, `${id} is not ${reader.id}'s to read`);
      if (!open.has(id)) throw new RpcError(INVALID_PARAMS, `${id} is not an open connector`);
      const connector = providers().find((one) => one.id === id);
      if (connector === undefined) throw new RpcError(INVALID_PARAMS, `${id} serves no models`);
      if (connector.models === undefined) throw new RpcError(INVALID_PARAMS, `${connector.adapter} lists no models`);
      return read(connector, reader);
    },
  };

  /**
   * Turn one connector off or on, as a tunnel is turned off or on.
   *
   * Off closes the connector before the record says so, so its adapter hears
   * the stop and the row says `disabled` with nothing to fix. On writes
   * `enabled: true` and opens and checks the connector as a put does, so the
   * person who turned it on learns there whether it answers. Every other field
   * is kept, and the answer is the row.
   */
  const toggleOne = async (
    command: string,
    enabled: boolean,
    params: Record<string, unknown>,
    reader: Principal | undefined,
  ): Promise<unknown> => {
    const id = idParam(command, params);
    const before = await options.collection.get(id);
    if (before === undefined) throw new RpcError(INVALID_PARAMS, `${SCHEME} holds no ${id}`);
    const owner = asOwner(before.owner);
    if (owner !== undefined) refuseOwner('connector', enabled ? 'enable' : 'disable', owner, reader, 'put');
    if (!enabled) {
      await close(id);
      const record: StoredRecord = { ...before, enabled: false };
      await options.collection.put(record);
      await channel.refresh();
      return connectorRow(record);
    }
    if (owner === undefined) throw new RpcError(INVALID_PARAMS, `${id} names no owner, so it cannot be opened`);
    const adapter = options.adapters()[String(before.adapter)];
    if (adapter === undefined) throw new RpcError(INVALID_PARAMS, `${String(before.adapter)} is not an adapter this host serves`);
    const record: StoredRecord = { ...before, enabled: true };
    await options.collection.put(record);
    try {
      await openOne(adapter, record, owner);
      await checkOne(id);
    } catch (error) {
      await channel.refresh();
      throw new RpcError(INTERNAL_ERROR, `${id} is on, but ${adapter.name} could not open it: ${reason(error)}`);
    }
    await channel.refresh();
    return connectorRow(record);
  };

  /** One toggle as a method: who may change a connector may turn it off or on, as `check` asks. */
  const toggle = (command: string, enabled: boolean): PluginMethod => ({
    grant: 'connector:put' as Grant,
    describe: () => (enabled
      ? { title: 'Turn a connector on', description: 'Writes enabled: true, opens and checks the connector again, and answers its row.' }
      : { title: 'Turn a connector off', description: 'Closes the connector and writes enabled: false, so it answers no call and lists no model, and answers its row.' }),
    authorize: async (params, reader) => {
      const id = params.id;
      if (typeof id !== 'string') return false;
      const before = await options.collection.get(id);
      return before !== undefined && (ownPlugin(before, reader) || ownerAllows('connector', asOwner(before.owner), reader, 'put'));
    },
    handle: (params, reader) => toggleOne(command, enabled, params, reader),
  });

  const methods: Record<string, PluginMethod> = {
    [PUT]: put,
    [REMOVE]: remove,
    [CHECK]: check,
    [ENABLE]: toggle(ENABLE, true),
    [DISABLE]: toggle(DISABLE, false),
    [NOTE]: noteCall,
    [SECRET]: secretCall,
    [SIGNIN]: signin,
    [SIGNIN_FINISH]: signinFinish,
    ...(options.models === undefined ? {} : { [MODELS]: models }),
  };

  /*
   * The operations a connector record offers, beside the fixed commands above.
   * Enable and Disable run `toggleOne` as their commands do, and Remove runs
   * `removeOne`. Sign in stays `x-ahpd/connectors/signin`, with the form its
   * adapter fills, so no record lists it.
   */
  const operationsOf = (): Operation[] => [
    {
      id: 'enable',
      kind: 'host',
      label: 'Enable',
      description: 'Writes enabled: true, opens and checks the connector again, and answers its row.',
      scopes: ['connector'],
      grant: 'connector:put',
      status: 'idle',
    },
    {
      id: 'disable',
      kind: 'host',
      label: 'Disable',
      description: 'Closes the connector and writes enabled: false, so it answers no call and lists no model, and answers its row.',
      scopes: ['connector'],
      grant: 'connector:put',
      status: 'idle',
    },
    {
      id: 'remove',
      kind: 'host',
      label: 'Remove',
      description: 'Closes one connector and takes it out.',
      confirmation: 'Remove this connector? Its secrets are taken out of the vault and its record goes.',
      scopes: ['connector'],
      grant: 'connector:remove',
      status: 'idle',
    },
  ];

  /** Whether one record offers an operation now. */
  const offers = async (target: string, operationId: string): Promise<boolean> => {
    const record = await options.collection.get(target);
    return record !== undefined && offersOn(stateOf(record)).includes(operationId);
  };

  /** Do what one operation says, through the code its fixed command runs. */
  const runOperation = async (
    operation: Operation,
    target: string | undefined,
    _input: Record<string, unknown> | undefined,
    reader: Principal | undefined,
  ): Promise<unknown> => {
    if (target === undefined) throw new RpcError(INVALID_PARAMS, `${operation.id} runs on one connector, so it needs a target`);
    const params = { id: target };
    if (operation.id === 'enable') return await toggleOne(ENABLE, true, params, reader);
    if (operation.id === 'disable') return await toggleOne(DISABLE, false, params, reader);
    if (operation.id === 'remove') return await removeOne(params, reader);
    throw new RpcError(INVALID_PARAMS, `${operation.id} is not an operation of ${URI}`);
  };

  const operations: OperationChannel = {
    uri: URI,
    operations: operationsOf,
    begin: () => {},
    settle: () => {},
    offers,
    run: runOperation,
  };

  return {
    channel,
    methods,
    operations,
    run,
    note,
    providers,
    refresh: () => {
      const adapters = options.adapters();
      views.dropUnless((name) => adapters[name] !== undefined);
      return channel.refresh();
    },
    refs: () => [...known.values()],
    /*
     * Every stored connector of a registered adapter, in id order, so two
     * connectors that answer on one URL open the same way on every start.
     */
    openAll: async () => {
      const adapters = options.adapters();
      for (const record of [...(await stored())].sort((one, two) => one.id.localeCompare(two.id))) {
        // A record that is off is not opened and reads none of its secrets.
        if (record.enabled === false) continue;
        const owner = owners.get(record.id);
        const adapter = adapters[String(record.adapter)];
        if (owner === undefined) {
          problem(`${record.id} names no owner, so it is not opened`);
          continue;
        }
        // An adapter nobody registers keeps its connectors on disk, served as `unavailable`.
        if (adapter === undefined) continue;
        try {
          await openOne(adapter, record, owner);
        } catch (error) {
          problem(`${record.id} could not be opened: ${reason(error)}`);
          continue;
        }
        // A start does not wait for a check: a slow service must not hold it.
        void checkOne(record.id).then(() => channel.refresh()).catch(() => {});
      }
      await channel.refresh();
    },
  };
}
