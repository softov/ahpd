---
title: A target is judged where it resolves, and nothing above the session's folder is reached
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L107-L136](../../../../packages/sdk/src/changes.ts#L107-L136) - `settled` and `pathIn`"
  - "[code://packages/sdk/src/changes.ts#L995-L1006](../../../../packages/sdk/src/changes.ts#L995-L1006) - the refusal every resource-scoped operation shares"
---

## Objective

A resource target is decoded and normalised before it is judged, so `..`, a percent-escaped `..` or a symlink cannot name anything above the changeset's folder, for `discard`, `revert` and the operations task 02 adds; the folder itself is a valid target.

## Files

- `UPDATE: packages/sdk/src/changes.ts:107-136` - `settled` and `pathIn`.
- `UPDATE: packages/sdk/src/changes.ts:995-1006` - the path handed on is the contained, relative one, `.` for the folder itself.
- `UPDATE: packages/sdk/test/commit.test.ts` - the cases below.

## Steps

1. Parse the target with `fileURLToPath`, which decodes it, then `resolve` it; for a path that exists, follow symlinks with `realpath` on it and on the folder; for one that does not, on its nearest existing ancestor.
2. Inside means the relative path from the folder does not start with `..` and is not absolute; the folder itself is `.`.
3. Refuse anything else with the sentence the code has now.
4. `discard` and `revert` keep what they do for a file; a folder target for them is refused as not a file, since this plan does not change what they mean.

## Validation

- In a scratch repository whose session folder is a subdirectory `sub/`, `discard` on `file://<repo>/sub/../top.txt` and on `file://<repo>/sub/%2E%2E/top.txt` is refused and `top.txt` keeps its change.
  Today the first reaches `git restore`.
- A symlink inside `sub/` pointing at `top.txt` is refused.
- A file inside `sub/` is discarded as today.
- `pnpm typecheck` and `node_modules/.bin/vitest run packages/sdk` green.

## Resume

Implemented 2026-09-27. `pathIn` decodes the URI with `fileURLToPath`, resolves it, and compares it with `relative` against the directory after both go through `settled`, which is `realpath` on the path or on its nearest existing ancestor with the rest appended. The result is the contained, relative path, `.` for the folder itself, and `undefined` otherwise; `invoke` refuses `undefined` with the sentence it already had. A folder target is refused for `discard` and `revert` with "That operation takes one file, not a folder."

What failed first, in `commit.test.ts`: `discard` on `file://<repo>/sub/../top.txt` resolved with `Discarded ../top.txt` instead of rejecting, and `discard` on the folder `file://<repo>/sub` resolved with `Discarded ` instead of refusing. After the change both reject, the decoded `%2E%2E` form rejects, and the symlink `sub/link.txt` pointing at `top.txt` rejects, while `top.txt` keeps its change and `sub/inside.txt` still discards. The scratch repository has the session folder `sub/` as a subdirectory, so `../top.txt` is inside git. `commit.test.ts` is 12 of 12 green before the task 02 cases were added, and 17 of 17 after.

Building the tests first needed the generic `operate` helper in `commit.test.ts`, which is a departure from the task's Files but not from its behaviour.

Review 2026-09-27: `pathIn` returned the path with symlinks followed, so `stage` or `discard` on a link inside the folder acted on the file it points at. It now requires both the written and the resolved path to be inside and answers the written one. The case "stages a link inside the folder as the link, not the file it points at" failed on the old answer (`sub/inside.txt` staged) and passes now.
