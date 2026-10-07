/*
 * The protocol's own check over the frames a host sends, minus the one
 * departure this host keeps on purpose.
 *
 * A session summary goes out with `activity: null` where the declaration says
 * `string`, so a client can clear a row that has gone quiet: a partial is
 * spread over the row the client holds, so a key left off is a field that did
 * not move, and an idled row kept saying what its last tool was doing. The
 * reference host sends the same and its client reads the `null` as cleared.
 * `docs/AHP.md` records it under `root/sessionSummaryChanged`, and it is the
 * only finding here a suite should not have to write down twice.
 *
 * Not a test file. `vitest` collects `*.test.ts`, and this is imported by the
 * suites that are.
 */

import { checker } from '../../../../tools/wire.mjs';

/** The one finding the protocol reports that this host sends anyway. */
const KEPT = 'SessionSummaryChangedParams /changes/activity type must be string';

/** Everything these frames say that the protocol does not declare, one line each. */
export const undeclaredIn = (frames: unknown[]): string[] => {
  const check = checker();
  return frames
    .flatMap((frame) => check.frame(frame))
    .map((one) => `${one.def} ${one.at} ${one.what}`)
    .filter((one) => one !== KEPT);
};
