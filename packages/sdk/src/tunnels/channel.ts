/**
 * `x-ahpd-tunnels`: the tunnels the host keeps, and the operations each takes.
 *
 * One row for each stored tunnel, keyed by the host's id for it, holding the
 * record as it is kept, the `status` the kind last reported, its `url` and
 * `error` where the host knows them, and the `operation` running on it now.
 * Status, URL and error are in memory only: they change while the daemon runs,
 * and a stored copy would be stale after a restart. The list's state also
 * carries `operations`, the calls a client may make, and the tunnel half of
 * each one runs on a row by id.
 *
 * The settings a kind asks for are fields of the record. Where a kind's schema
 * marks a field `secret`, a put moves it to the vault under `tunnel/<id>/<field>`
 * and keeps a `{ "$secret": "<name>" }` in the record instead, so a listing, a
 * snapshot, an answer and the log never carry it. A field sent empty keeps the
 * secret the record already had. A tunnel is the host's, so every secret is
 * written in the `host:` scope and a record's `owner` stays empty. A report may
 * also name a setting the kind changed while it worked; the host saves only
 * the fields named, as a put saves them, and answers after the save.
 *
 * `create` checks the input against the kind's schema, writes the record with
 * `purpose: person` and `enabled: true`, and only then calls the kind. A kind
 * that throws leaves no record and no secret. `update` keeps a blank secret as
 * the stored one and calls the kind with the resolved settings. `remove` calls
 * the kind first, and takes the record and its secrets out only once the kind
 * has let go. `disable` calls the kind's `stop` and sets `enabled` false;
 * `enable` sets it true and calls `start`. Every other operation passes its
 * name and input to the kind.
 *
 * After `listening`, `startAll` asks each kind with a `system` handler for its
 * system tunnel and adds it when the list holds none of that kind, then starts
 * every enabled record. `stopAll` stops each running record when the daemon
 * stops. `?owner=me` is answered from the record's `owner`, which is empty, so
 * it lists none: a tunnel belongs to the host.
 *
 * A failure is one line with the record's id, never a setting's value.
 */

import { randomBytes } from 'node:crypto';
import {
  TUNNEL_SECRETS,
  asOwner,
  forgetAll as forgetRecordSecrets,
  moveSecrets as moveRecordSecrets,
  resolved as resolvedRecord,
  secretFields,
} from '../channels/owners.js';
import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { recordsChannel, type RecordsChannel } from '../resources/recordschannel.js';
import { reason } from '../utils/values.js';
import { connectorRefusal, withConnectorChoices } from '../connectors/fields.js';
import type { OperationChannel } from '../kinds/operations.js';
import type { ConnectorRef } from '../types/connectors.js';
import type { Operation, OperationStatus } from '../types/kinds.js';
import type { PluginChannel } from '../types/plugin.js';
import type { RecordCollection, StoredRecord } from '../types/records.js';
import type { Grant } from '../types/users.js';
import type { ServedTunnelKind, Tunnel, TunnelReport, TunnelStatus } from '../types/tunnels.js';
import type { Vault } from '../types/vault.js';

/** The channel's scheme, and the URI its state is read at. */
const SCHEME = 'x-ahpd-tunnels';
const URI = `${SCHEME}://`;

/** The fields the host keeps on a record; every other field is one of the kind's settings. */
const HOST_FIELDS: ReadonlySet<string> = new Set(['id', 'kind', 'plugin', 'purpose', 'enabled', 'owner']);

