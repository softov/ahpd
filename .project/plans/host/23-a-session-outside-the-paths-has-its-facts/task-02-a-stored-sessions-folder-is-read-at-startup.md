---
title: A stored session's folder is read at startup
status: implemented
depends:
  - task-01-opening-a-changeset-reads-the-facts.md
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L2082-L2087](../../../../packages/sdk/src/host.ts#L2082-L2087) - the startup loop over `browsable()`"
  - "[code://packages/sdk/src/host.ts#L3332-L3380](../../../../packages/sdk/src/host.ts#L3332-L3380) - `listing`, which knows every stored session's folder"
  - "[code://packages/sdk/src/host.ts#L1972-L1976](../../../../packages/sdk/src/host.ts#L1972-L1976) - `changesOf`, what a listed row carries"
  - "[code://packages/sdk/src/host.ts#L2022-L2043](../../../../packages/sdk/src/host.ts#L2022-L2043) - `summaryMoved`, which says nothing about a listed row's counts"
---

## Objective

After the host starts, every stored session's folder that is not already in `browsable()` is read once, one folder at a time, and a listed row whose counts that read found is announced with them.

## Files

- `UPDATE: packages/sdk/src/host.ts:2082-2087` - after the `browsable()` loop, a startup pass over the stored sessions' folders.
- `UPDATE: packages/sdk/src/host.ts:2022-2043` - a way to announce a listed row's `changes`, for a session with no `Held`.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` or a new test beside it - the cases below.

## Steps

1. After the `browsable()` loop, start one background pass that asks every agent's `list()`, collects the distinct folders of the rows, drops those in `browsable()`, and reads each with task 01's helper, awaiting one before the next; a failing agent or folder is skipped.
2. Nothing in the pass is awaited by `createHost` or by the first request.
3. When a folder's changes moved, announce each listed row in it: a live session through `summaryMoved`, a row with no `Held` through `root/sessionSummaryChanged` carrying `changes` from `changesOf`.
4. A folder is read by this pass once; later reads happen on the triggers that exist today and on task 01's subscribe.

## Validation

- A test with a stored session (an agent whose `list()` returns a row) in a scratch repository outside the host's `path`: after startup settles, `listSessions` returns the row with `changes`, without a turn and without a subscribe.
- Same: a client connected before the pass finished receives `root/sessionSummaryChanged` for the row with `changes`.
- Same: a folder in `browsable()` is not read a second time by the pass.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Implemented 2026-09-27. `readStored` sits after `listing` in `host.ts` and is started by a `setTimeout(..., 0)` there rather than after the `browsable()` loop, because `listing` is a `const` defined later in `createHost` and cannot be called before it. It takes the rows from `listing()`, which already skips an agent whose `list()` fails and registers each row's folder, skips live sessions, collects the distinct `dirOf` of the rest that `browsable()` does not hold, and awaits `readFacts` on each in turn. Where the changes moved, each listed row in the folder with no `Held` is announced through `summaryMoved`, whose fallback now carries `changesOf(uri)` beside `status`; live sessions there are announced by `readFacts`.

Cases in `changes-refresh.test.ts`, with an echo agent whose `list()` returns one row in a scratch repository outside the `path`: `listSessions` returns the row with `changes.files` 1 and the folder was read once, with no turn and no subscribe; a client connected before the pass receives `root/sessionSummaryChanged` for `echo:/stored` with `changes.files` 1; with the row's folder as the host's `path`, the changes source is asked for it once. The first two fail with the `setTimeout` removed.
