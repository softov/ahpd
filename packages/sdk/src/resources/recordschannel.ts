/**
 * A list of records as an `x-` channel, and the commands that change one.
 *
 * Users, teams, projects, roles and policies are each a channel beside their
 * resource scheme. A subscribe
 * answers `{ records }`, each entry `{ id, record }` with the record the
 * scheme's `resourceRead` answers for that id. Three actions follow it:
 *
 * - `<scheme>/added` `{ id, record }` - a record this client did not have, and may read now.
 * - `<scheme>/changed` `{ id, record }` - a record this client has, whose JSON differs from the last one sent.
 * - `<scheme>/removed` `{ id }` - a record this client has, gone from the store or no longer readable.
 *
 * The store stays the record of truth. The channel keeps the last record it
 * sent for each id and the ids it sent to each reader, a client id and the
 * person on it, and `refresh` reads the store and sends each reader what it
 * gained, changed and lost, with `to` and `visible`.
 */

import { INVALID_PARAMS, RpcError } from '../rpc.js';
import { putRecord, recordsProvider, removeRecord, type Records, type RecordsProvider } from './records.js';
import type { ChannelHandle, PluginChannel, PluginMethod, PublishOptions, ServedChannel, ServedMethod } from '../types/plugin.js';
import type { Grant, Principal } from '../types/users.js';
import type { Owner } from '../types/usage.js';
import { ownerFilter, ownerOfPrincipal } from '../utils/values.js';

/** What a records channel reads: every id, and one record by id. */
export interface RecordsSource {
  /** Every record's id, in the order a snapshot lists them. */
  ids(): Promise<string[]>;
  /** One record as it stands, or nothing when the store holds none. */
  find(id: string): Promise<Record<string, unknown> | undefined>;
}

/** How a records channel decides who reads what. */
export interface RecordsChannelOptions {
  /** What a reader needs to read every record. */
  grant: Grant;
  /** Whether a reader without `grant` may read this one record all the same. */
  mayRead?(id: string, reader: Principal): boolean;
  /**
   * Whether every reader's records go through `mayRead`, the holder of `grant` included.
   *
   * Off, a reader holding `grant` reads every record and `mayRead` widens the
   * list to a reader without it. On, `mayRead` is the whole answer for every
   * reader, so a channel whose records are each one person's can narrow the
   * holder of `grant` too.
   */
  mayReadEveryReader?: boolean;
  /**
   * A second grant that admits a subscribe without a readable record.
   *
   * Asked only by `authorize`, of a reader without `grant`. A holder of this
   * one reads every record through `mayRead`, and is let in by the grant alone
   * where the store holds no record to find.
   */
  alsoGrant?: Grant;
  /**
   * Whose one record is, when this channel answers `<channel>?owner=me`.
   *
   * Given, a filtered subscription is answered with the caller's own records
   * in its snapshot and in every diff. Without it a channel URI with a query
   * is refused, as it was before there was a filter.
   */
  ownerOf?(id: string, record: Record<string, unknown>): Owner | undefined;
  /** What a client shows for the channel. */
  describe?(): { title: string; description?: string };
  /** Where a refresh that could not read the store is said. */
  onProblem?(message: string): void;
  /**
   * One record in the locale of the client it is sent to.
   *
   * Called on each record sent and on each snapshot, never on the record the
   * channel keeps: a diff compares the store's own records, so a locale never
   * makes a change of its own. Absent, every reader gets the record as the
   * store holds it, and so does a client that sent no locale.
   */
  translate?(record: Record<string, unknown>, locale: string): Record<string, unknown>;
}

/** One record as the channel sends it. */
export interface RecordEntry {
  id: string;
  record: Record<string, unknown>;
}

