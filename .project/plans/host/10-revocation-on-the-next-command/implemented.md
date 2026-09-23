---
title: A role is read on every command - implemented
date: 2026-09-23
refs:
  - code://packages/sdk/src/types/users.ts
  - code://packages/sdk/src/users.ts
  - code://packages/sdk/src/host.ts
  - code://test/users-gate.test.ts
  - code://docs/USERS.md
---

Editing the user file now takes effect on the next command. A person who has been removed is refused `-32007` and told to sign in again, and a person whose roles changed may do what the file says now, both without reconnecting.

## What was built

- `code://packages/sdk/src/types/users.ts` - `Principal.standing?()`, absent meaning still standing so a hand-built principal is unaffected.
- `code://packages/sdk/src/users.ts` - `principalOf` reads the file for `standing` and for `can`; `grantsOf` takes `complain` so the role-nothing-defines line is said once at verification rather than on every command.
- `code://packages/sdk/src/host.ts` - both gates ask `standing` first and refuse `-32007`, then `can` and refuse `-32009`.

## Verified

- `pnpm test`: 72 files, 932 tests. The new case signs in with a real `fileUsers`, is served, has its role changed to one nothing defines and is refused `-32009`, and is then removed and refused `-32007`, all on one connection.
- `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.
- `test/users.test.ts` is unchanged and green, which is what pins the undefined-role complaint to verification rather than to every question.

## Departures from the plan

- None. The first cut moved the complaint entirely to the first `can`, which `test/users.test.ts` caught; the fix was to call `grantsOf` once, complaining, when the principal is made.

## Left for later

- Nothing. The `host/07` deferred row for this points here.
