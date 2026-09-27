---
title: A row says what is staged, and a staged rename is one row
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L398-L440](../../../../packages/sdk/src/changes.ts#L398-L440) - the status loop, with the draft's `staged` and `unstaged`"
  - "[code://packages/sdk/src/types/changes.ts#L29-L42](../../../../packages/sdk/src/types/changes.ts#L29-L42) - `ChangesetFile`, with the draft's `_meta`"
  - file:///github/externals/agent-host-protocol/types/channels-changeset/state.ts - `ChangesetFile._meta`, server-defined and opaque to the protocol
---

## Objective

Each row of an `uncommitted` changeset carries `_meta.staged` and `_meta.unstaged` from git's two status letters, and a staged rename or copy is one row under its new name.

## Files

- `UPDATE: packages/sdk/src/types/changes.ts:29-42` - `ChangesetFile._meta`, as the draft has it.
- `UPDATE: packages/sdk/src/changes.ts:398-440` - the draft's `staged` and `unstaged`; an `R` or `C` record takes the next record as its old path.
- `UPDATE: packages/sdk/test/commit.test.ts` - the draft's two staging cases stay, and the rename case below is added.

## Steps

1. The working tree holds an uncommitted draft of this plan's work, left by another session: `docs/AHP.md`, `packages/sdk/src/changes.ts`, `packages/sdk/src/types/changes.ts` and `packages/sdk/test/commit.test.ts`.
   Start from it; this task keeps its `_meta` on a row and its two staging cases.
2. In the status loop, when the record's first letter is `R` or `C`, consume the following NUL-separated record as the old path, so it is not read as a row of its own.
3. The rename's row is the new path, marked staged.

## Validation

- `commit.test.ts`: after `git mv old.txt new.txt` in a scratch repository, the changeset has one row, `file://<dir>/new.txt`, with `_meta.staged` true, and no row whose path is `.txt`.
  Today it has a second row, `file://<dir>/.txt`.
- The draft's two staging cases pass: a staged file and an untracked one are told apart, and an `MM` file is both.
- `node_modules/.bin/vitest run packages/sdk/test/commit.test.ts` green.

## Resume

Implemented 2026-09-27. The rename case was written first and seen to fail: `packages/sdk/test/commit.test.ts` read two rows for `git mv tracked.txt new.txt`, `file://<dir>/new.txt` and `file://<dir>/cked.txt`, the second being the old path whose first two letters became its status.

The status loop in `packages/sdk/src/changes.ts` now walks the records by index and consumes the record after an `R` or `C` record as the old path. A rename is one row under its new name with `_meta.staged` true. The draft's `_meta.staged` and `_meta.unstaged` on a row and its two staging cases are kept unchanged.

`node_modules/.bin/vitest run packages/sdk/test/commit.test.ts`: 8 passed.
`pnpm typecheck`, `pnpm boundary` and `pnpm test`: 102 files, 1350 tests passed.
