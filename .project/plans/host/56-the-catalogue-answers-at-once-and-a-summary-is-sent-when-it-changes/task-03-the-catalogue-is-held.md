---
title: The catalogue is held, and a refresh sends what moved
status: todo
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
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:402-403` - `listSessions` answers `liveRows()` followed by `await held()`, and starts a refresh as question 1 is answered.
- `UPDATE: packages/sdk/src/host/catalogue.ts:454-470` - `readStored` takes its rows from the first `refresh()` rather than a listing of its own.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts` and the other tests that write a row into the fake SDK and list it - they wait for the refresh.
- `CREATE: packages/sdk/test/host-catalogue-held.test.ts`.

## Steps

1. Ask Softov question 1 of the plan's Resume state, and write his answer as a row in the plan's second table before going on.
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
