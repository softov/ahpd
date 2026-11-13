---
title: The bump moves the ahpd part
status: implemented
depends: []
layer: "scripts"
refs:
  - "[code://scripts/parts-bump.mjs#L147-L150](../../../../scripts/parts-bump.mjs#L147-L150) - the skip this task replaces"
  - "[code://scripts/parts-bump.mjs#L94-L97](../../../../scripts/parts-bump.mjs#L94-L97) - `npmVersion`, the pattern for the dist-tags read"
  - "[code://packages/computer/test/parts-bump.test.ts](../../../../packages/computer/test/parts-bump.test.ts) - the cases this task adds to"
  - "[code://docs/plugins/COMPUTERS.md#L1058-L1070](../../../../docs/plugins/COMPUTERS.md#L1058-L1070) - the bump rules in the docs"
---

## Objective

`parts-bump.mjs` moves the ahpd part to the higher of the `latest` and `next` versions of `@ahpd/server`, when that version is newer.
It writes the part's lock at the new version, as it does for an npm part.

## Files

- `UPDATE: scripts/parts-bump.mjs:94-97` - add `npmChannels(name)`, which reads `npm view <name> dist-tags --json`.
- `UPDATE: scripts/parts-bump.mjs:147-150` - move the ahpd part in place of the skip.
- `UPDATE: packages/computer/test/parts-bump.test.ts` - the cases for the ahpd part, with the stand-in npm answering dist-tags.
- `UPDATE: docs/plugins/COMPUTERS.md:1058-1070` - the ahpd part follows the last release on npm.

## Steps

1. Add `npmChannels(name)` beside `npmVersion`, which answers the `latest` and `next` versions, or `undefined`.
2. Accept an array or an object from `npm view --json`, because npm 12 wraps the answer in an array.
3. In `bumpOf`, for the ahpd part, read the channels of `@ahpd/server`.
4. Take the higher of `latest` and `next`, where a release is higher than its own prerelease.
5. Skip with a line when npm answers nothing, or when the version is not newer than the part's.
6. Skip with a line when the version does not match `EXACT`.
7. Answer `{ version }`, so the run writes the version and the lock as it does for an npm part.
8. Keep `newerThan` refusing a prerelease for every other part.
9. Say in *Parts* of `docs/plugins/COMPUTERS.md` that the bump moves the ahpd part to the last release on npm.

## Validation

- `packages/computer/test/parts-bump.test.ts`: with `next` at a newer release candidate, the ahpd part moves to it.
- The same file: with `latest` at a release newer than `next`, the part moves to the release.
- The same file: the moved part's `package.json` pins `@ahpd/sdk` and `@ahpd/server` at the new version.
- The same file: with no newer version, the run skips the part with a line that names both versions.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/computer/test/parts-bump.test.ts` passes.

## Resume
