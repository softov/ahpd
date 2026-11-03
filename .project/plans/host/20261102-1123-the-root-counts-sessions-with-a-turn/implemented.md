---
title: The root counts the sessions with a turn running - implemented
date: 2026-11-02
refs:
  - git://9a23b4a6 - the change
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts)"
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts)"
---

The root's `activeSessions` is the number of sessions with a turn running in any of their chats, as VS Code's host counts it.
A session created, woken or asleep with nothing running counts nothing.
The number is said when a turn starts or ends, and when a chat or a session goes while its turn runs.

## What was built

- [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) - `activeCount` from the chats' held states, and `activeSessionsMoved` against the root's held state.
- The same file's `chatMoved` reads the count again after every chat action.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - a chat closed reads the count again.
- [`code://packages/sdk/test/host-catalogue.test.ts`](../../../../packages/sdk/test/host-catalogue.test.ts) - the count through a turn, and nothing said while it stands still.
- [`code://packages/sdk/test/presence.test.ts`](../../../../packages/sdk/test/presence.test.ts) - the count said at a turn's start and end, and not at a disposal after it.
- `session-sleep.test.ts`, `session-wakeup-tool.test.ts` and the server's `plugin-live.test.ts` read a sleep, a wake and an unload by what each one changes.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md), `HOST.md` and `SESSIONS.md` say what the number counts.

## Verified

- On `6e6d1ca8`'s `catalogue.ts` and `sessionmethods.ts`, three cases fail: the catalogue's count, presence's announcements and the sleeping session's count.
- With `9a23b4a6` the five files pass, 130 of 130.
- The sdk package's 208 test files pass with the change, 3948 tests.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- Task 01 - the presence case first passed on the base, since both counts say 1, then 0, across a creation and a disposal.
- It reads the count at the turn's end as well, where the base's count still says 1.

## Left for later

- None.
