---
title: users-gate.test.ts is split into one test file per area, with its shared helpers in one module - implemented
date: 2026-10-04
refs:
  - "[code://packages/sdk/test/users-gate-helpers.ts](../../../../packages/sdk/test/users-gate-helpers.ts) - the helpers the users-gate test files share"
---

`packages/sdk/test/users-gate.test.ts` is gone, and its 60 tests are five files named `users-gate-<area>.test.ts`, none over 453 lines.

## What was built

- `users-gate-helpers.ts` - what two or more of the new files read, with `export` added and bodies unchanged.
- `users-gate-tables.test.ts`, `users-gate-commands.test.ts`, `users-gate-dispatch.test.ts`, `users-gate-sessions.test.ts` and `users-gate-names.test.ts`.

## Verified

- A pure move: the same 60 test names, and every line of the old file in the new ones.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass.

## Departures from the plan

- None.

## Left for later

- host/57 task 04 changes two tests that now live in `users-gate-sessions.test.ts`.
- The tasks stay `implemented` until Softov reviews them.
