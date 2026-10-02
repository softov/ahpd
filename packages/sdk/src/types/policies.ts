/**
 * What a policy says: which agents, models and computers each person, team,
 * project or everyone may use, and how much of each.
 *
 * One row, one store, three kinds. `model` is the proxy - a model call from
 * somebody's own tool - and the models an agent may use are part of the
 * `agent` policy, because an agent is a harness ahpd runs rather than a call
 * somebody made - decision `an-agent-is-not-a-proxy`.
 *
 * **Two pools, one word.** A limit's `pool` says whether a group shares one
 * total (`shared`) or every member has their own (`each`); a row's own `pool`
 * is a name several rows draw from one total under. They are different things
 * under one word, so both are spelled out here.
 *
 * Nothing here enforces anything. `pool`, `cap` and `limits` are stored and
 * read by nobody.
 */

/** What a row is about: the proxy's model calls, a harness, or a machine. */
export type PolicyKind = 'model' | 'agent' | 'computer';

/** Whether a row allows or refuses. Any matching deny wins over any allow. */
export type PolicyEffect = 'allow' | 'deny';

/**
 * Who a row is about.
 *
 * `all` is everyone and behaves like any other scope; the rest name one person,
 * one team, or one project of one team.
 */
export type PolicyScope = 'all' | `user:${string}` | `team:${string}` | `project:${string}:${string}`;

/** One value type a `match` may hold. */
export type PolicyValueType = 'model' | 'proxy' | 'agent' | 'computer';

/**
 * What a row applies to, as one list per value type.
 *
 * Values of one type are alternatives and values of different types must all
 * hold, which is what a record of lists says without a reader parsing
 * prefixes. A type left out is unconstrained, so a `model` row naming no
 * `proxy` allows any provider.
 */
export interface PolicyMatch {
  /** `<maker>/<name>`, as a model is named. */
  model?: string[];
  /** Which proxy provider the model may be called through. */
  proxy?: string[];
  /** The harness, as `claude`, `pi`, `cofold` or `acp:<server>`. */
  agent?: string[];
  /** The machine, as the `computers` port names it. */
  computer?: string[];
}

/** What one limit is counted in. Which of them a row may name depends on its kind. */
export type Measure = 'usd' | 'tokens' | 'calls' | 'turns' | 'hours' | 'sessions';

/** The window a limit is counted over. `total` is one sum over the whole window. */
export type Period = 'day' | 'week' | 'month' | 'total';

/** Whether a group shares one total or every member has their own. */
export type LimitPool = 'shared' | 'each';

/**
 * One limit on a row.
 *
 * A row has room only while every one of its limits has room, and whichever is
 * reached first closes it whatever its unit. Several limits on one row - a day,
 * a week and a month - are the ordinary case, and none of them is enforced yet.
 */
export interface PolicyLimit {
  /** How much, in `measure`. Never negative. */
  amount: number;
  /** What it is counted in; it has to be one of the measures of the row's kind. */
  measure: Measure;
  /** The window it is counted over. */
  period: Period;
  /** Whether a group shares this total or every member has their own. */
  pool: LimitPool;
}

/** One policy, as an operator wrote it. */
export interface Policy {
  /** A name for the row, unique across the store: `policy://<id>` is one address. */
  id: string;
  /** Who the row is about. */
  scope: PolicyScope;
  /** What the row is about. */
  kind: PolicyKind;
  /** Whether the row allows or refuses. */
  effect: PolicyEffect;
  /** What the row applies to. */
  match: PolicyMatch;
  /** How much may be used. Absent or empty means unlimited. */
  limits?: PolicyLimit[];
  /** A name several rows draw from one total under. Nothing enforces it yet. */
  pool?: string;
  /** Whether the row counts and never pays. Nothing enforces it yet. */
  cap?: boolean;
  /** ISO 8601: when the row starts. Absent means it is already valid. */
  from?: string;
  /** ISO 8601: when the row ends. Absent means no expiry. */
  until?: string;
}

/**
 * Where a host keeps its policies - decision
 * `policies-are-a-scheme-clients-edit`.
 *
 * The port, and not the file, is what a plugin takes: a sqlite or a postgresql
 * several daemons share answers the same four calls from the same rows.
 */
export interface Policies {
  /** Every row, in the order the store holds them. */
  list(): Promise<Policy[]>;
  /** One row by id, or nothing when the store holds none. */
  get(id: string): Promise<Policy | undefined>;
  /**
   * Name a row, or edit the one already there.
   *
   * A body that is not a row is refused here, with the field that is wrong.
   * A different row already under this id is refused as well: two bodies
   * answering one address is a store whose rows cannot be read back.
   */
  put(policy: Policy): Promise<Policy>;
  /** Take a row out. `true` when one was there. */
  remove(id: string): Promise<boolean>;
}