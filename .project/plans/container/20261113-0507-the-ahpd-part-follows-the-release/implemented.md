---
title: The ahpd part follows the last release - implemented
date: 2026-11-13
refs:
  - git://2a495f117 - main when the build started
  - "[code://scripts/parts-bump.mjs](../../../../scripts/parts-bump.mjs)"
  - "[code://packages/computer/test/parts-bump.test.ts](../../../../packages/computer/test/parts-bump.test.ts)"
---

The weekly parts bump moves the ahpd part to the last release that npm serves of `@ahpd/server`, a release candidate included. The pull request carries the new version and the part's lock, so a machine and an ssh box install that release.

## What was built

- [`code://scripts/parts-bump.mjs`](../../../../scripts/parts-bump.mjs) - `npmChannels(name)` reads `npm view <name> dist-tags --json`, as an array or an object, and answers `latest` and `next`. `orderOf` compares two versions by semver precedence, so a release is higher than its own prerelease. `bumpOf` takes the higher of the two channels for the ahpd part, and skips with a line when npm names no version or nothing newer.
- [`code://packages/computer/test/parts-bump.test.ts`](../../../../packages/computer/test/parts-bump.test.ts) - an npm on `PATH` that answers `view` with the dist-tags of the case, and four cases for the ahpd part.
- `docs/plugins/COMPUTERS.md` *Bumps* - the ahpd part follows the last release on npm, and the workflow is run by hand after an approval.

## Verified

- `packages/computer/test/parts-bump.test.ts`: 9 passed, 4 of them new.
  - A release candidate on `next`, in the array that npm 12 answers. The lock pins `@ahpd/sdk` and `@ahpd/server` at it.
  - A release on `latest` that follows the candidate on `next`.
  - No newer version, skipped with a line that names both versions.
  - No version npm names that `EXACT` reads, skipped with a line.
- `node scripts/parts-bump.mjs --dry-run` on main, against the real npm: `bumped ahpd 0.15.0-rc.1 -> 0.15.0-rc.2`.
- `npx vitest run packages/computer` under the shared lock: 39 files, 630 passed, 1 skipped, 1 failed. The failed case is `computer-spawn.test.ts` *fails a turn on a session whose CLI is gone*, which this change does not touch. It reached the limit of 5 s, and it passes in 8.7 s with `--testTimeout=60000`. The cold import of `agent-claude` from source takes that time on this box.
- `pnpm typecheck`, `pnpm boundary`, `pnpm build` and `pnpm docs:build` pass.

## Departures from the plan

- none.

## Left for later

- The first weekly or manual run of `parts-bump.yml` after the merge opens the pull request that moves the part to `0.15.0-rc.2`.
