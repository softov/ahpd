/**
 * What the host records about the work it did, and what a pool has been charged.
 *
 * Two kinds of record share one base and one port: model use, written by the
 * proxy and by the agent meter, and computer time - decision
 * `usage-and-computer-time-are-two-records-behind-one-port`. The base says
 * who, where and what it cost, so a listing by agent or computer is a filter
 * and never a join.
 *
 * Nothing here enforces anything. The pools a record names are opaque keys;
 * what a pool means belongs to the policy plan.
 */

/**
 * Who a piece of work belongs to - decision `work-is-owned-by-a-typed-reference`.
 *
 * `root:<host>` is a root connection on the named daemon, and `plugin:<name>` is
 * a plugin acting on its own host as the principal it was configured as - a
 * plugin is not a person, so its work is nobody's but its own. Decision
 * `plugin-contributes-host-options`.
 */
export type Owner = `user:${string}` | `team:${string}` | `project:${string}` | `root:${string}` | `plugin:${string}`;

/** What a record cost, and whether the provider said it or a price list did. */
export interface Cost {
  /** The amount, in `currency`. */
  amount: number;
  /** How the amount is denominated. `usd` is the one `UsageTotal` reports. */
  currency: string;
  /** `harness` when the agent or provider reported it, `price` when worked out from a price list. */
  from: 'harness' | 'price';
  /** What the tokens sent cost, in `currency`, when the amount was reported in two parts. */
  input?: number;
  /** What the tokens received cost, in `currency`, when the amount was reported in two parts. */
  output?: number;
}

/** The fields every record has. */
export interface UsageBase {
  /** ISO 8601: when the call was made, or when the computer was taken. */
  at: string;
  /** What wrote the record. */
  source: 'proxy' | 'agent' | 'computer';
  /** Who the work belongs to; absent on a host with no users directory. */
  owner?: Owner;
  /** The team it is charged under. */
  team?: string;
  /** The project it is charged under. */
  project?: string;
  /** The session it belongs to. */
  session?: string;
  /** The chat within the session. */
  chat?: string;
  /** The turn. */
  turn?: string;
  /** The agent provider that ran it. */
  agent?: string;
  /** The computer it ran on, as the `computers` port names it. */
  computer?: string;
  /** What its pools are charged, when that is known. */
  cost?: Cost;
  /** What the provider or the harness reported it cost, when it reported one. */
  providerCost?: Cost;
  /** The pools it is charged to. A record naming none is charged nowhere. */
  pools: string[];
}

/** The model a call ran on, and the tokens it used. */
export interface ModelCall {
  /** `<maker>/<name>` - decision `a-model-is-named-by-its-maker-and-runs-on-a-provider`. */
  name: string;
  /** Where it ran, such as `openrouter` or `anthropic`. */
  provider?: string;
  /** Prompt tokens. */
  input?: number;
  /** Tokens written back. */
  output?: number;
  /** Prompt tokens read from and written to the provider's cache. */
  cache?: { read?: number; write?: number };
}

/** One model call. */
export interface ModelUse extends UsageBase {
  kind: 'model';
  model: ModelCall;
}

/** One stretch a computer was up, charged to the machine's owner. */
export interface ComputerTime extends UsageBase {
  kind: 'computer';
  computer: string;
  /** How long, from `at`. */
  seconds: number;
}

/** One record, of either kind. */
export type UsageEntry = ModelUse | ComputerTime;

/**
 * What a pool has been charged over a period.
 *
 * A measure nothing was charged in is absent. `tokens` is `input` and `output`
 * and `cache` added together. `usd` adds only costs in US dollars, and
 * `providerUsd` is what the providers reported beside it.
 */
export interface UsageTotal {
  /** Cost in US dollars, which is what the pools are charged. */
  usd?: number;
  /** What the providers reported, in US dollars, beside the charge. */
  providerUsd?: number;
  /** What the tokens sent cost, in US dollars, over the records that split their cost. */
  inputUsd?: number;
  /** What the tokens received cost, in US dollars, over the records that split their cost. */
  outputUsd?: number;
  /** Tokens, cache included. */
  tokens?: number;
  /** Prompt tokens. */
  input?: number;
  /** Tokens written back. */
  output?: number;
  /** Prompt tokens read from and written to the provider's cache. */
  cache?: number;
  /** Model calls. */
  calls?: number;
  /** Computer time, in hours. */
  hours?: number;
}

/**
 * Where the host keeps usage, and what a pool has been charged - decision
 * `the-usage-store-answers-live-totals`.
 */
export interface Usage {
  /**
   * Keep one record and add it to every pool it names.
   *
   * Settles once written, so a total read after it includes it. Records from
   * concurrent callers never interleave and none is lost.
   */
  record(entry: UsageEntry): Promise<void>;
  /**
   * What one pool was charged between `from` and `until` (ISO 8601).
   *
   * A pool nothing was charged to answers an empty total. A store keeping
   * totals per day counts a partly covered day whole.
   */
  total(pool: string, from: string, until: string): Promise<UsageTotal>;
  /**
   * Every pool any record names, sorted and without a repeat.
   *
   * The store is the only place that can answer it: a pool may name a person
   * who has been taken out of the users file, or `root:<host>`, and neither is
   * anywhere else. A folder holding no usage files answers `[]`, which is a
   * store with nothing in it rather than a refusal.
   */
  pools(): Promise<string[]>;
  /**
   * The records charged to one pool between `from` and `until` (ISO 8601),
   * newest first.
   *
   * A record naming two pools is under both, and one naming none under
   * neither. The range is compared at the day, as `total` compares it, so the
   * records behind a period's total are the records that total summed. A bound
   * left out is the first day of the current month and now, and at most the
   * newest 200 records are answered.
   */
  records(pool: string, from?: string, until?: string): Promise<UsageEntry[]>;
  /**
   * What the records between `from` and `until` (ISO 8601) were charged,
   * summed by the keys in `by` - decision `usage-is-grouped-by-the-host`.
   *
   * One row per distinct set of key values, each record counted once however
   * many pools it is charged to. `keep` is asked with a record's pools, and a
   * record it refuses is in no row. The range is compared at the day, as
   * `records` compares it.
   */
  groups(
    by: readonly UsageKey[],
    from: string,
    until: string,
    keep: (pools: readonly string[]) => boolean,
  ): Promise<UsageGroup[]>;
}

/**
 * What a grouped total is summed by.
 *
 * `user` is the record's owner, `team` its `team:` pool and `project` its
 * `project:` pool, each spelled as the pool key it is charged under.
 */
export type UsageKey = 'user' | 'team' | 'project';

/** One row of a grouped total. */
export interface UsageGroup {
  /**
   * The pool key of each key asked for. A key the records had none of, such as
   * the project of team work, is absent.
   */
  keys: Partial<Record<UsageKey, string>>;
  /** What those records were charged. */
  total: UsageTotal;
}
