/**
 * Which rows pay for one piece of work, whether they have room, and the keys
 * its records are charged under.
 *
 * `decide` answers whether a person may do a thing and which rows allowed it;
 * this is the step after it. Each measure walks those rows on its own, in the
 * person's order - the key's own row, their own rows, then the project, the
 * team, then `all` - and the first row with room in that measure pays for it. A
 * row with no limits takes every measure and adds no key, a row with no limit in
 * a measure is skipped for it, and a `cap` row is counted and never pays.
 *
 * The keys a paying row adds are how a limit finds its own usage: a record of
 * the work carries them in `pools`, and `limitsOf` reads the store's total for
 * a key as what the limit has used. A `minute` limit reads a meter instead,
 * because the store keeps no total finer than a day.
 */

import { scoped } from '../access/decide.js';
import type { Decision } from '../access/decide.js';
import { periodOf } from './periods.js';
import type { MinuteMeter } from './minute.js';
import type { Scope } from './scopes.js';
import type { LimitPool, Measure, Period, Policy, PolicyKind } from '../types/policies.js';
import type { Usage, UsageTotal } from '../types/usage.js';
import type { Principal } from '../types/users.js';

/**
 * The measures this plan counts, by kind, in the order a walk reads them.
 *
 * A limit in any other measure is stored and reads back as not counted, so it
 * never closes its row: `hours` and `sessions` are policy 03's.
 */
export const COUNTED: Record<PolicyKind, readonly Measure[]> = {
  model: ['usd', 'tokens', 'calls'],
  agent: ['usd', 'tokens', 'turns'],
  computer: [],
};

/**
 * The measures a piece of work raises by one when it is allowed.
 *
 * They are counted before the work runs rather than at its record, because a
 * record is written after it ends: every call in a burst starts before any of
 * them is recorded, so a count taken at the record lets the whole burst pass.
 */
const COUNTED_AT_CALL: readonly Measure[] = ['calls', 'turns'];

/**
 * Which row of one scope pays first.
 *
 * `ending` puts the row that ends soonest first, so temporary credit is used
 * before regular credit; `regular` puts the open-ended rows first; `extra`
 * puts the rows with an `until` first, the newest `from` among them.
 */
export type PayOrder = 'ending' | 'regular' | 'extra';

/** What the walk reads, and the instant it reads at. */
export interface ChargeOptions {
  /** The zone the store cuts its days in, which is the zone the periods are read in. */
  zone: string;
  /** Which row of one scope pays first. Defaults to `ending`. */
  payOrder?: PayOrder;
  /** The instant to read the totals at. Defaults to now. */
  at?: Date;
  /**
   * What each key used in this minute, which a `minute` limit reads.
   *
   * The store keeps no total finer than a day, so a limit on a minute reads its
   * figure here. Absent, a `minute` limit reads zero. The walk never counts into
   * the meter: the caller counts once, through `countCall`.
   */
  meter?: MinuteMeter;
}

/**
 * Why a piece of work may not be done.
 *
 * The row, the limit that closed it and the figures are parts, so a caller
 * reads what happened without taking the sentence apart.
 */
export interface ChargeRefusal {
  /** The row that has no room. */
  policy: string;
  /** The limit that closed it. */
  measure: Measure;
  /** The period the limit is counted over. */
  period: Period;
  /** What the limit allows, and what the period has used of it. */
  amount: number;
  used: number;
  /** The sentence, and the whole of the refusal. */
  message: string;
}

/** What the walk found, whichever way it went. */
export type Charge =
  | { allowed: true; pools: string[]; refusal?: undefined }
  | { allowed: false; refusal: ChargeRefusal; pools?: undefined };

/** One member of an `each` limit, as the store holds a key for them. */
export interface LimitMember {
  /** The user id after `user:` in the key. */
  user: string;
  /** What the member used of the measure in the period. */
  used: number;
}