/** How a tunnels channel reads its store, and who writes a secret for it. */
export interface TunnelsChannelOptions {
  /** The `tunnels` collection: one JSON record for each tunnel. */
  collection: RecordCollection;
  /** The kinds the plugins registered, read at each call. */
  kinds(): Record<string, ServedTunnelKind>;
  /** The vault a secret is written to, and read back from when a kind starts. */
  vault(): Vault | undefined;
  /**
   * Check one value against a kind's schema, throwing the first finding.
   *
   * Taken as an option rather than imported: the sdk takes no third-party
   * runtime, and the schema checker the daemon uses belongs to the server.
   */
  check(value: unknown, schema: Record<string, unknown>, label: string): void;
  /**
   * The connectors this host serves, read at each create and update.
   *
   * A field of a kind's schema marked `x-ahpd-connector` names one of these,
   * and a tunnel is host work, so it may name only a host connector. The
   * create and update inputs a client is sent list those connectors as the
   * field's choices. Absent on an embedder with no connectors, which checks no
   * such field.
   */
  connectors?(): readonly ConnectorRef[];
  /** Where a kind that failed is said, as one line. */
  onProblem?(message: string): void;
}

/** A tunnels channel, the operations list beside it, and the steps a start and a stop take. */
export interface TunnelsChannel {
  /** What `servedRecords` takes. */
  channel: RecordsChannel;
  /** The `x-ahpd-tunnels://` side of `x-ahpd/invokeOperation`. */
  operations: OperationChannel;
  /**
   * Add each kind's system tunnel when the list has none, and start every
   * enabled record. A record already running is left alone, so a second call
   * starts nothing twice.
   */
  startAll(port: number): Promise<void>;
  /** Stop each running record, as the daemon stops. */
  stopAll(): Promise<void>;
  /** The URL of each running tunnel, in the order the list started them. */
  urls(): string[];
  /** Send every subscriber what the list is now. */
  refresh(): Promise<void>;
  /** Send every subscriber the operations again, as when the connectors change their choices. */
  refreshOperations(): void;
}

/** What the host knows of one tunnel while the daemon runs. */
interface Live {
  /** What the kind last reported. */
  status: TunnelStatus;
  /** The address a remote client reaches, once the kind reported one. */
  url?: string;
  /** Why the last start failed, until a report clears it. */
  error?: string;
  /** The operation running on this record, or the last one that ran. */
  operation?: { id: string; status: OperationStatus; error?: string };
}

