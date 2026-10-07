/** The patterns a person picks from, as rules they may change the numbers in. */

import type { Bag } from './types/common.js';
import type { SessionRule } from './types/triggers.js';

/**
 * One preset: a rule somebody already thought about, with its numbers left to
 * the person who picks it.
 *
 * A preset is not a kind of rule - it builds one of the same `SessionRule`s a
 * person could have written by hand, and the host treats it as exactly that.
 * What it saves is knowing which numbers make a useful rule, and what it costs
 * is that the numbers have to be readable as a form, so they are numbers and
 * durations rather than a rule written out.
 */
export interface TriggerPreset {
  /** The event id under the `watch` trigger type. */
  id: string;
  /** What a client shows in the list. */
  title: string;
  /** One line saying when this fires. */
  description: string;
  /** The numbers the rule is written with, and what each starts as. */
  numbers: { key: string; title: string; value: number }[];
  /** The rule those numbers make, with any filter the person set. */
  rule(config: Bag): SessionRule;
}

/** A number the person set, or the one this preset is written with. */
const count = (config: Bag, key: string, fallback: number): number => {
  const given = config[key];
  return typeof given === 'number' && Number.isFinite(given) ? given : fallback;
};

/** The sessions a preset was narrowed to, where it was narrowed at all. */
const narrow = (config: Bag): Pick<SessionRule, 'filter'> => {
  const filter = config.filter;
  return typeof filter === 'object' && filter !== null && !Array.isArray(filter)
    ? { filter: filter as NonNullable<SessionRule['filter']> }
    : {};
};

/**
 * The five presets, in the order a client lists them.
 *
 * Every one of them is a rule somebody could have written by hand, and the
 * patterns run from the loudest to the quietest: repeated calls, failing calls,
 * a turn that says nothing for a while, a session that went quiet after a
 * failure, and a message waiting behind a busy turn.
 */
export const WATCH_PRESETS: TriggerPreset[] = [
  {
    id: 'looks-stuck',
    title: 'Looks stuck',
    description: 'The same tool called with the same input several times.',
    numbers: [{ key: 'times', title: 'Times', value: 3 }],
    rule: (config) => ({
      on: 'toolCalled',
      count: { n: count(config, 'times', 3), sameInput: true },
      ...narrow(config),
    }),
  },
  {
    id: 'failing-tools',
    title: 'Failing tools',
    description: 'Tool calls failing one after another.',
    numbers: [{ key: 'times', title: 'Times', value: 3 }],
    rule: (config) => ({
      on: 'toolFailed',
      count: { n: count(config, 'times', 3), consecutive: true },
      ...narrow(config),
    }),
  },
  {
    id: 'long-silent-turn',
    title: 'Long silent turn',
    description: 'A turn still running with nothing happening for a while.',
    numbers: [{ key: 'minutes', title: 'Minutes', value: 10 }],
    rule: (config) => ({
      on: 'turnCompleted',
      when: { turnLongerThan: `${count(config, 'minutes', 10)}m` },
      ...narrow(config),
    }),
  },
  {
    id: 'idle-after-failure',
    title: 'Idle after failure',
    description: 'A turn failed and the session went quiet after it.',
    numbers: [{ key: 'minutes', title: 'Minutes of quiet', value: 3 }],
    rule: (config) => ({
      on: 'turnFailed',
      then: { kind: 'idle', for: `${count(config, 'minutes', 3)}m` },
      ...narrow(config),
    }),
  },
  {
    id: 'waiting-while-busy',
    title: 'Waiting while busy',
    description: 'A message queued behind a turn that has already run several tool calls.',
    numbers: [{ key: 'toolCalls', title: 'Tool calls in the turn', value: 3 }],
    rule: (config) => ({
      on: 'messageQueued',
      when: { running: true, toolCallsAtLeast: count(config, 'toolCalls', 3) },
      ...narrow(config),
    }),
  },
];

/** The preset an event id names, or nothing where it names none. */
export const presetById = (id: string): TriggerPreset | undefined =>
  WATCH_PRESETS.find((one) => one.id === id);
