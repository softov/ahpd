---
title: cofold follows a link's target one name at a time, released by Softov
status: implemented
depends: [task-14-inside-follows-a-dangling-link.md]
layer: "cofold tools"
refs:
  - file:///github/cofold/packages/tools/src/paths.ts - `realPath`, which follows a link with `resolve(dirname(path), target)` and so collapses `..` before the kernel would
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L552-L602](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L552-L602) - `ROWS`, the mode table"
  - "[code://docs/PLUGINS.md#L411](../../../../docs/PLUGINS.md#L411) - the symlink sentences, which name the shape this task catches"
---

## Objective

In `@cofold/tools`, `resolveWithin` judges a link whose relative target has `..` after a symlinked directory where the kernel would put it, so `sublink -> /away/sub` with `trick -> sublink/../esc2.txt` is outside the workspace; ahpd takes the release, and its mode table asks for a write to `trick` under `acceptEdits`.

## Files

- `UPDATE: /github/cofold/packages/tools/src/paths.ts` - a link's target is walked one name at a time: `..` takes the real parent of what is resolved so far, and each other name is realpath'd or, when missing, read with `readlinkSync` and walked in turn.
- `UPDATE: /github/cofold/packages/tools/src/paths.test.ts` - the case below.
- `UPDATE: packages/agent-cofold/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` - the release.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts` - the row.

## Steps

1. In `/github/cofold/packages/tools`, walk each link target by components as above, keeping the hop limit.
2. The cofold tree holds other uncommitted work (daemon/04 task 17 in `packages/commands`); change only `packages/tools`, and commit nothing there without Softov's approval.
3. Stop when cofold's tests are green and ask Softov to publish through `release.yml`; do not tag or publish.
4. After the release: move `@cofold/tools` to it, `pnpm install --no-frozen-lockfile --store-dir /tmp/pnpm-store` once, the version in `minimumReleaseAgeExclude` if young, and add the `trick` row to `ROWS` expecting `ask`.

## Validation

- cofold `paths.test.ts`: with `ws/sublink -> <away>/sub` and `ws/trick -> sublink/../esc2.txt`, `resolveWithin(ws, 'trick').inside` is `false`. Today it is `true`.
- cofold's own run for `packages/tools` green.
- In ahpd after the release: the `trick` row answers `ask`; `node_modules/.bin/vitest run packages/agent-cofold` green.

## Resume

- 2026-09-26: steps 1 to 3 are in place in `/github/cofold/packages/tools`, uncommitted, with nothing else in cofold touched. `realPath` in `src/paths.ts` follows a dangling link through `follow`, which reads the target one name at a time from the link's real directory: `..` is the real parent of what is resolved so far and every other name is resolved by `realPath` again. The hop limit is one budget of 40 shared by every link met on the way, so a target that names a link twice cannot grow the walk.
- `src/paths.test.ts` is new, since the package had no such file: `trick -> sublink/../esc2.txt` with `sublink -> <away>/sub` is outside, as are `through -> sublink/in.txt` and a chain of two dangling links; `back -> ../ws/kept.txt` stays inside and a link to itself stops at the limit.
- Seen failing first: against the committed `paths.ts`, `resolveWithin(ws, 'trick').inside` was `true` (the `expect(...).toBe(false)` on `trick`), because `resolve(dirname(path), target)` collapsed `sublink/..` to the workspace before any name was read.
- `vitest run --project @cofold/tools` green (29 tests, no type errors) and `tsc -p tsconfig.test.json --noEmit` clean in `packages/tools`.
- Waiting on: Softov to commit the cofold change and publish `@cofold/tools` through `release.yml`. Step 4 (the version bump in ahpd and the `trick` row in `ROWS`) is not done.
- 2026-09-27: committed in cofold as `d9d229e` ("tools: follow a link's target one name at a time; 0.1.1"). Waiting on Softov to tag and publish `@cofold/tools` 0.1.1; step 4 follows the release.

- 2026-09-27: `@cofold/tools` 0.1.1 is on npm (published 15:37 UTC). Step 4: `packages/agent-cofold` takes `^0.1.1`, the lockfile resolves 0.1.1, and `minimumReleaseAgeExclude` names 0.1.1 in place of 0.1.0 (both were named for the one install that moved the lockfile, since pnpm checks the old entry before it resolves the new one). The `ROWS` row "an edit through a dangling link whose target has .. after a symlink out of the workspace" builds `sublink -> <away>/sub` and `trick -> sublink/../esc2.txt` and answers `ask` under `acceptEdits`; the failure on 0.1.0 is the one cofold's `paths.test.ts` pins. `pnpm test` green (102 files, 1348 tests).
