---
title: pi, cofold and ACP find a session by id, and the listing throttle goes - implemented
date: 2026-10-06
refs:
  - "[code://packages/agent-pi/src/catalog.ts](../../../../packages/agent-pi/src/catalog.ts) - `findSession`, `rowOfFile`, `watchedRow`"
  - "[code://packages/agent-cofold/src/agent.ts](../../../../packages/agent-cofold/src/agent.ts) - `recordRow` and `find`"
  - "[code://packages/agent-acp/src/catalog.ts](../../../../packages/agent-acp/src/catalog.ts) - `findListed`"
  - "[code://packages/sdk/src/host/history.ts](../../../../packages/sdk/src/host/history.ts) - `past`, `relist`, `someCannotSay` without the throttle"
  - "[code://docs/AGENT.md](../../../../docs/AGENT.md) - the `find(id)` row"
---

Every bundled backend now answers `find(id)`, so opening a session the host is not holding asks the backend that may have it rather than listing the machine, and the two-second window that used to bound that listing is gone.

## What was built

- [`code://packages/agent-pi/src/catalog.ts`](../../../../packages/agent-pi/src/catalog.ts) - `findSession(options, provider, id, directories)` answers the watched record through `watchedRow` when this process has one, and otherwise walks the served directories' `SessionManager.findById` and builds the row from the one file with `rowOfFile`, which reads the file's lines and never opens it. `catalogue` and `find` share `watchedRow`, so a watched session's row is the same either way. `find` sits beside `list` in [`code://packages/agent-pi/src/agent.ts`](../../../../packages/agent-pi/src/agent.ts).
- [`code://packages/agent-cofold/src/agent.ts`](../../../../packages/agent-cofold/src/agent.ts) - `recordRow(record)` is the per-record mapping `list` and `find` share, and `find` reads one record with `store.sessions.get` and never calls `store.sessions.list`.
- [`code://packages/agent-acp/src/catalog.ts`](../../../../packages/agent-acp/src/catalog.ts) - `findListed` answers the row `catalogueOf` answers, which is the server's own row when the server lists and the watched record when it cannot, and reuses `catalogueOf` whole to get it. `rowsForFind` shares one read between the finds that ask during it and keeps its answer for the next two seconds (`FIND_FRESH`), a failed start included. ACP 1.6.0 has no call that describes one session, so a listing is the only way to a row; it is one server rather than every agent. `find` is a plain property on the agent, not a getter, because it does not depend on the handshake.
- [`code://packages/sdk/src/host/history.ts`](../../../../packages/sdk/src/host/history.ts) - `LISTING_FRESH` and `pastAt` are deleted, with the `Date.now()` condition they guarded. `relist(asked)` joins a refresh numbered above the `asked` its caller read and otherwise waits one out and starts its own; `past` reads that count once, before it asks anybody anything. `someCannotSay` now counts an agent with `list` and no `find`.
- [`code://docs/AGENT.md`](../../../../docs/AGENT.md) - the `find(id)` row and a paragraph saying what it is for and what leaving it out costs.

## Verified

- `packages/agent-pi/test/agent-pi-find.test.ts` (5 cases), `packages/agent-cofold/test/agent-cofold-store.test.ts` (3 new cases), `packages/agent-acp/test/agent-acp-catalog.test.ts` (5 new cases), `packages/sdk/test/users-gate-sessions.test.ts` (two new cases and one rewritten) and `packages/sdk/test/host-past-open.test.ts` (one new case). Every one of them was seen failing before its fix.
- `npx tsc -b` passes; `pnpm boundary` passes, 8 packages, none undeclared.
- `node tools/schema.mjs && npx vitest run packages/sdk` passes, 106 files, 1502 tests.
- `npx vitest run packages/agent-pi packages/agent-cofold packages/agent-acp` passes, 40 files, 537 tests.
- `rg -n "LISTING_FRESH|pastAt" packages` finds nothing; what remains is in `.project/` history only.

### Re-run after the review fixes

Run on 2026-10-06 with the three fixes and their tests in place.

- `npx tsc -b` passes, no output.
- `pnpm boundary` passes, 8 packages, none undeclared.
- `npx vitest run packages/sdk packages/agent-pi packages/agent-cofold packages/agent-acp` - 146 files, 2046 tests, 2044 pass. Neither failure is on a path these fixes changed: `packages/agent-pi/test/agent-pi-lazy.test.ts`, whose case holds the plugin's own import to 2 s and did not make it, and `packages/agent-acp/test/agent-acp-machine.test.ts > reaches a disposable machine`, which runs at about 5.0 s against vitest's 5 s default. The machine one passes alone; the pi one passed at 715 ms earlier the day when the machine was quieter and is written up under *Left for later* with what was measured.
- An earlier run of the same command also failed `packages/sdk/test/wire.test.ts`'s strict-schema case and `packages/sdk/test/nested-start.test.ts`; both pass alone and passed in later runs. All four are the same wall-clock-under-load shape, and none of them is touched by this plan.
- `npx vitest run packages/agent-acp/test/agent-acp-catalog.test.ts packages/agent-acp/test/agent-acp-delete.test.ts` passes, 78 tests, which is the five cases the first two fixes added or rewrote and everything that was there before.
- `npx vitest run packages/agent-pi/test/agent-pi-find.test.ts` passes, 8 tests, which is the three cases of the third fix and the five before them.

## Review fixes

