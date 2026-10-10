/**
 * Where a host keeps its policies, and the one check both stores make.
 *
 * `filePolicies` is the store: every row in one `policies.json`, written beside
 * and renamed into place. `memoryPolicies` holds them for the life of the
 * process, which is what a test and a host with no folder want. They are one
 * function over one map, so a rule that holds for one holds for the other.
 *
 * `checkPolicy` is the door every body comes through - the stores and the
 * `policy:` scheme - and answers the row it holds rather than a verdict, so the
 * scheme and `decide` name a row they were handed.
 */

import { INVALID_PARAMS, RpcError } from './rpc.js';
import { readJson, writeJsonAtomic } from './jsonfile.js';
import type {
  Measure, Period, Policies, Policy, PolicyKind, PolicyLimit, PolicyMatch, PolicyValueType,
} from './types/policies.js';

/*
 * The tables every value a policy may carry comes from.
 *
 * They are exported because `policy.ts` builds the manifest's choices out of
 * them: the values a form offers and the values a check refuses by have to be
 * one list, or a host that adds a measure offers a form that the check then
 * refuses.
 */

/** What a row's limits may be counted in, by the kind the row is about. */
export const MEASURES: Record<PolicyKind, readonly Measure[]> = {
  model: ['usd', 'tokens', 'calls'],
  agent: ['usd', 'tokens', 'turns', 'hours'],
  computer: ['hours', 'sessions'],
};

/** The value types a row's `match` may name, by the kind the row is about. */
export const MATCHES: Record<PolicyKind, readonly PolicyValueType[]> = {
  model: ['model', 'proxy'],
  agent: ['agent', 'model', 'computer'],
  computer: ['computer'],
};

/** Every value type there is, in the order a refusal names them. */
const VALUES = ['model', 'proxy', 'agent', 'computer'] as const;

export const PERIODS = ['day', 'week', 'month', 'total'] as const;

export const KINDS = ['model', 'agent', 'computer'] as const;

export const EFFECTS = ['allow', 'deny'] as const;

export const LIMIT_POOLS = ['shared', 'each'] as const;

/** A bare `YYYY-MM-DD` day, which a window is written as when no hour matters. */
const DAY = /^\d{4}-\d{2}-\d{2}$/u;

/** An ISO 8601 instant, which is what a window is stored as. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

/** What a body said, said back in a refusal that is worth reading. */
const said = (value: unknown): string =>
  typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);

/** One field a body got wrong. Every refusal here names it. */
const wrong = (field: string, what: string): RpcError =>
  new RpcError(INVALID_PARAMS, `A policy's ${field} ${what}`);

/**
 * One end of a window, as the instant a check compares against.
 *
 * A bare day is the whole day on both sides, and the two spellings cannot
 * disagree: `until: 2026-10-31` written the other way would stop at midnight
 * and leave the last day the row names as the one it does not apply. A day is
 * a UTC day, because a policy window is a fact about a store rather than about
 * where the daemon happens to run.
 */
const edgeOf = (value: unknown, field: 'from' | 'until'): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw wrong(field, 'is an ISO 8601 instant or a YYYY-MM-DD day');
  }
  const text = value.trim();
  const day = DAY.test(text);
  if (!day && !INSTANT.test(text)) {
    throw wrong(field, `is an ISO 8601 instant or a YYYY-MM-DD day, and that body has ${said(text)}`);
  }
  const at = new Date(day ? `${text}T00:00:00.000Z` : text);
  // A day the calendar does not have, and an instant out of range, both read
  // as a date this host cannot place.
  if (Number.isNaN(at.getTime()) || (day && at.toISOString().slice(0, 10) !== text)) {
    throw wrong(field, `is a day this host can read, and that body has ${said(text)}`);
  }
  return day ? `${text}T${field === 'from' ? '00:00:00.000' : '23:59:59.999'}Z` : at.toISOString();
};

/** One list of text under `match.<key>`, which is what a value type holds. */
const valuesOf = (held: PolicyMatch, key: PolicyValueType): string[] | undefined => {
  const value = held[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((one) => typeof one !== 'string')) {
    throw wrong(`match.${key}`, 'is a list of strings');
  }
  return (value as string[]).map((one) => one.trim()).filter((one) => one !== '');
};

