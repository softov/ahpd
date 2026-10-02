/**
 * What a turn used, kept against it and written as one `ModelUse`.
 *
 * The host sees every `chat/usage` a backend reports and every action that
 * ends a turn, which is everything a record needs.
 *
 * Every harness reports a turn's usage as a running sum: each report repeats
 * and grows what the turn has used so far, so the last one before the turn
 * ended is the turn's total, and that is what one record per turn holds. Per
 * report, the earlier sum is taken off instead and each report's own addition is
 * written as it arrives - decision
 * `the-agent-meter-writes-per-turn-or-per-report`.
 *
 * A worker is not counted twice, and not here. A harness that runs subagents
 * inside one turn - Claude Code, which counts every call the turn's main agent
 * and its subagents made into the turn's own sum - reports the whole of it on
 * the turn that delegated it, and its worker chats carry no report of their
 * own: a worker's rounds are counted into the lead's sum rather than announced
 * on the chat they were run for.
 */

import type { Bag } from './types/common.js';
import type { Scope } from './scopes.js';
import type { Cost, ModelCall, ModelUse, Owner, Usage } from './types/usage.js';

/** One running turn: when it began, the model it named, and what it last reported. */
interface Held {
  /** When the turn started, which is when its work happened. */
  at: string;
  /** The model the turn's own message named, where it named one. */
  model?: string;
  /** What the last report said, in the protocol's own spelling. */
  reported?: Bag;
  /** What the last report that has already been written said. */
  billed?: Bag;
}

/** What the meter needs to know about the work it is metering. */
export interface MeterOptions {
  /** Where the records go. */
  usage: Usage;
  /** One record per turn, or one per report. Default `turn`. */
  per?: 'turn' | 'report';
  /** Somewhere to say a record could not be kept. */
  onProblem?(message: string): void;
  /** The session every record belongs to. */
  session: string;
  /** The chat within the session. */
  chat: string;
  /** The agent provider that ran it. */
  agent: string;
  /** The machine it runs in, as `computer://<id>`, when it runs in one. */
  computer?: () => string | undefined;
  /** Who sent a turn, or nobody where this host did not start it. */
  senderOf(turn: string): Owner | undefined;
  /** Whose the session's work is, for a turn nobody sent. */
  owner(): Owner | undefined;
  /** The team and project it is charged under, where it was told one. */
  scope(): Scope | undefined;
}

/** What the host tells the meter about the actions a backend sends. */
export interface Meter {
  /** A turn began. */
  started(turn: string, at: string, model?: string): void;
  /** A turn reported what it had used so far. */
  reported(turn: string, usage: Bag): void;
  /** A turn ended, however it ended. */
  ended(turn: string): void;
}

/** A count a report carried, or nothing: a number it did not report is not a zero. */
const counted = (value: unknown): number | undefined =>
  (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * The `_meta` a report carried, read field by field.
 *
 * The protocol names no field for cache writes or for what a turn cost, so
 * every harness rides them in `_meta` rather than dropping them: cofold,
 * Claude Code and pi as `{ amount, currency }`, ACP as whatever currency the
 * agent answered in.
 */
const metaOf = (usage: Bag): Bag => {
  const meta = usage._meta;
  return typeof meta === 'object' && meta !== null ? meta as Bag : {};
};

/**
 * What a harness reported it cost, in the record's own spelling.
 *
 * Kept only as the harness said it - decision
 * `usage-and-computer-time-are-two-records-behind-one-port` - because what a
 * call cost in dollars is worked out from a price list, which is a later plan.
 * The currency is lowercased, because every harness spells US dollars in caps
 * and a total is summed by what its own store reads the currency as.
 */
const costOf = (usage: Bag): Cost | undefined => {
  const cost = metaOf(usage).cost;
  if (typeof cost !== 'object' || cost === null) return undefined;
  const { amount, currency } = cost as Bag;
  const paid = counted(amount);
  if (paid === undefined || typeof currency !== 'string' || currency === '') return undefined;
  return { amount: paid, currency: currency.toLowerCase(), from: 'harness' };
};

/** What one report said it used, without the name of the model, which is the turn's. */
const usedBy = (usage: Bag): Omit<ModelCall, 'name'> => {
  const input = counted(usage.inputTokens);
  const output = counted(usage.outputTokens);
  const read = counted(usage.cacheReadTokens);
  const write = counted(metaOf(usage).cacheWriteTokens);
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(read === undefined && write === undefined
      ? {}
      : { cache: { ...(read === undefined ? {} : { read }), ...(write === undefined ? {} : { write }) } }),
  };
};

/** One count as it grew since the report before, and nothing where this one has none. */
const growth = (key: string, now: unknown, before: unknown): Bag => {
  const value = counted(now);
  if (value === undefined) return {};
  const earlier = counted(before);
  return { [key]: earlier === undefined || value < earlier ? value : value - earlier };
};

/**
 * What one report added since the turn's one before it.
 *
 * A report is what the turn has spent rather than what this round spent, so the
 * earlier sum is taken off to leave the round, and a count that is where it was
 * leaves a round that spent none of it. A count that came down - a harness that
 * recounted, or a cache it read again - is written as the value it is now,
 * since there is no round behind a smaller sum. A count this report left out is
 * left out here too, because what is not reported is not a zero.
 */