export function tunnelsChannel(options: TunnelsChannelOptions): TunnelsChannel {
  /** The status, URL and operation of each tunnel, in memory only. */
  const live = new Map<string, Live>();
  /** The status of each list operation, in memory only. */
  const listed = new Map<string, { status: OperationStatus; error?: string }>();
  /** Where a publish of the operations goes, once the host is built over the channel. */
  let handle: { publish(uri: string, action: { type: string } & Record<string, unknown>): void } | undefined;

  const problem = (message: string): void => { options.onProblem?.(`${SCHEME}: ${message}`); };

  /** The fields of a record that are the kind's settings, rather than the host's own. */
  const settingsOf = (record: StoredRecord): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(record)) if (!HOST_FIELDS.has(field)) out[field] = value;
    return out;
  };

  /** The host's own fields of a record, without the kind's settings. */
  const hostFieldsOf = (record: StoredRecord): StoredRecord => {
    const out: StoredRecord = {
      id: record.id,
      kind: String(record.kind),
      plugin: String(record.plugin ?? ''),
      purpose: record.purpose === 'system' ? 'system' : 'person',
      enabled: record.enabled === true,
    };
    if (record.owner !== undefined) out.owner = record.owner;
    return out;
  };

  /** One tunnel as a kind is handed it, with each secret read back from the vault. */
  const tunnelOf = async (record: StoredRecord): Promise<Tunnel> => {
    const owner = asOwner(record.owner);
    return {
      id: record.id,
      kind: String(record.kind),
      plugin: String(record.plugin ?? ''),
      purpose: record.purpose === 'system' ? 'system' : 'person',
      enabled: record.enabled === true,
      ...(owner === undefined ? {} : { owner }),
      settings: await resolvedRecord(settingsOf(record), 'host', options.vault(), TUNNEL_SECRETS),
    };
  };

  /** One row as a client is shown it: the record, and what the host knows of it now. */
  const rowOf = (record: StoredRecord): Record<string, unknown> => {
    const held = live.get(record.id);
    return {
      ...record,
      status: held?.status ?? 'stopped',
      ...(held?.url === undefined ? {} : { url: held.url }),
      ...(held?.error === undefined ? {} : { error: held.error }),
      ...(held?.operation === undefined ? {} : { operation: held.operation }),
    };
  };

  /** The settings a create or an update keeps: each secret moved, and a reference in its place. */
  const movedSecrets = async (
    id: string,
    schema: Record<string, unknown>,
    settings: Record<string, unknown>,
    held: Record<string, unknown>,
  ): Promise<Record<string, unknown>> =>
    await moveRecordSecrets({
      rules: TUNNEL_SECRETS,
      fields: secretFields(schema),
      config: settings,
      held,
      owner: 'host',
      id,
      vault: options.vault(),
      problem,
    });

  /** The id a tunnel the host makes is kept under: the kind's name and a run of hex. */
  const freshId = (kind: string): string => `${kind}-${randomBytes(4).toString('hex')}`;

  /**
   * Refuse settings whose marked field names a connector a tunnel may not use.
   *
   * A tunnel has no owner, so the rule is a host record's: the field has to
   * name a host connector of the adapter its mark says. Asked at a create and
   * an update, and not at a start: a record read back may name a connector
   * that opens after the tunnels.
   */
  const refuseConnectors = (settings: Record<string, unknown>, schema: Record<string, unknown>): void => {
    const served = options.connectors?.();
    if (served === undefined) return;
    const refused = connectorRefusal(settings, schema, served, undefined);
    if (refused === undefined) return;
    const { field, id, adapter, found } = refused;
    if (found === undefined) {
      throw new RpcError(INVALID_PARAMS, `${field} names ${id}, and this host serves no ${adapter} connector with that id`);
    }
    throw new RpcError(INVALID_PARAMS, `${field} names ${id}, which belongs to ${found.owner ?? 'nobody'}, so a tunnel may not use it`);
  };

  /**
   * The saves a kind asked for through its reports, one after the next.
   *
   * A report is answered at once, so a save is queued rather than waited for
   * inside the kind's call. The call's answer is sent after it. A save that
   * fails is one line: the kind's work is already done, and the operation is
   * not the place to lose it.
   */
  let saving: Promise<void> = Promise.resolve();

  /**
   * Save the settings one report named.
   *
   * Only the fields the kind sent are written, so a report is a partial form
   * rather than the whole record. The host's own fields are refused here even
   * if a kind sends one: a tunnel that is enabled or owned is the host's
   * decision, and a report is not a create or an update.
   */
  const saveSettings = async (id: string, asked: Record<string, unknown>): Promise<void> => {
    const record = await options.collection.get(id);
    if (record === undefined) return;
    const kind = options.kinds()[String(record.kind)];
    if (kind === undefined) return;
    const settings: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(asked)) {
      if (!HOST_FIELDS.has(field)) settings[field] = value;
    }
    if (Object.keys(settings).length === 0) return;
    const moved = await movedSecrets(id, kind.schema, settings, settingsOf(record));
    await options.collection.put({ ...record, ...moved });
  };

  /** The `report` a kind is given: what the host keeps, and a row for every subscriber. */
  const reportFor = (id: string): ((report: TunnelReport) => void) => (report) => {
    const held: Live = live.get(id) ?? { status: 'stopped' };
    if (report.status !== undefined) {
      held.status = report.status;
      if (report.status !== 'error' && report.error === undefined) delete held.error;
    }
    if (report.url !== undefined) held.url = report.url;
    if (report.error !== undefined) held.error = report.error;
    live.set(id, held);
    if (report.settings !== undefined) {
      const asked = { ...report.settings };
      saving = saving
        .then(() => saveSettings(id, asked))
        .catch((error: unknown) => { problem(`tunnel ${id}'s settings were not saved: ${reason(error)}`); });
    }
    void refresh();
  };

  /** The operations the list offers now: the host's four, then each kind's own. */
  const operationsOf = (): Operation[] => {
    const out: Operation[] = [];
    const status = (id: string): { status: OperationStatus; error?: string } =>
      listed.get(id) ?? { status: 'idle' };
    for (const kind of Object.values(options.kinds()).sort((left, right) => left.name.localeCompare(right.name))) {
      const named = (name: string): string => `${kind.name}/${name}`;
      out.push({
        id: named('create'),
        kind: kind.name,
        label: kind.title,
        description: kind.description,
        input: kind.schema,
        scopes: ['list'],
        grant: 'tunnel:put',
        ...status(named('create')),
      });
      if (kind.update !== undefined) {
        out.push({
          id: named('update'),
          kind: kind.name,
          label: `Edit ${kind.title}`,
          input: kind.schema,
          scopes: ['tunnel'],
          grant: 'tunnel:put',
          ...status(named('update')),
        });
      }
      out.push({
        id: named('remove'),
        kind: kind.name,
        label: `Remove ${kind.title}`,
        confirmation: `Remove this ${kind.title.toLowerCase()} tunnel?`,
        scopes: ['tunnel'],
        grant: 'tunnel:delete',
        ...status(named('remove')),
      });
      out.push({ id: named('enable'), kind: kind.name, label: 'Enable', scopes: ['tunnel'], grant: 'tunnel:put', ...status(named('enable')) });
      out.push({ id: named('disable'), kind: kind.name, label: 'Disable', scopes: ['tunnel'], grant: 'tunnel:put', ...status(named('disable')) });
      for (const operation of kind.operations ?? []) {
        out.push({
          id: named(operation.id),
          kind: kind.name,
          label: operation.label ?? operation.id,
          ...(operation.description === undefined ? {} : { description: operation.description }),
          ...(operation.icon === undefined ? {} : { icon: operation.icon }),
          ...(operation.input === undefined ? {} : { input: operation.input }),
          ...(operation.confirmation === undefined ? {} : { confirmation: operation.confirmation }),
          scopes: ['tunnel'],
          grant: operation.grant ?? 'tunnel:put',
          ...status(named(operation.id)),
        });
      }
    }
    return out;
  };

  /**
   * The operations as a client is sent them: each create and update input
   * with the host's connectors as the choices of a marked field.
   *
   * `run` reads `operationsOf`, so a call is checked against the kind's own
   * schema, and a wrong id is refused by the sentence `refuseConnectors` says
   * rather than by an `enum` that names no connector.
   */
  const servedOperations = (): Operation[] => {
    const served = options.connectors?.();
    if (served === undefined) return operationsOf();
    return operationsOf().map((operation) => {
      const name = operation.id.slice(operation.kind.length + 1);
      if ((name !== 'create' && name !== 'update') || operation.input === undefined) return operation;
      return { ...operation, input: withConnectorChoices(operation.input, served, false) };
    });
  };

  /** Tell each subscriber of the list what its operations are now. */
  const publishOperations = (): void => {
    handle?.publish(URI, { type: `${SCHEME}/operations`, operations: servedOperations() });
  };

  const source = {
    ids: async (): Promise<string[]> => (await options.collection.list()).map((one) => one.id).sort(),
    find: async (id: string): Promise<Record<string, unknown> | undefined> => {
      const record = await options.collection.get(id);
      return record === undefined ? undefined : rowOf(record);
    },
  };

  const records = recordsChannel(SCHEME, source, {
    grant: 'tunnel:read' as Grant,
    // A tunnel belongs to the host and to nobody, so the filter leaves every one out.
    ownerOf: (_id, record) => {
      const owner = asOwner(record.owner);
      return owner === undefined || owner === 'host' ? undefined : owner;
    },
    describe: () => ({
      title: 'Tunnels',
      description: 'The tunnels this host keeps, and the operations each one takes.',
    }),
    onProblem: problem,
  });

  const refresh = async (): Promise<void> => { await records.refresh(); };

  /** The list with its operations beside the records, which a records channel does not answer. */
  const channel: PluginChannel = {
    ...records.channel,
    snapshot: async (asked, reader, client) => {
      const state = await records.channel.snapshot(asked, reader, client) as Record<string, unknown>;
      return { ...state, operations: servedOperations() };
    },
  };

  const tunnelChannel: RecordsChannel = {
    scheme: SCHEME,
    channel,
    bind: (given) => {
      handle = given;
      records.bind(given);
    },
    refresh,
  };

  /** Say one operation has started: on its record, or on the list when it has none. */
  const begin = (operationId: string, target: string | undefined): void => {
    if (target === undefined) {
      listed.set(operationId, { status: 'running' });
      publishOperations();
      return;
    }
    const held: Live = live.get(target) ?? { status: 'stopped' };
    held.operation = { id: operationId, status: 'running' };
    live.set(target, held);
    void refresh();
  };

  /** Say one operation is done, or failed with its error. */
  const settle = (operationId: string, target: string | undefined, error?: string): void => {
    if (target === undefined) {
      listed.set(operationId, error === undefined ? { status: 'idle' } : { status: 'error', error });
      publishOperations();
      return;
    }
    const held = live.get(target);
    if (held !== undefined) {
      held.operation = { id: operationId, status: error === undefined ? 'idle' : 'error', ...(error === undefined ? {} : { error }) };
    }
    void refresh();
  };

  /** Start one stored tunnel, keeping an error on its row and one line in the log. */
  const startOne = async (record: StoredRecord): Promise<void> => {
    const kind = options.kinds()[String(record.kind)];
    if (kind === undefined) {
      problem(`tunnel ${record.id} names ${String(record.kind)}, and no plugin registers that kind now`);
      return;
    }
    try {
      await kind.invoke('start', await tunnelOf(record), reportFor(record.id));
      // A start may have turned a setting on; it is saved before the next one.
      await saving;
    } catch (error) {
      const message = reason(error);
      const held: Live = live.get(record.id) ?? { status: 'stopped' };
      held.status = 'error';
      held.error = message;
      live.set(record.id, held);
      problem(`tunnel ${record.id} did not start: ${message}`);
    }
  };

  /** The row an operation answers with, as the store holds it now. */
  const rowNow = async (id: string, fallback: StoredRecord): Promise<Record<string, unknown>> =>
    rowOf(await options.collection.get(id) ?? fallback);

  const run = async (
    operation: Operation,
    target: string | undefined,
    input: Record<string, unknown> | undefined,
  ): Promise<unknown> => {
    const kind = options.kinds()[operation.kind];
    if (kind === undefined) {
      throw new RpcError(INVALID_PARAMS, `No tunnel kind called ${operation.kind} is registered now`);
    }
    const name = operation.id.slice(operation.kind.length + 1);

    if (name === 'create') {
      const settings = input ?? {};
      options.check(settings, kind.schema, `${kind.name}'s settings`);
      refuseConnectors(settings, kind.schema);
      const id = freshId(kind.name);
      const moved = await movedSecrets(id, kind.schema, settings, {});
      const record: StoredRecord = { id, kind: kind.name, plugin: kind.by, purpose: 'person', enabled: true, ...moved };
      await options.collection.put(record);
      live.set(id, { status: 'stopped' });
      try {
        await kind.create(await tunnelOf(record), reportFor(id));
      } catch (error) {
        // The kind could not make it, so nothing of it stays: no record, no secret, no row.
        await options.collection.remove(id);
        await forgetRecordSecrets(moved, 'host', id, TUNNEL_SECRETS, options.vault(), problem);
        live.delete(id);
        throw error;
      }
      // A report may have asked for a setting to be saved; the row answers with it.
      await saving;
      await refresh();
      return await rowNow(id, record);
    }

    if (target === undefined) {
      throw new RpcError(INVALID_PARAMS, `${operation.id} runs on one tunnel, so it needs a target`);
    }
    const record = await options.collection.get(target);
    if (record === undefined) throw new RpcError(INVALID_PARAMS, `No tunnel with id ${target} is in the list`);
    if (String(record.kind) !== operation.kind) {
      throw new RpcError(INVALID_PARAMS, `Tunnel ${target} is a ${String(record.kind)} tunnel, so ${operation.id} is not its`);
    }

    if (name === 'update') {
      if (kind.update === undefined) {
        throw new RpcError(INVALID_PARAMS, `${operation.id} is not offered: ${kind.name} has no update`);
      }
      const settings = input ?? {};
      options.check(settings, kind.schema, `${kind.name}'s settings`);
      refuseConnectors(settings, kind.schema);
      const moved = await movedSecrets(record.id, kind.schema, settings, settingsOf(record));
      const next: StoredRecord = { ...hostFieldsOf(record), ...moved };
      await options.collection.put(next);
      await kind.update(
        await tunnelOf(next),
        await resolvedRecord(moved, 'host', options.vault(), TUNNEL_SECRETS),
        reportFor(record.id),
      );
      await saving;
      await refresh();
      return await rowNow(record.id, next);
    }

    if (name === 'remove') {
      await kind.remove(await tunnelOf(record));
      // Before the record goes, so a save the kind asked for cannot put it back.
      await saving;
      await options.collection.remove(record.id);
      await forgetRecordSecrets(settingsOf(record), 'host', record.id, TUNNEL_SECRETS, options.vault(), problem);
      live.delete(record.id);
      await refresh();
      return {};
    }

    if (name === 'enable' || name === 'disable') {
      if (name === 'disable') {
        await kind.invoke('stop', await tunnelOf(record), reportFor(record.id));
        // Saved before this record is written again, so the write carries them.
        await saving;
        await options.collection.put({ ...record, enabled: false });
      } else {
        await options.collection.put({ ...record, enabled: true });
        await startOne({ ...record, enabled: true });
      }
      await refresh();
      return await rowNow(record.id, record);
    }

    await kind.invoke(name, await tunnelOf(record), reportFor(record.id), input);
    await saving;
    await refresh();
    return await rowNow(record.id, record);
  };

  const operations: OperationChannel = { uri: URI, operations: operationsOf, begin, settle, run };

  const startAll = async (port: number): Promise<void> => {
    const before = await options.collection.list();
    for (const kind of Object.values(options.kinds())) {
      if (kind.system === undefined) continue;
      // The host adds one system tunnel for each kind, and only when the list holds none.
      if (before.some((one) => String(one.kind) === kind.name && one.purpose === 'system')) continue;
      let settings: Record<string, unknown> | undefined;
      try {
        settings = await kind.system({ port });
      } catch (error) {
        problem(`the ${kind.name} system tunnel was not added: ${reason(error)}`);
        continue;
      }
      if (settings === undefined) continue;
      try {
        options.check(settings, kind.schema, `${kind.name}'s settings`);
        const id = freshId(kind.name);
        const moved = await movedSecrets(id, kind.schema, settings, {});
        await options.collection.put({ id, kind: kind.name, plugin: kind.by, purpose: 'system', enabled: true, ...moved });
        live.set(id, { status: 'stopped' });
      } catch (error) {
        problem(`the ${kind.name} system tunnel was not added: ${reason(error)}`);
      }
    }
    for (const record of await options.collection.list()) {
      if (record.enabled !== true) continue;
      if (live.get(record.id)?.status === 'running') continue;
      await startOne(record);
    }
    await refresh();
  };

  const stopAll = async (): Promise<void> => {
    for (const record of await options.collection.list()) {
      if (live.get(record.id)?.status !== 'running') continue;
      const kind = options.kinds()[String(record.kind)];
      if (kind === undefined) continue;
      try {
        await kind.invoke('stop', await tunnelOf(record), reportFor(record.id));
      } catch (error) {
        problem(`tunnel ${record.id} did not stop: ${reason(error)}`);
      }
    }
    await refresh();
  };

  const urls = (): string[] => {
    const out: string[] = [];
    for (const held of live.values()) {
      if (held.status === 'running' && held.url !== undefined && !out.includes(held.url)) out.push(held.url);
    }
    return out;
  };

  return { channel: tunnelChannel, operations, startAll, stopAll, urls, refresh, refreshOperations: publishOperations };
}