/** What one limit allows, what is used and when the period resets. */
export interface LimitFigure {
  /** How much the limit allows. */
  amount: number;
  /** What it is counted in. */
  measure: Measure;
  /** The window it is counted over. */
  period: Period;
  /** Whether a group shares the total or every member has their own. */
  pool: LimitPool;
  /** Whether this plan counts the measure. A limit it does not count never closes its row. */
  counted: boolean;
  /** What the period used, when the measure is counted. Absent for an `each` read without a person. */
  used?: number;
  /** Every member with a key of their own, when an `each` limit is read without a person. */
  members?: LimitMember[];
  /** The first instant of the period. */
  from: string;
  /** When the period resets; absent for `total`. */
  resets?: string;
  /** The row's `until`, when it names one. */
  ends?: string;
}

/** `policy:<id>` or `pool:<name>`, the row's share of every key it writes. */
const baseOf = (row: Policy): string =>
  row.pool === undefined ? `policy:${row.id}` : `pool:${row.pool}`;

/** The key one limit's usage is kept under. */
const keyOf = (row: Policy, measure: Measure, pool: LimitPool, user?: string): string => {
  const key = `${baseOf(row)}/${measure}`;
  return pool === 'each' && user !== undefined ? `${key}/user:${user}` : key;
};

/**
 * The measure a key is kept in: the segment before `/user:<id>` on an `each`
 * key, and the last segment on any other.
 */
export const measureOf = (key: string): string => {
  const member = key.indexOf('/user:');
  const kept = member === -1 ? key : key.slice(0, member);
  return kept.slice(kept.lastIndexOf('/') + 1);
};

/** The prefix every member of an `each` limit adds `user:<id>` to. */
const memberPrefixOf = (row: Policy, measure: Measure): string =>
  `${baseOf(row)}/${measure}/user:`;

/**
 * The keys `row` writes for its limits in `measure`, one per limit.
 *
 * An `each` limit names the person in the key, so a record of their work is
 * what their own total reads.
 */
export const keysOf = (row: Policy, measure: Measure, person: Principal): string[] =>
  (row.limits ?? [])
    .filter((limit) => limit.measure === measure)
    .map((limit) => keyOf(row, measure, limit.pool, limit.pool === 'each' ? person.id : undefined));

/** What one total says a measure used. A measure the total does not keep is zero. */
const usedIn = (total: UsageTotal, measure: Measure): number => {
  switch (measure) {
    case 'usd': return total.usd ?? 0;
    case 'tokens': return total.tokens ?? 0;
    case 'calls': return total.calls ?? 0;
    case 'turns': return total.turns ?? 0;
    case 'hours': return total.hours ?? 0;
    case 'sessions': return 0;
  }
};

/**
 * One row's limits, each with what is used, where the period began and when it
 * resets.
 *
 * `used` is the store's total for the limit's key between the start of the
 * period and `now`, which is the record-tagging the policy plan is built on. A
 * `minute` limit reads the meter's figure instead, because the store keeps no
 * total finer than a day; with no meter its figure is zero. An `each` limit read
 * without a person answers every member the store holds a key for, because a
 * member who used nothing has no key and used zero. A limit in a measure this
 * plan does not count answers `counted: false` and no figure: nothing can say it
 * is out.
 */
export async function limitsOf(
  row: Policy,
  usage: Usage,
  zone: string,
  now: Date,
  person?: Principal,
  meter?: MinuteMeter,
): Promise<LimitFigure[]> {
  const until = now.toISOString();
  const figures: LimitFigure[] = [];
  for (const limit of row.limits ?? []) {
    const { from, resets } = periodOf(zone, limit.period, now, row.from);
    const usedAt = async (key: string): Promise<number> => (limit.period === 'minute'
      ? meter?.sum(key, now) ?? 0
      : usedIn(await usage.total(key, from, until), limit.measure));
    const counted = COUNTED[row.kind].includes(limit.measure);
    const figure: LimitFigure = {
      amount: limit.amount,
      measure: limit.measure,
      period: limit.period,
      pool: limit.pool,
      counted,
      from,
      ...(resets === undefined ? {} : { resets }),
      ...(row.until === undefined ? {} : { ends: row.until }),
    };
    if (counted) {
      if (limit.pool === 'each' && person === undefined) {
        const prefix = memberPrefixOf(row, limit.measure);
        const keys = (await usage.pools()).filter((key) => key.startsWith(prefix));
        figure.members = await Promise.all(keys.map(async (key) => ({
          user: key.slice(prefix.length),
          used: await usedAt(key),
        })));
      }
      else {
        const key = keyOf(row, limit.measure, limit.pool, limit.pool === 'each' ? person?.id : undefined);
        figure.used = await usedAt(key);
      }
    }
    figures.push(figure);
  }
  return figures;
}