/** A records channel, and the steps its server wires to the host. */
export interface RecordsChannel {
  /** The channel's scheme, such as `x-ahpd-teams`. */
  scheme: string;
  /** What `registerChannel` takes. */
  channel: PluginChannel;
  /** The handle every send goes through. */
  bind(handle: ChannelHandle): void;
  /** Read the store, and send each client what it gained, changed and lost. */
  refresh(): Promise<void>;
  /**
   * Send one action about one record to each reader who holds it.
   *
   * `change` applies the same change to the last record sent, so the next
   * refresh finds the record as its readers have it and sends no `changed`
   * for it. A record nobody holds is not sent, and `change` is not called.
   */
  notify(id: string, action: { type: string } & Record<string, unknown>, change: (record: Record<string, unknown>) => Record<string, unknown>): Promise<void>;
}

export function recordsChannel(scheme: string, source: RecordsSource, options: RecordsChannelOptions): RecordsChannel {
  const uri = `${scheme}://`;
  /** The ids sent to each reader of each channel URI, by `stateKey`. */
  const sent = new Map<string, Set<string>>();
  /** The JSON of the last record sent for each id. */
  const last = new Map<string, string>();
  /** Every channel URI a subscription has been answered on. */
  const known = new Set<string>([uri]);
  let handle: ChannelHandle | undefined;
  /** The last read of the store queued, which the next one waits for. */
  let tail: Promise<void> = Promise.resolve();
  /** The refresh queued and not yet started, which a further call shares. */
  let pending: Promise<void> | undefined;

  /**
   * The query a channel URI carries, or nothing when it carries none this
   * channel answers.
   *
   * A query is taken only when `ownerOf` is given and `owner` is its one key:
   * that is the one filter a records channel has. Any other query is a
   * channel that does not exist, exactly as it was before there was a filter,
   * so a client cannot open a new URI by adding keys to it.
   */
  const queryOf = (asked: string): string | undefined => {
    if (asked === uri || options.ownerOf === undefined || !asked.startsWith(`${uri}?`)) return undefined;
    const query = asked.slice(uri.length + 1);
    const keys = [...new URLSearchParams(query).keys()];
    return keys.length === 1 && keys[0] === 'owner' ? query : undefined;
  };

  /** The owner a channel URI narrows itself to, or none for the plain list. */
  const narrowedTo = (asked: string, reader: Principal | undefined): Owner | null | undefined => {
    const query = queryOf(asked);
    return query === undefined ? undefined : ownerFilter(query, reader);
  };

  /**
   * Whether this reader sees this record.
   *
   * No reader is a host with no users directory, or the root connection, and
   * both see every record. Otherwise `grant` reads every record, unless
   * `mayReadEveryReader` sends the holder through `mayRead` too, and `mayRead`
   * answers for a reader without it.
   */
  const readable = (id: string, reader: Principal | undefined): boolean => {
    if (reader === undefined) return true;
    if (options.mayReadEveryReader !== true && reader.can(options.grant)) return true;
    return options.mayRead?.(id, reader) === true;
  };

  /**
   * Whether one reader sees one record on one channel URI.
   *
   * Reading comes first: a filter narrows what this reader may already read,
   * and it never opens a record the grant and `mayRead` keep out.
   */
  const shownTo = (asked: string, reader: Principal | undefined, entry: RecordEntry): boolean => {
    if (!readable(entry.id, reader)) return false;
    const owner = narrowedTo(asked, reader);
    if (owner === undefined) return true;
    if (owner === null) return false;
    return options.ownerOf?.(entry.id, entry.record) === owner;
  };

  /** One subscription: the URI it was asked on, and who is on it. */
  interface Held {
    asked: string;
    client: string;
    reader: Principal | undefined;
  }

  /** Every subscription this channel holds, on every URI it answers. */
  const watching = (): Held[] => {
    const held: Held[] = [];
    for (const asked of known) for (const one of handle?.subscribers(asked) ?? []) {
      held.push({ asked, client: one.client, reader: one.reader });
    }
    return held;
  };

  /** Every record the store holds now, in the order it lists them. */
  const every = async (): Promise<RecordEntry[]> => {
    const entries: RecordEntry[] = [];
    for (const id of await source.ids()) {
      const record = await source.find(id);
      if (record !== undefined) entries.push({ id, record });
    }
    return entries;
  };

  /** One record in `locale`, or as it is when there is no locale or no `translate`. */
  const inLocale = (record: Record<string, unknown>, locale: string | undefined): Record<string, unknown> =>
    locale === undefined || options.translate === undefined ? record : options.translate(record, locale);

  /** Run one read of the store after every one queued before it. */
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const done = tail.then(work);
    tail = done.then(() => undefined, () => undefined);
    return done;
  };

  /**
   * Send one action to one reader on one client, on one channel URI.
   *
   * `to` names the client, and `visible` names the reader and the filter: two
   * people on one client id each hold their own state, and an action is seen
   * only by a connection that is that person now, may still read the record,
   * and asked for a channel that record belongs on. `about` is the record an
   * action that carries none is about, which the filter reads.
   */
  const send = (
    asked: string,
    client: string,
    reader: Principal | undefined,
    action: { type: string; id: string } & Record<string, unknown>,
    about?: Record<string, unknown>,
  ): void => {
    const key = readerKey(client, reader);
    const removal = action.type === `${scheme}/removed`;
    const carried = action.record as Record<string, unknown> | undefined;
    const record = carried ?? about;
    const audience: PublishOptions = {
      to: client,
      visible: (principal, seen) => {
        if (readerKey(seen, principal) !== key) return false;
        if (removal) return true;
        if (!readable(action.id, principal)) return false;
        const owner = narrowedTo(asked, principal);
        if (owner === undefined) return true;
        if (owner === null) return false;
        return record !== undefined && options.ownerOf?.(action.id, record) === owner;
      },
    };
    // In the reader's locale on the way out; `visible` above reads the record as stored.
    const locale = handle?.localeOf?.(client);
    handle?.publish(asked, carried === undefined || locale === undefined ? action : { ...action, record: inLocale(carried, locale) }, audience);
  };

  /** Update `last` from `now`, and send each waiting subscription but `skip` what it gained, changed and lost. */
  const apply = (held: Held[], now: RecordEntry[], skip?: string): void => {
    const changed = new Set<string>();
    const kept = new Set<string>();
    for (const { id, record } of now) {
      kept.add(id);
      const text = JSON.stringify(record);
      const was = last.get(id);
      if (was !== undefined && was !== text) changed.add(id);
      last.set(id, text);
    }
    for (const id of [...last.keys()]) if (!kept.has(id)) last.delete(id);
    for (const { asked, client, reader } of held) {
      const key = stateKey(asked, client, reader);
      if (key === skip) continue;
      const mine = new Set(now.filter((one) => shownTo(asked, reader, one)).map((one) => one.id));
      const set = sent.get(key);
      sent.set(key, mine);
      // A reader with no set has nothing to diff against, and starts from here.
      if (set === undefined) continue;
      for (const { id, record } of now) {
        if (!mine.has(id)) continue;
        if (!set.has(id)) send(asked, client, reader, { type: `${scheme}/added`, id, record });
        else if (changed.has(id)) send(asked, client, reader, { type: `${scheme}/changed`, id, record });
      }
      for (const id of set) {
        if (!mine.has(id)) send(asked, client, reader, { type: `${scheme}/removed`, id });
      }
    }
  };

  const step = async (): Promise<void> => {
    const subscribers = watching();
    /*
     * Nobody holds a record, so nothing is read: the next snapshot seeds what
     * the refresh after it compares with.
     */
    if (subscribers.length === 0) {
      last.clear();
      return;
    }
    apply(subscribers, await every());
  };

  const problem = (error: unknown): void => {
    options.onProblem?.(`${scheme}: the list could not be read: ${error instanceof Error ? error.message : String(error)}`);
  };

  return {
    scheme,
    channel: {
      grant: options.grant,
      ...(options.describe === undefined ? {} : { describe: options.describe }),
      authorize: async (asked, reader) => {
        const query = queryOf(asked);
        if (asked !== uri && query === undefined) return false;
        const owner = query === undefined ? undefined : ownerFilter(query, reader);
        if (owner === null) return false;
        // A second grant reads every record, and is let in with none to find.
        if (options.alsoGrant !== undefined && reader.can(options.alsoGrant)) return true;
        if (options.mayRead === undefined) return false;
        for (const id of await source.ids()) {
          if (options.mayRead?.(id, reader) !== true) continue;
          if (owner === undefined) return true;
          const record = await source.find(id);
          if (record !== undefined && options.ownerOf?.(id, record) === owner) return true;
        }
        return false;
      },
      snapshot: async (asked, reader, client) => {
        const query = queryOf(asked);
        if (asked !== uri && query === undefined) throw new RpcError(-32001, `No channel at ${asked}; the list is ${uri}`);
        // Refused above for any other value, and kept only once it is a channel this host answers.
        const owner = query === undefined ? undefined : ownerFilter(query, reader);
        known.add(asked);
        const key = stateKey(asked, client, reader);
        /*
         * The snapshot is a refresh's read: every other reader is sent what
         * this read changed, so `last` and each reader's ids agree with it.
         */
        return exclusive(async () => {
          const now = await every();
          apply(watching(), now, key);
          const records = owner === null ? [] : now.filter((one) => shownTo(asked, reader, one));
          sent.set(key, new Set(records.map((one) => one.id)));
          const locale = handle?.localeOf?.(client);
          return { records: locale === undefined ? records : records.map((one) => ({ id: one.id, record: inLocale(one.record, locale) })) };
        });
      },
      left: (client) => {
        for (const key of [...sent.keys()]) if (clientOfKey(key) === client) sent.delete(key);
      },
    },
    bind: (given) => { handle = given; },
    /*
     * A call made while a refresh waits shares it, so at most one runs and one
     * waits; the one waiting reads the store after every call it answers.
     */
    refresh: () => {
      if (pending !== undefined) return pending;
      const queued = exclusive(async () => {
        pending = undefined;
        await step();
      }).catch(problem);
      pending = queued;
      return queued;
    },
    /*
     * In the queue a refresh runs in, so the record changed here is the one the
     * refresh after it compares with.
     */
    notify: (id, action, change) => exclusive(async () => {
      const was = last.get(id);
      if (was === undefined) return;
      const record = change(JSON.parse(was) as Record<string, unknown>);
      last.set(id, JSON.stringify(record));
      for (const { asked, client, reader } of watching()) {
        if (sent.get(stateKey(asked, client, reader))?.has(id) !== true) continue;
        send(asked, client, reader, { ...action, id }, record);
      }
    }).catch(problem),
  };
}