/** One limit, checked against the measures of the row's kind. */
const limitOf = (body: unknown, kind: PolicyKind, index: number): PolicyLimit => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw wrong(`limits[${index}]`, 'is an object holding an amount, a measure, a period and a pool');
  }
  const { amount, measure, period, pool } = body as Record<string, unknown>;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
    throw wrong(`limits[${index}].amount`, 'is a number that is not negative');
  }
  if (!MEASURES[kind].includes(measure as Measure)) {
    throw wrong(`limits[${index}].measure`,
      `is one of ${MEASURES[kind].join(', ')} for a ${kind} policy, and that body has ${said(measure)}`);
  }
  if (!PERIODS.includes(period as Period)) {
    throw wrong(`limits[${index}].period`, `is one of ${PERIODS.join(', ')}, and that body has ${said(period)}`);
  }
  if (!LIMIT_POOLS.includes(pool as PolicyLimit['pool'])) {
    throw wrong(`limits[${index}].pool`, `is one of ${LIMIT_POOLS.join(', ')}, and that body has ${said(pool)}`);
  }
  return { amount, measure: measure as Measure, period: period as Period, pool: pool as PolicyLimit['pool'] };
};

/**
 * The row a body is, or a refusal naming what is wrong with it.
 *
 * Every field the row has is checked here, and nothing else is read: `pool`,
 * `cap` and `limits` are stored as written and enforce nothing. A bare
 * `from` and a bare `until` are stored as the instants a check compares, so
 * the window a client reads is the window a person wrote.
 */
export function checkPolicy(body: unknown): Policy {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new RpcError(INVALID_PARAMS, `A policy is made from a JSON object, and that body has ${said(body)}`);
  }
  const held = body as Record<string, unknown>;

  if (typeof held.id !== 'string' || held.id.trim() === '') throw wrong('id', 'is a non-empty name');
  const id = held.id.trim();

  const scope = held.scope;
  if (typeof scope !== 'string' || scope === '') {
    throw wrong('scope', 'is all, user:<id>, team:<id> or project:<team>:<project>, and that body has none');
  }
  if (scope !== 'all') {
    const named = /^(user|team|project):(.*)$/u.exec(scope);
    if (named === null) {
      throw wrong('scope', `is all, user:<id>, team:<id> or project:<team>:<project>, and that body has ${said(scope)}`);
    }
    const rest = named[2] ?? '';
    // A project names two things, and the second colon is what says which is
    // which: `project:backend:billing` is billing of backend.
    if (named[1] === 'project') {
      const cut = rest.indexOf(':');
      if (cut === -1 || rest.slice(0, cut) === '' || rest.slice(cut + 1) === '') {
        throw wrong('scope', `names a team and a project on either side of the second colon, and that body has ${said(scope)}`);
      }
    }
    else if (rest === '') {
      throw wrong('scope', `names somebody after its ${named[1]}:, and that body has ${said(scope)}`);
    }
  }

  if (!KINDS.includes(held.kind as PolicyKind)) {
    throw wrong('kind', `is one of ${KINDS.join(', ')}, and that body has ${said(held.kind)}`);
  }
  const kind = held.kind as PolicyKind;

  if (!EFFECTS.includes(held.effect as Policy['effect'])) {
    throw wrong('effect', `is one of ${EFFECTS.join(', ')}, and that body has ${said(held.effect)}`);
  }

  const raw = held.match;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw wrong('match', `is an object with one list per value type, and that body has ${said(raw)}`);
  }
  for (const key of Object.keys(raw)) {
    if (!(VALUES as readonly string[]).includes(key)) {
      throw wrong('match', `is written with ${VALUES.join(', ')}; that body has ${said(key)}`);
    }
  }
  const match: PolicyMatch = {};
  for (const key of VALUES) {
    // A type this kind does not take is dropped rather than refused here: the
    // refusal for it names the kind, and is one line below.
    if (!MATCHES[kind].includes(key)) {
      if (valuesOf(raw as PolicyMatch, key) !== undefined) {
        throw wrong('match', `takes ${MATCHES[kind].join(', ')} on a ${kind} policy, and that body has ${key}`);
      }
      continue;
    }
    const values = valuesOf(raw as PolicyMatch, key);
    if (values !== undefined) match[key] = values;
  }

  let limits: PolicyLimit[] | undefined;
  if (held.limits !== undefined && held.limits !== null) {
    if (!Array.isArray(held.limits)) throw wrong('limits', `is a list of limits, and that body has ${said(held.limits)}`);
    limits = (held.limits as unknown[]).map((one, index) => limitOf(one, kind, index));
  }

  const from = edgeOf(held.from, 'from');
  const until = edgeOf(held.until, 'until');
  if (from !== undefined && until !== undefined && from > until) {
    throw wrong('from', 'is before the until the row names, and that body has them the other way round');
  }

  if (typeof held.pool !== 'undefined' && typeof held.pool !== 'string') {
    throw wrong('pool', 'is a name rows share a total under');
  }
  if (typeof held.cap !== 'undefined' && typeof held.cap !== 'boolean') throw wrong('cap', 'is true or false');

  return {
    id,
    scope: scope as Policy['scope'],
    kind,
    effect: held.effect as Policy['effect'],
    match,
    ...(limits === undefined ? {} : { limits }),
    ...(typeof held.pool === 'string' ? { pool: held.pool } : {}),
    ...(typeof held.cap === 'boolean' ? { cap: held.cap } : {}),
    ...(from === undefined ? {} : { from }),
    ...(until === undefined ? {} : { until }),
  };
}

