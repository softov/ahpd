---
title: The catalogue is held, and a refresh sends what moved
status: done
depends: [task-01-a-summary-that-did-not-change-is-not-sent.md, task-02-agents-are-listed-at-once-and-once-per-store.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/history.ts#L123-L144](../../../../packages/sdk/src/host/history.ts#L123-L144) - `listed`, `listNow` and `catalogue`, which the held rows replace"
  - "[code://packages/sdk/src/host/catalogue.ts#L266-L425](../../../../packages/sdk/src/host/catalogue.ts#L266-L425) - `listing`, split into backend rows and live rows"
  - "[code://packages/sdk/src/host/catalogue.ts#L367-L389](../../../../packages/sdk/src/host/catalogue.ts#L367-L389) - the live rows, built from `sessions`"
  - "[code://packages/sdk/src/host/catalogue.ts#L454-L470](../../../../packages/sdk/src/host/catalogue.ts#L454-L470) - `readStored`, whose listing becomes the first refresh"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L402-L403](../../../../packages/sdk/src/host/sessionmethods.ts#L402-L403) - `listSessions`"
  - "[code://packages/sdk/src/host.ts#L813](../../../../packages/sdk/src/host.ts#L813) - where `readStored` starts"
---

## Objective

`listSessions` answers from rows the host already holds, and a refresh in the background brings them up to date and tells every client what moved through `root/sessionAdded`, `root/sessionRemoved` and `root/sessionSummaryChanged`.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts:266-425` - `listing` returns the backend rows only, and a new `liveRows()` returns the rows of the sessions this host runs, the code at 367-389 moved into it; `rowsMoved(before, after)` broadcasts the difference.
- `UPDATE: packages/sdk/src/host/history.ts:123-144` - `rows` and `refreshing` replace `listed` and `pastAt`; `refresh()` and `held()` replace `listNow` and `catalogue`.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:402-403` - `listSessions` answers `liveRows()` followed by `await held()` and starts one background refresh when none runs.
- `UPDATE: packages/sdk/src/host/catalogue.ts:454-470` - `readStored` takes its rows from the first `refresh()` rather than a listing of its own.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts` and the other tests that write a row into the fake SDK and list it - they wait for the refresh.
- `CREATE: packages/sdk/test/host-catalogue-held.test.ts`.

## Steps

1. A refresh starts only from `listSessions`, one at a time, as the plan's second table records.
2. `refresh()` in `history.ts`: when `refreshing` is set, return it; otherwise start `listing()`, and when it resolves, call `rowsMoved(rows, found)`, set `rows = found`, clear `refreshing`; when it rejects, keep `rows` and clear `refreshing`.
3. `held()`: `rows` when there are any, and otherwise `refresh()`, so the first `listSessions` after start waits for the first listing and no later one does.
4. `rowsMoved` in `catalogue.ts`, by resource: a row in `after` and not in `before` goes out as `root/sessionAdded` with the row; a row in `before` and not in `after` as `root/sessionRemoved` with `forgetSent`; a row in both whose `title`, `modifiedAt`, `status`, `workingDirectories` or `changes` differ as `root/sessionSummaryChanged` through the last-sent check from task 01; a row whose resource is in `sessions` is skipped, since `summaryMoved` speaks for it. Nothing is sent on the first fill, when `before` is empty.
5. `listSessions` pages over `[...liveRows(), ...await held()]`, sorted as today, with the backend rows whose id is now claimed by a live session left out.
6. Start the first refresh where `readStored` starts today, and let `readStored` read its directories from that refresh's rows.
7. Give the tests a way to wait: the host's test handle exposes the running refresh, or the tests list twice; whichever the existing helpers in `test/support/host.ts` make shorter.

## Validation

- `host-catalogue-held.test.ts`: a fake agent whose `list` counts calls and waits 100 ms; the first `listSessions` waits for it; a second answers in under 10 ms without a new wait on `list`; a row added to the fake goes out as `root/sessionAdded` after the refresh; a row taken away goes out as `root/sessionRemoved`; a row whose title changed goes out as one `root/sessionSummaryChanged`; two `listSessions` while a refresh runs start no second one; a refresh that rejects keeps the held rows.
- `pnpm exec tsc --noEmit`, `pnpm test`.

## Resume

Implemented 2026-10-04.

- `listing` now answers the backend rows only, and `liveRows()` builds the sessions this host is running, moved out of it. `held()` in `history.ts` answers the rows as last listed and `refresh()` starts a listing, joins one that is already running, and - when it lands - calls `rowsMoved(rows, found)` before holding what it found. A listing that throws leaves the held rows alone.
- `rowsMoved(before, after)` in `catalogue.ts` says what changed by resource: `root/sessionAdded` for a row that was not there, `root/sessionRemoved` (with `forgetSent`) for one that is gone, and `root/sessionSummaryChanged` for one whose `title`, `modifiedAt`, `status`, `workingDirectories` or `changes` differ, through the same last-sent check task 01 put in `summaryMoved` - `sayMoved` is now the one place a `root/sessionSummaryChanged` leaves from. Nothing is said on the first fill.
- `listSessions` answers `allRows()` and starts one background refresh behind that answer; `readStored` takes its rows from that same first refresh rather than a listing of its own.

Departures from the plan:

- **The held rows are handed out with what this host knows about them read again.** `allRows()` rebuilds each held row's `status`, `changes` and `_meta` from `kept.flags`, `changesOf` and `ctx.describes` when it answers, keeping the backend's title, dates and directories. The plan's step 5 says the answer is `[...liveRows(), ...await held()]` as listed, which freezes the rest for as long as the rows are held, and two existing tests are the reason that is wrong: `the flags a client sets > keeps read and archived, and tells everyone watching` (a client that marks a row and lists again was handed the flag one refresh late) and `changes-refresh > lists a stored session outside the path with its counts`. Both are in `packages/sdk/test` and were failing. What is held is what cost a pass over the machine's transcripts; these three read out of memory and cost nothing.
- `packages/sdk/src/host/tooling.ts:237` is not in the plan's Files. `ToolCall.sessions` was `listing()`, which no longer carries the live rows, so the `list_sessions` tool stopped seeing the session it is running in and `host-tools.test.ts` lost nine tests. It is now `allRows()`, which is what `listSessions` answers, and the comment beside it says so.
- `packages/sdk/src/host/actions.ts:35` and `packages/sdk/src/host/chatactions.ts:28` destructured `catalogue` and never used it; with History's `catalogue` gone they no longer compile, and the name is dropped from the two lists rather than renamed to `held` - both files already use `held` for something else in a dozen places.
- `past` keeps `LISTING_FRESH` and `pastAt`. Its `catalogue()`/`listNow()` are now `held()` and `relist()`, and `relist` waits out a listing already in flight rather than joining it: the plan's files line says `pastAt` is replaced here and task 04 step 5 says it is deleted there, but `users-gate > finds a session a backend wrote to disk after the last listing` and `users-gate > reads the catalogue once for a run of subscribes to sessions nobody has` both need the two-second throttle, so it stays until task 04 takes it away with the `find` that replaces the second listing.
- `host-catalogue-held.test.ts` builds its own host, as `host-catalogue-parallel.test.ts` does: `serving()` registers the built-in Claude and these tests need one backend whose `list` they control. Step 7's "the host's test handle exposes the running refresh" was not needed - the fake's `list` counts its calls and answers, and a test ticks until the answer it is waiting for has landed.

Each of the five new tests was seen failing with the behaviour removed: without `held()` answering from the rows, three fail; without `rowsMoved` called, the two notification tests fail; with the first fill announced, the row that appeared test fails.

Gates: `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (205 files, 2856 tests) all pass.