/**
 * Whose one reader is: the client id, and the person the connection is now.
 *
 * Several people may share a client id, and each holds their own state.
 */
const readerKey = (client: string, reader: Principal | undefined): string =>
  JSON.stringify([client, reader === undefined ? '' : ownerOfPrincipal(reader)]);

/**
 * Which subscription one reader's ids are: the channel URI it asked for, the
 * client, and the person the connection is now.
 *
 * The plain list and a filtered one are two URIs, and a client may watch both.
 */
const stateKey = (asked: string, client: string, reader: Principal | undefined): string =>
  JSON.stringify([asked, client, reader === undefined ? '' : ownerOfPrincipal(reader)]);

/** The client id a `stateKey` was made from. */
const clientOfKey = (key: string): string => (JSON.parse(key) as [string, string, string])[1];

/** A string param that names one record, or a refusal saying what the command needs. */
const idParam = (command: string, scheme: string, params: Record<string, unknown>): string => {
  const id = params.id;
  /*
   * An id a URI could not name is refused, so a record made by command is one
   * `<scheme>://<id>` reads back.
   */
  if (typeof id !== 'string' || id === '' || /[/?]/.test(id)) {
    throw new RpcError(INVALID_PARAMS, `${command} needs id, the ${scheme}'s id, with no / or ?`);
  }
  return id;
};

