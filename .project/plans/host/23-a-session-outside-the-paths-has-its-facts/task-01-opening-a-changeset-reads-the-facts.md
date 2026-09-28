---
title: Opening a changeset reads the folder's git facts first
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L5095-L5115](../../../../packages/sdk/src/host.ts#L5095-L5115) - the changeset subscribe, which refreshes the files only"
  - "[code://packages/sdk/src/host.ts#L2882-L2903](../../../../packages/sdk/src/host.ts#L2882-L2903) - `refreshFacts`, whose order and announcements this reuses"
  - "[code://packages/sdk/src/changes.ts#L918-L932](../../../../packages/sdk/src/changes.ts#L918-L932) - the pull request pair needs `github` in the operation context"
  - "[code://packages/sdk/test/changes-refresh.test.ts](../../../../packages/sdk/test/changes-refresh.test.ts) - where the new cases go"
---

## Objective

The first subscribe to a changeset of a session in any folder answers with the operations its git facts allow, the pull request pair included, and a move it found reaches the session's row.

## Files

- `UPDATE: packages/sdk/src/host.ts:5095-5115` - before `changes.state`, await the folder's git facts (`directories.refresh`) and `refreshPullRequests`, then the files refresh that is already there; announce what moved.
- `UPDATE: packages/sdk/src/host.ts:2882-2903` - if the helper is shared, `refreshFacts` calls the awaited form rather than repeating it.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - the cases below.

## Steps

1. Write an awaited helper beside `refreshFacts` that reads a folder's facts, then its pull requests, then its changes, and returns what moved; `refreshFacts` keeps its fire-and-forget shape by calling it.
2. In the changeset subscribe, call the helper instead of the bare `changes.refresh`, before `changes.state`, so the answer's operations are computed from fresh facts.
3. When facts moved, call `metaMoved(dir)`; when changes moved, dispatch `session/changesetsChanged` and `summaryMoved` for `inThere(dir)`, as `refreshFacts` does.
4. A failure reading facts or pull requests never fails the subscribe: the files and the state still answer, as today.

## Validation

- `packages/sdk/test/changes-refresh.test.ts`: a scratch repository outside the host's `path`, with a GitHub-shaped `origin` and a change, and a session created there with no turn; the first subscribe's operations include `create-pr` and `prepare-pull-request` when a `github` port is given, and do not when it is not.
- Same file: the first subscribe in that folder announces `root/sessionSummaryChanged` with the session's `changes`.
- Same file: a subscribe in a folder that is not a repository still answers.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Implemented 2026-09-27. `readFacts(dir)` beside `refreshFacts` reads the git facts and then the pull requests, announcing `metaMoved` on each move, beside the changes refresh, which announces `session/changesetsChanged` and `summaryMoved` for `inThere(dir)`; it resolves with whether the changes moved and never rejects. `refreshFacts` is `void readFacts(dir)`. The changeset subscribe awaits `readFacts` where it awaited `changes.refresh`, before `changes.state` and `operationsOf`.

The facts and the changes are read side by side, as `refreshFacts` read them, not one after the other: the operations need both and neither needs the other.

Cases in `changes-refresh.test.ts`, each with a scratch repository outside the host's `path` (the echo agent is given the host's `path`, since its `directories()` puts its own folder in `browsable()`): the first subscribe offers `create-pr` and `prepare-pull-request` with a fake `github` and asks it about `main` once; without `github` it offers `commit` and not the pair; the first subscribe announces `root/sessionSummaryChanged` with `changes.files` 1; a subscribe to the `session` changeset in a folder that is not a repository, with a `directories.refresh` that rejects, still answers with no files. The first, third and fourth of the task's cases fail with the subscribe reverted to the bare `changes.refresh`.
