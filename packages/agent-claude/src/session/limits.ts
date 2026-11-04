import type { QuotaSnapshot, QuotaSnapshots } from '@ahpd/sdk';
import type { Login } from '../logins.js';
import { bag, list, str } from './common.js';
import type { SessionContext } from './context.js';

/**
 * The plan limits of each login, as its account reports them.
 *
 * The CLI names one window in each `rate_limit_event` as it changes, and its
 * usage request answers every window of the account at once. Both are kept
 * here, in memory, by the token the login held: a put that gives a connector
 * another account's token leaves the old account's limits behind rather than
 * drawing them for the new one. A session on the CLI's own sign-in has no
 * login to share them by, so it keeps its own, and only a login's limits reach
 * the connector's health. A restart forgets them, as it forgets a login's
 * rest, and the first turn fills them again.
 */

/** How long between two usage requests for one login, in milliseconds. */
const USAGE_MS = 60_000;

/** What one login's account has said of its plan. */
interface Plan {
  /** The windows the account reported. Absent until an answer or an event. */
  snapshots?: QuotaSnapshots;
  /** When the usage request last ran, or nought when only events have spoken. */
  askedAt: number;
  /** What the host was last told, as text, so an unchanged answer says nothing. */
  sent?: string;
}

/** The plans of the logins, by connector id and the token each held. */
const plans = new Map<string, Plan>();

/** The plans of the sessions on the CLI's own sign-in, each its own. */
const own = new WeakMap<SessionContext, Plan>();

/** One login's own key: its connector id and the token it held when read. */
const keyOf = (login: Login): string => `${login.id}\u0000${login.token}`;

/** The plan a session reads and writes: its login's, or its own. */
const planOf = (ctx: SessionContext): Plan | undefined =>
  ctx.login === undefined ? own.get(ctx) : plans.get(keyOf(ctx.login));

/** Keep the plan a session reads, where `planOf` finds it. */
const keep = (ctx: SessionContext, plan: Plan): void => {
  if (ctx.login === undefined) own.set(ctx, plan);
  else plans.set(keyOf(ctx.login), plan);
};

/** The plan limits a session's turn carries, or nothing when nobody has answered. */
export const limitsOf = (ctx: SessionContext): QuotaSnapshots | undefined => planOf(ctx)?.snapshots;

/** A finite number, or nothing. A utilization of zero is a measurement. */
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** A time as one ISO form, so the usage answer's `+00:00` and an event's seconds read alike. */
const isoOf = (reset: string | undefined): string | undefined => {
  if (reset === undefined || reset === '') return undefined;
  const at = Date.parse(reset);
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
};

/**
 * What is left of a window, and when it resets.
 *
 * `utilization` is a percentage, 0 to 100, as the usage request answers it.
 */
const snapshotOf = (utilization: number | undefined, reset: string | undefined): QuotaSnapshot => {
  const resetDate = isoOf(reset);
  return {
    ...(utilization === undefined ? {} : { remainingPercentage: 100 - utilization }),
    ...(resetDate === undefined ? {} : { resetDate }),
  };
};

/** The key one of the CLI's window names answers, or nothing for a name it is not. */
const quotaKey = (type: string): string | undefined => {
  switch (type) {
    case 'five_hour': return 'session';
    case 'seven_day': return 'weekly';
    case 'seven_day_opus': return 'weekly:opus';
    case 'seven_day_sonnet': return 'weekly:sonnet';
    case 'seven_day_overage_included': return 'weekly:overage_included';
    default: return undefined;
  }
};

/**
 * The `extra_usage` fields of an answer, as the overage fields of a snapshot.
 *
 * The account has credits only when `is_enabled` is true; a limit of null is
 * a budget with no cap, which is no `overageEntitlement` rather than a nought.
 */
const overageOf = (extra: unknown): QuotaSnapshot | undefined => {
  const found = bag(extra);
  if (found.is_enabled !== true) return undefined;
  const used = num(found.used_credits);
  const limit = num(found.monthly_limit);
  return {
    overageAllowedWithExhaustedQuota: true,
    ...(used === undefined ? {} : { overage: used }),
    ...(limit === undefined ? {} : { overageEntitlement: limit }),
  };
};

/** One window of the usage answer, or nothing when it names no figure. */
const windowOf = (one: unknown): QuotaSnapshot | undefined => {
  const found = bag(one);
  if (Object.keys(found).length === 0) return undefined;
  const snapshot = snapshotOf(num(found.utilization), str(found.resets_at));
  return Object.keys(snapshot).length === 0 ? undefined : snapshot;
};

