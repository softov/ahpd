/**
 * Whether a version satisfies a range, read as npm reads it.
 *
 * A plugin declares the `@ahpd/sdk` it was built against as
 * `peerDependencies["@ahpd/sdk"]`, and this is what reads that declaration
 * when npm did not: a plugin named as a path never went through an installer,
 * and one named by an installed package cannot be assumed to have been checked
 * either. A range is written in npm's grammar, so it is read by node-semver,
 * the reader npm itself reads it with
 * (https://github.com/npm/node-semver#ranges): `||` unions, hyphen ranges,
 * x-ranges, `^`, `~` and the comparators, with its own rule for prereleases.
 *
 * A range node-semver cannot read is refused by name rather than passed, so
 * the worst case is a plugin that must be spelled differently and not one that
 * loads unchecked.
 */

import { satisfies as satisfiedBy, valid, validRange } from 'semver';

/** Does `version` satisfy `range`? Throws, naming the range, for one npm could not read. */
export const satisfies = (version: string, range: string): boolean => {
  if (valid(version) === null) throw new Error(`version ${version} is not one this daemon can read`);
  if (validRange(range) === null) throw new Error(`range ${range} is not one npm can read`);
  return satisfiedBy(version, range);
};