Softov's review of the built plan, 2026-10-06, found three things. Each was written as a test first and seen failing before the fix, and the plan's *Decisions locked in* table and *Risks* carry what the review decided.

- **A find's read is shared, and its answer serves the next two seconds.** `findListed` listed that server for every missing id, and `packages/sdk/src/host/history.ts` reaches it through `findOf` with no throttle at all, so N subscribes to unknown ids cost N listings - and where the command does not start, `dropListing` made each one respawn it. [`code://packages/agent-acp/src/catalog.ts`](../../../../packages/agent-acp/src/catalog.ts) now keeps the read behind `rowsForFind`: a find asking while a read is out joins that promise, a find asking inside `FIND_FRESH` (two seconds) of its answer is answered from its rows, and a failed start is kept the same way, so the command behind it is spawned once per window. Tests: `lists once for every find asking at the same time` (five concurrent finds of missing ids, one `session/list`), `answers a find of a missing id from the listing it read a moment ago` (two finds one after another, one `session/list`), and `spawns a command that cannot start once for the ids of one window` (the command is `node -e` appending to a file, and the file holds one line). Before the fix the three saw five listings, two listings and two spawns. Keeping rows for a window brought its own edge, which `forgetSession` closes: the memo goes with a delete, because the rows it holds are a moment old and a delete is the change they cannot have. Test: `answers nothing for a session the server dropped since the listing it read`, which found the deleted row before that line and finds nothing after it.
- **A find answers the row the listing answers.** `findListed` preferred `listedOf(watchedSession(...))`, which is a row `list` does not answer for a session on a server that lists: the title a client set and a time the server never gave. The host adopts the row it is handed, so the next refresh sent every client a `root/sessionSummaryChanged` for a session that did not change. `findListed` now answers the row `catalogueOf` answers and nothing else - the server's `listedFrom` row when the server lists, the watched record only when it cannot, which `catalogueOf` already does. The comment at the head of `findListed` says so, and the plan's defaulted row, which claimed the watched record wins in ACP too, is amended. Test: `answers a session this process watched the way its listing answers it`, which watches a session the fixture lists and holds `find(id)` deep-equal to the row `list` answers. It replaced a case that asserted the opposite. The helper `backend()` now takes a provider, so a case that watches a session does not watch it for every case after it.
- **pi's find reads, and never writes.** `findSession` built the row from `SessionManager.open`, which is not a read: a file gone since `findById` named it is a fresh session to pi and is written back out, an empty or unreadable file is emptied and rewritten, and an older-format file is migrated to the current version and written. A lookup would therefore have changed the session it was asked about, and would have answered an invented id as that session's row. `findSession` now reads the file with `readFileSync` and parses its lines with pi's own exported `parseSessionEntries` - the reader `list` streams a file through, added to the `Pi` interface and to `loadPi` - and `rowOfFile` walks those entries exactly as pi's `buildSessionInfo` walks them, answering nothing when the first entry is not a session header or its id is not the one asked for. Tests: `answers nothing, and makes nothing, for a file that is gone` (removed between the lookup and the read; nothing is answered and no file appears), `reads an older-format session file without migrating it` (a version-1 file, byte-identical afterwards, row equal to `list`'s), and `answers nothing when the file it was named does not hold that session`. The two suites that replace pi's module with a mock - `agent-pi-delete.test.ts` and `agent-pi-lazy.test.ts` - give that mock `parseSessionEntries`, because `loadPi` takes it from the module either way.

## Departures from the plan

- Task 01: the plan named the extraction in `catalogue` implicitly; it became `watchedRow`, and `sessionOnDisk` moved from `agent-pi-disk.test.ts` into `fake-pi.ts` with an optional `name` because the find suite is its second caller.
- Task 02: the plan names the extracted per-record mapping `rowOf`, but `rowOf` is already this module's exported `ModelInfo` mapper, so it is `recordRow`.
- Task 04: the plan says to add a `started` counter. `passes` already is that counter - bumped once per refresh, with `pastAt` declared beside it - so no second one was added and `relist` compares against `passes`.
- Task 04: the plan lists `users-gate.test.ts` with `users-gate-sessions.test.ts` only as a fallback. Host 55 has landed, so the tests and the `listingOne` change are in `users-gate-sessions.test.ts` and `users-gate-helpers.ts`.
- Task 04: two of the tests named in its Validation pass before the change as well as after - the sharing test, whose subject is now the refresh's single flight rather than the window, and the five-opens guard, which pins the narrowed `someCannotSay`. The two `finds a session ...` cases are the ones that failed first.

## Left for later

- The tasks stay `implemented` until Softov reviews them; nothing is committed.
- `packages/agent-acp/test/agent-acp-machine.test.ts > reaches a disposable machine` runs at about 5.0 s against vitest's 5 s default and times out under a full parallel run. It is untouched by this plan, it passes alone and on a second run of the same command, and it may deserve a timeout of its own.
- `packages/agent-pi/test/agent-pi-lazy.test.ts` holds the plugin's own import to 2 s, and on this machine while it was loaded that import is over it. Measured: `await import('@ahpd/sdk')` alone, in a fresh process, takes 3.2 s, and the plugin's import 3.3-3.6 s; the same case passed at 715 ms earlier the same day, before four peer agent sessions on this box started their own suites. Nothing in this plan or in the review fixes is on that path - the sdk barrel the cost is dominated by is untouched, and the fix there adds no import to the graph - so it is a wall-clock race against other work on the machine rather than a failure of the code. It may deserve a budget that is not a race, or a timeout of its own.