/**
 * The `put` and `remove` commands of one records scheme, by name.
 *
 * `x-ahpd/<domain>/put` takes `{ id, record, createOnly? }` and needs
 * `<scheme>:put`; `x-ahpd/<domain>/remove` takes `{ id }` and needs
 * `<scheme>:delete`. Both go through the rules a resource write and delete go
 * through, and answer `{}` as they do. `refresh` is called after each.
 */
export const recordsMethods = (domain: string, scheme: string, records: Records, refresh: () => Promise<void>): Record<string, PluginMethod> => {
  const put = `x-ahpd/${domain}/put`;
  const remove = `x-ahpd/${domain}/remove`;
  return {
    [put]: {
      grant: `${scheme}:put` as Grant,
      describe: () => ({ title: `Put a ${scheme}`, description: `Makes or edits one ${scheme}.` }),
      handle: async (params, reader) => {
        const id = idParam(put, scheme, params);
        const record = params.record;
        if (typeof record !== 'object' || record === null || Array.isArray(record)) {
          throw new RpcError(INVALID_PARAMS, `A ${scheme} is made from a JSON object, and that body is not one`);
        }
        const createOnly = params.createOnly;
        if (createOnly !== undefined && typeof createOnly !== 'boolean') {
          throw new RpcError(INVALID_PARAMS, `${put} takes createOnly as true or false`);
        }
        await putRecord(scheme, records, id, record as Record<string, unknown>, createOnly === true, reader);
        await refresh();
        return {};
      },
    },
    [remove]: {
      grant: `${scheme}:delete` as Grant,
      describe: () => ({ title: `Remove a ${scheme}`, description: `Takes one ${scheme} out.` }),
      handle: async (params, reader) => {
        const id = idParam(remove, scheme, params);
        await removeRecord(scheme, records, id, `${scheme}://${id}`, reader);
        await refresh();
        return {};
      },
    },
  };
};

