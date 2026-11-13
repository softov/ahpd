---
title: A prerelease part moves to a newer one
status: todo
depends: []
layer: "scripts"
refs:
  - "[code://scripts/parts-bump.mjs#L117-L149](../../../../scripts/parts-bump.mjs#L117-L149) - `orderOf`, whose tag compare this task shares"
  - "[code://scripts/parts-bump.mjs#L166-L198](../../../../scripts/parts-bump.mjs#L166-L198) - `newerThan`"
  - "[code://scripts/parts-bump.mjs#L221-L235](../../../../scripts/parts-bump.mjs#L221-L235) - the two skip lines"
  - "[code://packages/computer/test/parts-bump.test.ts#L82-L95](../../../../packages/computer/test/parts-bump.test.ts#L82-L95) - the prerelease case"
---

## Objective

`bumpOf` moves a part on a prerelease to a newer prerelease or a release, and never moves a part on a release to a prerelease.
The skip line for a refused prerelease names it as a prerelease.

## Files

- `UPDATE: scripts/parts-bump.mjs:117-149` - move the tag compare of `orderOf` into `tagOrder`, which `orderOf` calls.
- `UPDATE: scripts/parts-bump.mjs:166-198` - `newerThan` takes a newer prerelease when the held version is one too.
- `UPDATE: scripts/parts-bump.mjs:221-235` - skip a prerelease for a part on a release, with its own line.
- `UPDATE: packages/computer/test/parts-bump.test.ts` - the cases for a part on a prerelease.
- `UPDATE: docs/plugins/COMPUTERS.md` - *Bumps* says a part on a prerelease follows newer prereleases.

## Steps

1. Move the tag loop of `orderOf` into `tagOrder(one, two)`, and call it from `orderOf`.
2. Add `prereleaseRefused(next, held)`, true when `next` has a tag and `held` has none.
3. In `newerThan`, with two tags, compare unequal cores as now and equal cores with `tagOrder`.
4. Keep `newerThan` true for a release that follows its own prerelease.
5. In `bumpOf`, for the npm part and the archive part, check `prereleaseRefused` before `newerThan`.
6. Write the skip line `the feed has <version>, a prerelease, and <id> is on a release` for a refused prerelease.
7. Update the comment on `newerThan` to say which part may move to a prerelease.
8. Keep the existing prerelease case, and assert its new skip line.
9. Add a case: a part on `1.54.0-rc.1` moves to `1.54.0-rc.2`, and to `1.55.0-rc.1`.
10. Add a case: a part on `1.54.0-rc.2` stays when the feed has `1.54.0-rc.1`, with the "not newer" line.
11. Say the rule in *Bumps* of `docs/plugins/COMPUTERS.md`.

## Validation

- `packages/computer/test/parts-bump.test.ts`: the cases of steps 8 to 10.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/computer/test/parts-bump.test.ts` passes.
- `node scripts/parts-bump.mjs --dry-run` names dsh as bumped while its feed has a newer prerelease.

## Resume
