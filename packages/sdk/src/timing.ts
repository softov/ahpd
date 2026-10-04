import type { Bag } from './types/common.js';

/**
 * When a tool call ran, in the bag every action of that call carries.
 *
 * The protocol gives a tool call no time of its own, so its times ride in its
 * `_meta` and the plugin that ran the call is the one that stamps them - a
 * live one from the harness's own times where it has them, and from the
 * plugin's clock where it does not. An action carrying a `_meta` replaces the
 * call's whole bag, so the times are built here and merged into whatever the
 * call already has, and every plugin goes through these three.
 */

/** The keys a call's times are written on, spelled once here. */
const STARTED = 'ahpd.startedAt';
const ENDED = 'ahpd.endedAt';
const DURATION = 'ahpd.durationMs';

/**
 * A time in epoch milliseconds, whether it was given as that or as an ISO
 * string, and nothing when it is neither.
 */
const epochOf = (at: unknown): number | undefined => {
  if (typeof at === 'number' && Number.isFinite(at)) return at;
  if (typeof at !== 'string') return undefined;
  const parsed = Date.parse(at);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * The times of a tool call, in a bag.
 *
 * With no end the call is still running and only its start is said. The
 * duration is the one the harness measured, since that is the truer one, and
 * otherwise the difference of the two times.
 */
export function callTimes(start: number | string, end?: number | string, durationMs?: number): Bag {
  const from = epochOf(start) ?? Date.now();
  const to = end === undefined ? undefined : epochOf(end);
  const times: Bag = { [STARTED]: new Date(from).toISOString() };
  if (to === undefined) return times;
  return {
    ...times,
    [ENDED]: new Date(to).toISOString(),
    [DURATION]: Math.max(0, durationMs ?? to - from),
  };
}

/** A call's bag with the times merged into it, so `toolKind` and the reference's `subagent*` keys stay. */
export function withCallTimes(meta: Bag | undefined, times: Bag): Bag {
  return { ...meta, ...times };
}

/** A call's start read back as epoch milliseconds, so a plugin holding only the bag can time the end. */
export function startOf(meta: unknown): number | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined;
  return epochOf((meta as Bag)[STARTED]);
}
