---
title: A part on a prerelease takes a newer prerelease - implemented
date: 2026-11-13
refs:
  - git://135036a06 - main when the build started
  - "[code://scripts/parts-bump.mjs](../../../../scripts/parts-bump.mjs)"
  - "[code://packages/computer/test/parts-bump.test.ts](../../../../packages/computer/test/parts-bump.test.ts)"
---

The parts bump moves a part that is already on a prerelease to a newer prerelease or to a release. A part on a release still never moves to a prerelease. Its log line names the prerelease instead of saying "not newer".

## What was built

- [`code://scripts/parts-bump.mjs`](../../../../scripts/parts-bump.mjs):
  - `tagOrder` holds the tag compare that `orderOf` had, and `orderOf` calls it.
  - `halvesOf` splits a version into its core and its tag.
  - `prereleaseRefused` is true for a prerelease offered to a part on a release.
  - `newerThan` compares two tags of one core with `tagOrder`.
  - `bumpOf` checks `prereleaseRefused` first for an npm part and an archive part, with the line `the feed has <version>, a prerelease, and <id> is on a release`.
- [`code://packages/computer/test/parts-bump.test.ts`](../../../../packages/computer/test/parts-bump.test.ts) - the prerelease case asserts the new line. Two new cases: a part on `1.54.0-rc.1` moves to `1.54.0-rc.2` and to `1.55.0-rc.1`, and `rc.9` moves to `rc.10`. A part on `1.54.0-rc.2` stays when the feed has `1.54.0-rc.1`.
- `docs/plugins/COMPUTERS.md` *Bumps* - the rule for a part on a prerelease.

## Verified

- `npx vitest run packages/computer/test/parts-bump.test.ts` under the shared lock: 11 passed, 2 of them new.
- `node scripts/parts-bump.mjs --dry-run` against the real feeds: `bumped dsh 0.2.0-rc.2 -> 0.2.2-rc.1`, and no file changed.
- `pnpm typecheck` and `pnpm boundary` pass.

## Departures from the plan

- none.

## Left for later

- The next run of `parts-bump.yml` proposes dsh's move.
