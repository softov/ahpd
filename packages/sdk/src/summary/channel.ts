/**
 * `x-ahpd-summary`: the counts a client draws a badge from, for each area of the host.
 *
 * One entry for each area the reader may open, keyed by the area's name. An
 * entry carries the area's channel URI, the number of rows the reader sees,
 * those rows counted by state, and their alerts when the area's rows carry
 * alerts: one group for each level and text, with how many rows say it and
 * which ones, so a client says what is wrong and where. A client shows a badge from it without a
 * subscribe to each area, as AHP's `AnnotationsSummary` lets a session's
 * badge render without a subscribe to its annotations.
 *
 * The rows stay the record of truth, and each row keeps its own alerts: the
 * summary groups them. Each reader is counted by the area's own grants,
 * so two people on one host may be sent two summaries. An area a reader may
 * not open, and in which they see no row, is left out rather than sent as zero.
 *
 * Each area's list tells the summary after each refresh. The summary waits a
 * second from the first change, so a burst of changes is one send, and then
 * reads only the areas that changed. A reader is sent
 * `x-ahpd-summary/changed` with the whole summary only when their counts
 * moved, and a constant stream of changes sends at most once a second.
 */

import { RpcError } from '../rpc.js';
import { ownerOfPrincipal } from '../utils/values.js';
import type { RecordEntry, RecordsChannel } from '../resources/recordschannel.js';
import type { Alert, ChannelHandle, PluginChannel } from '../types/plugin.js';
import type { Grant, Principal } from '../types/users.js';

/** The channel's scheme, and the one URI it answers. */
const SCHEME = 'x-ahpd-summary';
const URI = `${SCHEME}://`;

/** How long the summary waits after a change before it sends, in milliseconds. */
export const SUMMARY_DELAY_MS = 1_000;

/** The alert levels a summary counts, worst first. */
const LEVELS: readonly Alert['level'][] = ['error', 'warning', 'info', 'notice'];

/** One area the summary counts. */
export interface SummaryArea {
  /** The key the area's entry is sent under, such as `plugins`. */
  name: string;
  /** The area's list, whose rows are counted and whose refresh is heard. */
  list: RecordsChannel;
  /** The row field that holds the state, such as `state`; absent, the entry has no `states`. */
  state?: string;
  /** Whether the area's rows carry `alerts`; true, the entry groups them. */
  alerts?: boolean;
}

/** One row an alert group names. */
export interface AlertRow {
  /** The row's id on the area's channel. */
  id: string;
  /** What a person calls the row: its title, display name or name, else its id. */
  title: string;
}

/** The rows that say one alert: its level, its text, how many, and which. */
export interface AlertGroup {
  level: Alert['level'];
  text: string;
  /** How many rows say it. */
  count: number;
  /** Those rows, in the order the area lists them. */
  rows: AlertRow[];
}

/** One area as one reader is sent it. */
export interface AreaSummary {
  /** The area's channel URI, which a client subscribes to for the rows. */
  channel: string;
  /** How many rows the reader sees. */
  total: number;
  /** Those rows counted by their state, when the area has one. */
  states?: Record<string, number>;
  /** Their alerts grouped by level and text, worst first, when the area's rows carry alerts. */
  alerts?: AlertGroup[];
}

/** What a subscribe answers, and what `x-ahpd-summary/changed` carries. */
export interface Summary {
  /** One entry for each area the reader may open, by the area's name. */
  areas: Record<string, AreaSummary>;
}

/** How a summary channel waits and where it says a problem. */
export interface SummaryOptions {
  /** How long to wait after a change before a send; `SUMMARY_DELAY_MS` when absent. */
  delayMs?: number;
  /** Where a list that could not be read is said. */
  onProblem?(message: string): void;
}

/** The summary channel, and the steps its server wires to the host. */
export interface SummaryChannel {
  /** The channel's scheme, `x-ahpd-summary`. */
  scheme: string;
  /** What `registerChannel` takes. */
  channel: PluginChannel;
  /** The handle every send goes through. */
  bind(handle: ChannelHandle): void;
  /** Stop the timer and stop hearing the areas. */
  stop(): void;
}

/** Whose one reader is: the client id, and the person the connection is now. */
const readerKey = (client: string, reader: Principal | undefined): string =>
  JSON.stringify([client, reader === undefined ? '' : ownerOfPrincipal(reader)]);

/** The client id a `readerKey` was made from. */
const clientOfKey = (key: string): string => (JSON.parse(key) as [string, string])[0];

/** What a person calls a row: its title, display name or name, else its id. */
const titleOf = ({ id, record }: RecordEntry): string => {
  for (const field of ['title', 'displayName', 'name']) {
    const value = record[field];
    if (typeof value === 'string' && value !== '') return value;
  }
  return id;
};

/**
 * Each row's `alerts` grouped by level and text, worst level first and then
 * the group most rows say. A row that says one alert twice is named once; an
 * entry that is not an alert is left out.
 */
