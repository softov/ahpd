/**
 * Whether a version satisfies a range, with no `semver` dependency.
 *
 * A plugin declares the `@ahpd/sdk` it was built against as
 * `peerDependencies["@ahpd/sdk"]`, and this is what reads that declaration
 * when npm did not: a plugin named as a path never went through an installer,
 * and one named by an installed package cannot be assumed to have been checked
 * either. The comparison is built on the version parse `update.ts` already
 * has, for the reason the update check gives - one comparison does not earn a
 * dependency.
 *
 * A range this daemon cannot read is refused by name rather than passed, so
 * the worst case is a plugin that must be spelled differently and not one that
 * loads unchecked.
 */

import { parse } from './update.js';

/** A version the reader understood. */
type Read = { numbers: [number, number, number]; prerelease: boolean };

/** The operators a range may start with, longest first so `>=` is not read as `>`. */
const OPERATORS = ['>=', '<=', '>', '<', '=', '^', '~'] as const;

/**
 * `0.6` as `0.6.0` and `0` as `0.0.0`.
 *
 * A person writes `>=0.6 <0.7` in a peer range, and the update check's reader
 * wants all three numbers; padding here is cheaper than a second reader that
 * disagrees with it.
 */
const pad = (text: string): string => {
  if (/^\d+$/.test(text)) return `${text}.0.0`;
  if (/^\d+\.\d+$/.test(text)) return `${text}.0`;
  return text;
};

/** Read one version, padded. */
const read = (text: string): Read | undefined => parse(pad(text));

/** Which of two versions is ahead, with a prerelease below its own release. */
const compare = (a: Read, b: Read): number => {
  for (let i = 0; i < 3; i++) {
    if (a.numbers[i] !== b.numbers[i]) return (a.numbers[i] as number) > (b.numbers[i] as number) ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  return a.prerelease ? -1 : 1;
};

/** The first version a `^` or `~` range does not include. */
const upper = (kind: '^' | '~', at: [number, number, number]): [number, number, number] => {
  // A tilde allows the patch to move and nothing else.
  if (kind === '~') return [at[0], at[1] + 1, 0];
  // A caret allows the leftmost non-zero number to move: `^1.2.3` is `<2.0.0`,
  // `^0.2.3` is `<0.3.0`, and `^0.0.3` is `<0.0.4`.
  if (at[0] > 0) return [at[0] + 1, 0, 0];
  if (at[1] > 0) return [0, at[1] + 1, 0];
  return [0, 0, at[2] + 1];
};

/** Whether one space-separated piece of a range holds. */
const within = (held: Read, part: string, range: string): boolean => {
  const operator = OPERATORS.find((one) => part.startsWith(one)) ?? '';
  const wanted = read(part.slice(operator.length));
  if (wanted === undefined) {
    throw new Error(`range ${range} has ${part}, which is not a version this daemon can read`);
  }
  const order = compare(held, wanted);
  if (operator === '^' || operator === '~') {
    return order >= 0 && compare(held, { numbers: upper(operator, wanted.numbers), prerelease: false }) < 0;
  }
  if (operator === '>=') return order >= 0;
  if (operator === '<=') return order <= 0;
  if (operator === '>') return order > 0;
  if (operator === '<') return order < 0;
  // An exact version, with or without the `=`.
  return order === 0;
};

/**
 * Does `version` satisfy `range`?
 *
 * Supports `*`, an exact version, `^`, `~`, `>=`, `<=`, `>`, `<`, `=`, and a
 * space-separated conjunction such as `>=0.6 <0.7`. Anything else throws,
 * naming the range, because a host that passed an unreadable range would be a
 * host that loaded a plugin it could not vouch for.
 */
export const satisfies = (version: string, range: string): boolean => {
  const held = read(version);
  if (held === undefined) throw new Error(`version ${version} is not one this daemon can read`);
  const trimmed = range.trim();
  if (trimmed === '') throw new Error('the range is empty');
  if (trimmed === '*') return true;
  return trimmed.split(/\s+/).every((part) => within(held, part, range));
};