/**
 * Map the usage answer's `rate_limits` to `quotaSnapshots`.
 *
 * `five_hour` is the rolling session window and `seven_day` the week's. The
 * two named days and each server-labelled model window are a named week, so a
 * client shows them under the week they belong to. Extra usage rides the
 * weekly snapshot when the account has one, because it is billed beside the
 * week it extends.
 */
export const quotaSnapshotsOf = (rateLimits: unknown): QuotaSnapshots => {
  const found = bag(rateLimits);
  const out: QuotaSnapshots = {};
  for (const [field, key] of [
    ['five_hour', 'session'],
    ['seven_day', 'weekly'],
    ['seven_day_opus', 'weekly:opus'],
    ['seven_day_sonnet', 'weekly:sonnet'],
  ] as const) {
    const window = windowOf(found[field]);
    if (window !== undefined) out[key] = window;
  }
  for (const one of list(found.model_scoped)) {
    const row = bag(one);
    const name = str(row.display_name);
    const window = windowOf(row);
    if (name === undefined || window === undefined) continue;
    out[`weekly:${name.toLowerCase()}`] = window;
  }
  const extra = overageOf(found.extra_usage);
  if (extra !== undefined) {
    const key = out.weekly !== undefined ? 'weekly' : out.session !== undefined ? 'session' : 'weekly';
    out[key] = { ...out[key], ...extra };
  }
  return out;
};

/**
 * Keep one `rate_limit_event`'s window for the turn's login.
 *
 * The event names the one window whose state changed, so the others keep what
 * they had. A window with neither a utilization nor a reset time says nothing
 * that can be drawn and is left out. The host hears about a change as soon as
 * the map differs from what it was told.
 */
export const noteLimit = (ctx: SessionContext, info: unknown): void => {
  const found = bag(info);
  const type = str(found.rateLimitType);
  const key = type === undefined ? undefined : quotaKey(type);
  if (key === undefined) return;
  // The event's utilization is a fraction, 0 to 1, as the API's unified
  // rate-limit headers carry it; the usage request answers a percentage.
  const fraction = num(found.utilization);
  const utilization = fraction === undefined ? undefined : fraction * 100;
  const resetsAt = num(found.resetsAt);
  const reset = resetsAt === undefined || resetsAt <= 0
    ? undefined
    : new Date(resetsAt * 1000).toISOString();
  const snapshot = snapshotOf(utilization, reset);
  if (Object.keys(snapshot).length === 0) return;
  const held = planOf(ctx);
  publish(ctx, { ...held?.snapshots, [key]: snapshot }, held?.askedAt ?? 0);
};

/**
 * Ask what each window of the login's plan is now, at most once a minute.
 *
 * The answer is the account's own, which no event carries in full. The request
 * is experimental and may be gone in a later SDK, so a missing method is no
 * answer rather than a failure, as a throw is. A request that runs is stamped
 * before it is awaited, so two results that end together ask once.
 */
export const refreshLimits = async (ctx: SessionContext, now: number = Date.now()): Promise<void> => {
  const held = planOf(ctx);
  if (held !== undefined && now - held.askedAt < USAGE_MS) return;
  const handle = ctx.query as unknown as {
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (opts: { skipBehaviors?: boolean }) => Promise<unknown>;
  };
  const ask = handle.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
  if (typeof ask !== 'function') return;
  keep(ctx, { ...held, askedAt: now });
  let answer: unknown;
  try {
    answer = await ask.call(handle, { skipBehaviors: true });
  } catch {
    // The events still stand; a request that failed is not a plan with none.
    return;
  }
  const found = bag(answer);
  // The account has no plan limits, which is a real answer and an empty map.
  if (found.rate_limits_available === false) {
    publish(ctx, {}, now);
    return;
  }
  const rateLimits = bag(found.rate_limits);
  if (Object.keys(rateLimits).length === 0) return;
  publish(ctx, quotaSnapshotsOf(rateLimits), now);
};

/**
 * Keep the map, and tell the host when a login's map is not what it was told.
 *
 * The plugin sends the snapshots with a note, as it sends a call's outcome, so
 * the host keeps them in the connector's health without a message of its own.
 * A session on the CLI's own sign-in has no connector to tell.
 */
const publish = (ctx: SessionContext, snapshots: QuotaSnapshots, askedAt: number): void => {
  const before = planOf(ctx);
  const text = JSON.stringify(snapshots);
  keep(ctx, { snapshots, askedAt, sent: text });
  const login = ctx.login;
  if (login === undefined || text === before?.sent) return;
  ctx.options.logins?.open.noted(login.id, login.token, snapshots);
};