const alertsIn = (rows: RecordEntry[]): AlertGroup[] => {
  const groups = new Map<string, AlertGroup>();
  for (const entry of rows) {
    if (!Array.isArray(entry.record.alerts)) continue;
    for (const alert of entry.record.alerts as unknown[]) {
      const { level, text } = (alert ?? {}) as { level?: unknown; text?: unknown };
      if (!LEVELS.includes(level as Alert['level']) || typeof text !== 'string') continue;
      const key = JSON.stringify([level, text]);
      const group = groups.get(key) ?? { level: level as Alert['level'], text, count: 0, rows: [] };
      groups.set(key, group);
      if (group.rows.some((one) => one.id === entry.id)) continue;
      group.rows.push({ id: entry.id, title: titleOf(entry) });
      group.count += 1;
    }
  }
  return [...groups.values()].sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || b.count - a.count || a.text.localeCompare(b.text));
};

/** Each row counted by the text its `field` holds; a row with no text there is not counted. */
const statesIn = (rows: RecordEntry[], field: string): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const { record } of rows) {
    const state = record[field];
    if (typeof state === 'string' && state !== '') counts[state] = (counts[state] ?? 0) + 1;
  }
  return counts;
};

export function summaryChannel(areas: SummaryArea[], options: SummaryOptions = {}): SummaryChannel {
  const delay = options.delayMs ?? SUMMARY_DELAY_MS;
  let handle: ChannelHandle | undefined;
  /** The rows each area held at its last read, by the area's name. */
  const rows = new Map<string, RecordEntry[]>();
  /** The areas changed since their last read; every area at the start. */
  const changed = new Set<string>(areas.map((one) => one.name));
  /** The JSON of the last summary each reader was sent, by `readerKey`. */
  const sent = new Map<string, string>();
  /** The send queued after a change, while it waits. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The last read queued, which the next one waits for. */
  let tail: Promise<void> = Promise.resolve();

  /** Run one read after every one queued before it. */
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const done = tail.then(work);
    tail = done.then(() => undefined, () => undefined);
    return done;
  };

  /** Read each area that changed since its last read; an area that fails keeps its last rows. */
  const read = async (): Promise<void> => {
    for (const area of areas) {
      if (!changed.has(area.name)) continue;
      // Taken out first, so a change heard during the read marks it again.
      changed.delete(area.name);
      try {
        rows.set(area.name, await area.list.listing.rows());
      } catch (error) {
        options.onProblem?.(`${SCHEME}: the ${area.name} list could not be read: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  /** The summary of what one reader may see, from the rows last read. */
  const summaryFor = (reader: Principal | undefined): Summary => {
    const out: Record<string, AreaSummary> = {};
    for (const area of areas) {
      const listing = area.list.listing;
      const seen = (rows.get(area.name) ?? []).filter((one) => listing.readable(one.id, reader));
      if (seen.length === 0 && !listing.opens(reader)) continue;
      out[area.name] = {
        channel: `${area.list.scheme}://`,
        total: seen.length,
        ...(area.state === undefined ? {} : { states: statesIn(seen, area.state) }),
        ...(area.alerts === true ? { alerts: alertsIn(seen) } : {}),
      };
    }
    return { areas: out };
  };

  /** Read what changed, and send each reader whose summary moved. */
  const flush = (): Promise<void> => exclusive(async () => {
    const subscribers = handle?.subscribers(URI) ?? [];
    // Nobody to send: the areas stay marked, and the next snapshot reads them.
    if (subscribers.length === 0) return;
    await read();
    for (const { client, reader } of subscribers) {
      const key = readerKey(client, reader);
      const summary = summaryFor(reader);
      const text = JSON.stringify(summary);
      if (sent.get(key) === text) continue;
      sent.set(key, text);
      handle?.publish(URI, { type: `${SCHEME}/changed`, ...summary }, {
        to: client,
        visible: (principal, seen) => readerKey(seen, principal) === key,
      });
    }
  });

  /**
   * Wait a second from the first change, then send; a change heard while the
   * timer waits is sent with it. The timer starts with no subscriber too: a
   * subscribe is answered before the host records it, so a change in between
   * reaches the new reader when the timer ends.
   */
  const schedule = (): void => {
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush().catch((error: unknown) => {
        options.onProblem?.(`${SCHEME}: the summary could not be sent: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, delay);
    timer.unref?.();
  };

  const stops = areas.map((area) => area.list.listing.onRefresh(() => {
    changed.add(area.name);
    schedule();
  }));

  return {
    scheme: SCHEME,
    channel: {
      /*
       * Every connection may subscribe, as every one may ask `x-ahpd/me`: the
       * summary holds only the areas the reader may open, so the grant never
       * keeps a reader out. The daemon lists it in `ahpd.grants`, as it lists
       * the grants of its other channels.
       */
      grant: 'summary:read' as Grant,
      authorize: async () => true,
      describe: () => ({ title: 'Summary', description: 'How many rows each area holds, by state and by alert.' }),
      snapshot: async (asked, reader, client) => {
        if (asked !== URI) throw new RpcError(-32001, `No channel at ${asked}; the summary is ${URI}`);
        return exclusive(async () => {
          await read();
          const summary = summaryFor(reader);
          sent.set(readerKey(client, reader), JSON.stringify(summary));
          return summary;
        });
      },
      left: (client) => {
        for (const key of [...sent.keys()]) if (clientOfKey(key) === client) sent.delete(key);
      },
    },
    bind: (given) => { handle = given; },
    stop: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      for (const one of stops) one();
    },
  };
}