const addition = (now: Bag, before: Bag | undefined): Bag => {
  if (before === undefined) return now;
  const cost = costOf(now);
  const paid = costOf(before);
  const meta: Bag = {
    ...growth('cacheWriteTokens', metaOf(now).cacheWriteTokens, metaOf(before).cacheWriteTokens),
    ...(cost === undefined ? {} : {
      cost: { ...cost, ...growth('amount', cost.amount, paid?.currency === cost.currency ? paid.amount : undefined) },
    }),
  };
  return {
    ...(typeof now.model === 'string' ? { model: now.model } : {}),
    ...growth('inputTokens', now.inputTokens, before.inputTokens),
    ...growth('outputTokens', now.outputTokens, before.outputTokens),
    ...growth('cacheReadTokens', now.cacheReadTokens, before.cacheReadTokens),
    ...(Object.keys(meta).length === 0 ? {} : { _meta: meta }),
  };
};

/**
 * The pools one record is charged to - decision
 * `agent-usage-is-charged-to-owner-team-and-project-pools`.
 *
 * Each is named only when the record has it, so work with no owner and no scope
 * is charged to no pool rather than to one whose name says nothing. A project
 * pool is told from a team pool by its prefix, never by counting colons.
 */
const poolsOf = (owner: Owner | undefined, scope: Scope | undefined): string[] => [
  ...(owner === undefined ? [] : [owner]),
  ...(scope === undefined ? [] : [`team:${scope.team}`]),
  ...(scope?.project === undefined ? [] : [`project:${scope.team}:${scope.project}`]),
];

/** How many ended turns are remembered, so that many late reports can be metered no further. */
const ENDS_KEPT = 1024;

/**
 * The meter for one session's chat.
 *
 * Every turn is held by its turn id and let go of when the turn ends, whatever
 * it cost, so a long-running daemon keeps a running sum only for the turns that
 * are still running. The name is not known here: the report says which model it
 * was, and the turn says which one it asked for, and neither may say anything at
 * all.
 *
 * `per` says whether the turn is written once, when it ends, or each of its
 * reports is written as it arrives. Both modes bill the same work, and both
 * meter a report from a turn that never said it began, which is metered from
 * the report alone because it is all this host was told.
 */
export const meter = (options: MeterOptions): Meter => {
  const running = new Map<string, Held>();
  /*
   * The turns this host saw end, so a report that arrives after the fact is not
   * metered a second time. Only ids are kept and only as many as the cap holds,
   * since a daemon that ran all day would otherwise grow this for every turn it
   * ever ran. Forgetting an id costs a double count, and only for a report that
   * arrives after it was forgotten.
   */
  const finished = new Set<string>();

  /** One turn's record, written and left to settle behind the port. */
  const write = (turn: string, held: Held): void => {
    const owner = options.senderOf(turn) ?? options.owner();
    const scope = options.scope();
    const computer = options.computer?.();
    const reported = held.reported ?? {};
    const name = typeof reported.model === 'string' ? reported.model : held.model;
    const cost = costOf(reported);
    const entry: ModelUse = {
      at: held.at,
      kind: 'model',
      source: 'agent',
      ...(owner === undefined ? {} : { owner }),
      ...(scope === undefined ? {} : { team: scope.team, ...(scope.project === undefined ? {} : { project: scope.project }) }),
      session: options.session,
      chat: options.chat,
      turn,
      agent: options.agent,
      ...(computer === undefined ? {} : { computer }),
      model: { ...usedBy(reported), name: name ?? '' },
      ...(cost === undefined ? {} : { cost }),
      pools: poolsOf(owner, scope),
    };
    void options.usage.record(entry).catch((error: unknown) => {
      options.onProblem?.(`${options.session}: could not keep what ${turn} used: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  return {
    started: (turn, at, model) => {
      // A turn id begun again was never ended, whatever ended under it before.
      finished.delete(turn);
      running.set(turn, { at, ...(model === undefined ? {} : { model }) });
    },
    reported: (turn, usage) => {
      const held = running.get(turn);
      if (held === undefined) {
        /*
         * A report for a turn this host saw end is metered no further: the turn
         * was written when it ended, so billing the report as well would charge
         * for the same work twice. It is not held either, since there is nothing
         * left to write it and nothing that would ever forget it.
         */
        if (finished.has(turn)) return;
        /*
         * A backend that reported without saying the turn began is metered
         * from the report, which is the only thing this host was told about it,
         * and from the moment it reported, because nothing said when the turn
         * started.
         */
        const unannounced: Held = { at: new Date().toISOString(), reported: usage };
        running.set(turn, unannounced);
        /*
         * Per report, this report is one like any other and is written as it
         * arrived. Waiting for an ending would write nothing at all where the
         * turn never says it ended, and it is held afterwards as well, so the
         * reports that follow this one are what they added.
         */
        if (options.per === 'report') {
          write(turn, unannounced);
          unannounced.billed = usage;
        }
        return;
      }
      held.reported = usage;
      if (options.per !== 'report') return;
      write(turn, { ...held, reported: addition(usage, held.billed) });
      held.billed = usage;
    },
    ended: (turn) => {
      finished.add(turn);
      if (finished.size > ENDS_KEPT) finished.delete(finished.values().next().value as string);
      const held = running.get(turn);
      if (held === undefined) return;
      running.delete(turn);
      // Every report has been written for already, so a turn's end writes
      // nothing more.
      if (options.per === 'report') return;
      // A turn that reported nothing used nothing this host knows of, and a
      // record of zeroes would be a turn that charged a pool for a call it
      // never made.
      if (held.reported === undefined) return;
      write(turn, held);
    },
  };
};