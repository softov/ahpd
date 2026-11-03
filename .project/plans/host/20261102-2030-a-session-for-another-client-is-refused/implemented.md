---
title: A session for another client is refused - implemented
date: 2026-11-02
refs:
  - git://769538f9 - the last change
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts)"
---

A `createSession` whose `activeClient` names a `clientId` other than the connection's, or none, is refused with `-32602`, before anything is claimed or made.
A creator naming its own id is held in the session as it sent its entry.

## What was built

- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - the creator's id checked after the provider's checks, and the entry held as the creator sent it.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `createSession` row.

## Verified

- Task 01's changed presence case fails on `89ebe4d5`'s source, the request resolving, and passes with the change.
- Task 02's new case fails on `7e87e7da`'s source, the session made, and passes with the change.
- The presence and remote session files pass, their creators naming the connection's id.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- Task 01 is in upstream main since #193, so task 02 sits on `15f02030`.
- That commit holds main's case for a creator's entry with no `clientId`, which task 02 changes.
- Task 02 was built and checked on task 01 rebased onto `f419294d` (`7e87e7da`), and its changed lines on `15f02030` are the same.