/** Records channels and commands, as a daemon hands them to `HostOptions`. */
export interface ServedRecords {
  channels: Record<string, ServedChannel>;
  methods: Record<string, ServedMethod>;
}

/**
 * Channels and commands the daemon serves itself, as `HostOptions` takes them.
 *
 * Each channel is bound to a handle that sends through the entry the host
 * sets `publish` and `subscribers` on, as a plugin's handle does.
 */
export const servedRecords = (by: string, channels: RecordsChannel[], methods: Record<string, PluginMethod>): ServedRecords => {
  const served: Record<string, ServedChannel> = {};
  for (const one of channels) {
    const entry: ServedChannel = { by, scheme: one.scheme, channel: one.channel };
    one.bind({
      publish: (uri, action, options = {}) => { entry.publish?.(uri, action, options); },
      subscribers: (uri) => entry.subscribers?.(uri) ?? [],
      localeOf: (client) => entry.localeOf?.(client),
    });
    served[one.scheme] = entry;
  }
  return {
    channels: served,
    methods: Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, { by, name, method }])),
  };
};

/** One records domain: its scheme, its channel, and its commands. */
export interface RecordsDomain {
  /** The resource provider, which refreshes the channel after each write and remove. */
  provider: RecordsProvider;
  channel: RecordsChannel;
  methods: Record<string, PluginMethod>;
}

/**
 * One records scheme as a provider, a channel and two commands over one store.
 *
 * The channel is `x-ahpd-<domain>`, it needs `<scheme>:read`, and every write
 * through the provider or a command refreshes it.
 */
export const recordsDomain = (
  domain: string,
  scheme: string,
  records: Records,
  options: {
    mayRead?: RecordsChannelOptions['mayRead'];
    ownerOf?: RecordsChannelOptions['ownerOf'];
    onProblem?: RecordsChannelOptions['onProblem'];
  } = {},
): RecordsDomain => {
  const channel = recordsChannel(`x-ahpd-${domain}`, records, {
    grant: `${scheme}:read` as Grant,
    describe: () => ({ title: records.title, description: records.description }),
    ...(options.mayRead === undefined ? {} : { mayRead: options.mayRead }),
    ...(options.ownerOf === undefined ? {} : { ownerOf: options.ownerOf }),
    ...(options.onProblem === undefined ? {} : { onProblem: options.onProblem }),
  });
  return {
    provider: recordsProvider(scheme, records, () => { void channel.refresh(); }),
    channel,
    methods: recordsMethods(domain, scheme, records, channel.refresh),
  };
};
