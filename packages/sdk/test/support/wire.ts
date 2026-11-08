/*
 * The protocol's own check over the frames a host sends, minus the departures
 * this host keeps on purpose, each recorded in `docs/sdk/AHP.md` under "What is
 * served outside the protocol":
 *
 * - A session summary goes out with `activity: null` where the declaration
 *   says `string`, so a client can clear a row that has gone quiet: a partial
 *   is spread over the row the client holds, so a key left off is a field that
 *   did not move, and an idled row kept saying what its last tool was doing.
 *   The reference host sends the same and its client reads the `null` as
 *   cleared.
 * - A config property a chat may set for itself says `chatMutable`, and a
 *   chat's state carries the values it set as its `config`: VS Code's per-chat
 *   config, which its window reads to send a chat's value as
 *   `chat/configChanged`.
 *
 * These are the findings a suite should not have to write down twice.
 *
 * Not a test file. `vitest` collects `*.test.ts`, and this is imported by the
 * suites that are.
 */

import { checker } from '../../../../tools/wire.mjs';

/** Whether a finding is one of the departures this host sends anyway. */
const kept = (one: { def: string; at: string; what: string }): boolean =>
  `${one.def} ${one.at} ${one.what}` === 'SessionSummaryChangedParams /changes/activity type must be string'
  || one.what === 'undeclared key `chatMutable`'
  || (one.def === 'ChatState' && one.at === '/' && one.what === 'undeclared key `config`');

/** Everything these frames say that the protocol does not declare, one line each. */
export const undeclaredIn = (frames: unknown[]): string[] => {
  const check = checker();
  return frames
    .flatMap((frame) => check.frame(frame))
    .filter((one) => !kept(one))
    .map((one) => `${one.def} ${one.at} ${one.what}`);
};