/**
 * The store, over one map and one way of writing it.
 *
 * An id is unique across the store because the map is keyed by it: a second
 * `put` under one id is the row being edited, and the store never holds two
 * rows behind one address. A file that does is refused when it is read, where
 * the collision can be reported rather than silently resolved.
 */
const store = (held: Map<string, Policy>, save: () => void): Policies => ({
  list: async () => [...held.values()],
  get: async (id) => held.get(id),
  put: async (policy) => {
    const row = checkPolicy(policy);
    held.set(row.id, row);
    save();
    return row;
  },
  remove: async (id) => {
    if (!held.delete(id)) return false;
    save();
    return true;
  },
});

/** What the policies file holds. */
interface Saved {
  version: number;
  policies: Policy[];
}

export interface FilePoliciesOptions {
  /** The file every row lives in, in the daemon's config folder. */
  file: string;
  /** Somewhere to say that a row could not be kept or one could not be read. */
  onProblem?(message: string): void;
}

/**
 * Policies in one JSON file.
 *
 * Read once at construction, because a daemon reads one small file at startup
 * and never again. A row that is not a policy is reported and skipped rather
 * than failing the read, so one bad line does not lose every other row; a file
 * that is not there is a first run.
 */
export function filePolicies(options: FilePoliciesOptions): Policies {
  const file = options.file;
  const told = (message: string): void => { options.onProblem?.(message); };
  const held = new Map<string, Policy>();

  /** Every row the file holds, and one refusal for each that is not one. */
  const load = (): void => {
    const read = readJson(file);
    if (!read.ok) {
      // Not there yet, which is what a first run looks like.
      if (read.kind === 'missing') return;
      // A file that could not be opened is said with what the system call
      // answered, which is the sentence it has always been said with.
      if (read.kind === 'unreadable') {
        told(`Could not read ${file}: ${read.error instanceof Error ? read.error.message : String(read.error)}`);
        return;
      }
      told(`${file} is not JSON; this host starts with no policies.`);
      return;
    }
    const parsed = read.value;
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as Saved).policies)) {
      told(`${file} holds no policies list; this host starts with no policies.`);
      return;
    }
    for (const [index, one] of (parsed as Saved).policies.entries()) {
      let row: Policy;
      try { row = checkPolicy(one); }
      catch (error) {
        told(`Skipping policy ${String(index + 1)} of ${file}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      // Two rows behind one id are two bodies behind one address. The first is
      // the one kept and the second is said, because a file written by hand is
      // where that happens and nothing else will say it.
      if (held.has(row.id)) {
        told(`Skipping policy ${String(index + 1)} of ${file}: ${row.id} is already one of the policies above it.`);
        continue;
      }
      held.set(row.id, row);
    }
  };

  const save = (): void => {
    const body: Saved = { version: 1, policies: [...held.values()] };
    try {
      // Owner-only, as the daemon's own records are: this names who may use
      // what, and that is not everybody's business on a host with more than
      // one person on it.
      writeJsonAtomic(file, body);
    }
    catch (error) {
      told(`Could not write ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  load();
  return store(held, save);
}

/**
 * The policies of a host that keeps none between runs.
 *
 * The whole store rather than half of one, and it goes when the process does:
 * a store that outlives a restart is `filePolicies` or a plugin's.
 */
export const memoryPolicies = (): Policies => store(new Map<string, Policy>(), () => {});