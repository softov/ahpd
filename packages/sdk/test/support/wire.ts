/*
 * The protocol's own check over the frames a host sends, less the two
 * departures this host keeps on purpose, each recorded in `docs/sdk/AHP.md`.
 *
 * A session summary goes out with `activity: null` where the declaration says
 * `string`, so a client can clear a row that has gone quiet: a partial is
 * spread over the row the client holds, so a key left off is a field that did
 * not move, and an idled row kept saying what its last tool was doing. The
 * reference host sends the same and its client reads the `null` as cleared.
 * `docs/sdk/AHP.md` records it under `root/sessionSummaryChanged`.
 *
 * A config property a chat may set for itself says `chatMutable`, as VS Code's
 * agents' schemas mark one, a key the property schema of AHP v1.0.0 leaves
 * out. `docs/sdk/AHP.md` records it under `resolveSessionConfig`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostSchema.ts#L309
 *
 * Neither is a finding a suite should have to write down twice.
 *
 * Not a test file. `vitest` collects `*.test.ts`, and this is imported by the
 * suites that are.
 */

import { checker } from '../../../../tools/wire.mjs';

/** The summary's cleared activity, as the check words it. */
const KEPT = 'SessionSummaryChangedParams /changes/activity type must be string';

/** Everything these frames say that the protocol does not declare, one line each. */
export const undeclaredIn = (frames: unknown[]): string[] => {
  const check = checker();
  return frames
    .flatMap((frame) => check.frame(frame))
    .filter((one) => !(one.what === 'undeclared key `chatMutable`' && one.at.split('/').at(-2) === 'properties'))
    .map((one) => `${one.def} ${one.at} ${one.what}`)
    .filter((one) => one !== KEPT);
};