/** The scope level a row is charged at: the key, the person, the project, the team, then all. */
const LEVELS: Record<'user' | 'project' | 'team', number> = { user: 0, project: 1, team: 2 };

/**
 * How specific a row's scope is, read the way `scoped` reads it.
 *
 * A key's own row is before every row about a person: it is about the
 * credential the call was made with, and a cap narrows what everything after it
 * allows.
 */
const levelOf = (row: Policy): number => {
  if (row.scope === 'all') return 3;
  const what = row.scope.slice(0, row.scope.indexOf(':'));
  if (what === 'token') return -1;
  return LEVELS[what as 'user' | 'project' | 'team'];
};

/**
 * Which of two rows of one scope level pays first, by the configured order.
 *
 * The answer is the `Array.sort` comparison, so an equal pair keeps the store's
 * order: the order an operator wrote them in.
 */
const byPayOrder = (payOrder: PayOrder, a: Policy, b: Policy): number => {
  const aEnd = a.until;
  const bEnd = b.until;
  if (payOrder === 'regular') {
    if (aEnd === bEnd) return 0;
    if (aEnd === undefined) return -1;
    if (bEnd === undefined) return 1;
    return aEnd < bEnd ? -1 : 1;
  }
  if (payOrder === 'extra') {
    if (aEnd === undefined && bEnd === undefined) return 0;
    if (aEnd === undefined) return 1;
    if (bEnd === undefined) return -1;
    const aFrom = a.from ?? '';
    const bFrom = b.from ?? '';
    return aFrom === bFrom ? 0 : aFrom > bFrom ? -1 : 1;
  }
  if (aEnd === bEnd) return 0;
  if (aEnd === undefined) return 1;
  if (bEnd === undefined) return -1;
  return aEnd < bEnd ? -1 : 1;
};

/** The first counted limit that has no room, which is what closed the row. */
const closedIn = (figures: readonly LimitFigure[]): LimitFigure | undefined =>
  figures.find((figure) => figure.counted && (figure.used ?? 0) >= figure.amount);

/** The refusal for a row with no room, as the one sentence it is said in. */
const refusalOf = (row: Policy, limit: LimitFigure): ChargeRefusal => {
  const used = limit.used ?? 0;
  const when = limit.period === 'total' ? 'in total' : `this ${limit.period}`;
  return {
    policy: row.id,
    measure: limit.measure,
    period: limit.period,
    amount: limit.amount,
    used,
    message: `${row.id} has no room: ${used} / ${limit.amount} ${limit.measure} ${when}`,
  };
};

/**
 * Which rows pay for a piece of work the check allowed, and where its records
 * are charged.
 *
 * One measure at a time, in the order `COUNTED` names them. A row with no
 * limits takes the measure and adds no key; a row with no limit in the measure
 * is skipped; a `cap` row adds its keys, refuses the work when it is out of
 * room, and never pays; and the first other row with room adds its keys and
 * ends the measure. A row has room only while every counted limit has room, so
 * a row closed in one measure pays no other measure: that measure is only
 * recorded, and adds no key, as long as another measure finds a row. The work
 * is refused only when no measure finds one, and the refusal names the first
 * row that closed and the limit that closed it.
 *
 * The check is before the work and the record after it, so two pieces of work
 * that start together can both pass an amount in `usd` or `tokens`. A `calls`
 * or `turns` key is counted by the caller when the work is allowed, through
 * `countCall`, so a burst cannot pass one of those. The walk itself counts
 * nothing, because one piece of work may walk more than once: the proxy asks
 * the policy of every entry a name is served by.
 */
