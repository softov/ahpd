/**
 * A record's alerts, held in one ordered list.
 *
 * A plugin, an agent and a connector each say what is wrong with them as
 * alerts, and each keeps them by the `ref` the alert names. An alert with the
 * `ref` of one already there replaces it, so a list holds at most one alert per
 * source, and the newest is at the end.
 *
 * The list is in memory only. The oldest alert goes first once the list holds
 * `limit`, so a source that alerts in a loop cannot grow a row without end.
 */

import { RecordGaps } from '../channels/owners.js';
import { reason } from '../utils/values.js';
import type { Alert } from '../types/plugin.js';

/** One record's alerts, oldest first. */
export interface AlertList {
  /** Add one alert, replacing an alert with the same `ref`, and stamp `at` when it has none. */
  add(alert: Alert): void;
  /** Remove the alert with this `ref`, answering whether one was there. */
  drop(ref: string): boolean;
  /** Remove every alert. */
  clear(): void;
  /** The alerts, oldest first, as a copy of the list. */
  list(): Alert[];
}

/** Make a list that holds at most `limit` alerts and drops the oldest first. */
export const alertList = (limit: number): AlertList => {
  const held: Alert[] = [];
  return {
    add: (alert) => {
      const at = alert.ref === undefined ? -1 : held.findIndex((one) => one.ref === alert.ref);
      if (at !== -1) held.splice(at, 1);
      held.push(alert.at === undefined ? { ...alert, at: new Date().toISOString() } : alert);
      if (held.length > limit) held.splice(0, held.length - limit);
    },
    drop: (ref) => {
      const at = held.findIndex((one) => one.ref === ref);
      if (at === -1) return false;
      held.splice(at, 1);
      return true;
    },
    clear: () => {
      held.splice(0, held.length);
    },
    list: () => [...held],
  };
};

/** Whether an alert is one a failed open raises: `open`, or an `env:` or `secret:` gap. */
const isOpenAlert = (ref: string | undefined): ref is string =>
  ref === 'open' || ref?.startsWith('env:') === true || ref?.startsWith('secret:') === true;

/** Remove every alert a failed open raised from one list. */
export const dropOpenAlerts = (list: AlertList): void => {
  for (const alert of list.list()) {
    if (isOpenAlert(alert.ref)) list.drop(alert.ref);
  }
};

/**
 * Put the alerts of one failed open in place of the last open's.
 *
 * A `RecordGaps` error raises one `error` alert per gap, and any other error
 * one `open` alert, whose text is cut to `limit` characters. A gap the last
 * open raised and this one did not is removed, so a fixed gap leaves the row.
 */
export const raiseOpenAlerts = (list: AlertList, error: unknown, fallback: string, limit = Infinity): void => {
  dropOpenAlerts(list);
  if (error instanceof RecordGaps) {
    for (const gap of error.gaps) list.add({ level: 'error', text: gap.text, ref: gap.ref });
    return;
  }
  const message = reason(error).slice(0, limit);
  list.add({ level: 'error', text: message === '' ? fallback : message, ref: 'open' });
};