export async function chargeFor(
  decision: Extract<Decision, { allowed: true }>,
  kind: PolicyKind,
  principal: Principal,
  scope: Scope | undefined,
  usage: Usage,
  options: ChargeOptions,
): Promise<Charge> {
  // A `*:*` holder is allowed with no candidates, and nothing is charged to a key.
  if (decision.candidates.length === 0) return { allowed: true, pools: [] };

  const at = options.at ?? new Date();
  const payOrder = options.payOrder ?? 'ending';
  const rows = decision.candidates
    .filter((row) => row.effect === 'allow' && scoped(row, principal, scope))
    .sort((a, b) => levelOf(a) - levelOf(b) || byPayOrder(payOrder, a, b));

  // One reading per row, however many measures ask about it.
  const read = new Map<string, LimitFigure[]>();
  const figuresFor = async (row: Policy): Promise<LimitFigure[]> => {
    const held = read.get(row.id);
    if (held !== undefined) return held;
    const figures = await limitsOf(row, usage, options.zone, at, principal, options.meter);
    read.set(row.id, figures);
    return figures;
  };

  const pools: string[] = [];
  const seen = new Set<string>();
  const add = (row: Policy, measure: Measure): void => {
    for (const key of keysOf(row, measure, principal)) {
      if (seen.has(key)) continue;
      seen.add(key);
      pools.push(key);
    }
  };

  // The first row that closed anywhere on the walk, which is what a refusal names.
  let firstClosed: { row: Policy; limit: LimitFigure } | undefined;
  // Whether any measure found a row to pay it, a row with no limits included.
  let paidAny = false;

  for (const measure of COUNTED[kind]) {
    let paid = false;
    let closed: { row: Policy; limit: LimitFigure } | undefined;
    for (const row of rows) {
      // A row with no limits takes every measure, and there is nothing to key.
      if (row.limits === undefined || row.limits.length === 0) {
        paid = true;
        break;
      }
      // A row with no limit in this measure is skipped, and the measure walks on.
      if (!row.limits.some((limit) => limit.measure === measure)) continue;
      const figures = await figuresFor(row);
      const shut = closedIn(figures);
      if (row.cap === true) {
        add(row, measure);
        if (shut !== undefined) return { allowed: false, refusal: refusalOf(row, shut) };
        continue;
      }
      if (shut === undefined) {
        add(row, measure);
        paid = true;
        break;
      }
      closed ??= { row, limit: shut };
    }
    if (paid) paidAny = true;
    firstClosed ??= closed;
    // A measure whose limiting rows are all closed and which no row takes is
    // only recorded: it adds no key. The draft's examples 14, 18 and 30 are
    // this case, and they allow, with the measure the other row pays.
  }

  // A closed row spills to the next, and the work is refused when nothing pays
  // it at all. The refusal names the first row that closed and the limit that
  // closed it, whichever measure the walk met it in.
  if (!paidAny && firstClosed !== undefined) {
    return { allowed: false, refusal: refusalOf(firstClosed.row, firstClosed.limit) };
  }

  return { allowed: true, pools };
}

/**
 * Count one piece of work once, in the `calls` and `turns` keys it is charged.
 *
 * The walk counts nothing, because a caller may walk it more than once for one
 * piece of work: the proxy asks the policy of every entry a name is served by,
 * and falls back to the next candidate when the first does not answer. The
 * caller counts the keys of the candidate it sends to, once, before it sends,
 * so a fallback is not a second call and a turn is one turn.
 *
 * A minute limit on one of those keys reads the count at the next check, and
 * work that has started but not ended is already in it. A key named twice is
 * counted once.
 */
export const countCall = (keys: Iterable<string>, meter: MinuteMeter | undefined, at?: Date): void => {
  if (meter === undefined) return;
  const counted = new Set<string>();
  for (const key of keys) {
    if (counted.has(key)) continue;
    if (!(COUNTED_AT_CALL as readonly string[]).includes(measureOf(key))) continue;
    counted.add(key);
    meter.add(key, 1, at);
  }
};
