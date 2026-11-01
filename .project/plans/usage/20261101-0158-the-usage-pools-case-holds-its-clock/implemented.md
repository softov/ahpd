---
title: The usage pools case holds its clock - implemented
date: 2026-11-01
refs:
  - git://cdbbed1a
  - "[code://packages/sdk/test/users-gate-commands.test.ts](../../../../packages/sdk/test/users-gate-commands.test.ts)"
---

The users gate suite's usage pools case holds `Date` at 2026-10-07T12:00:00.000Z while it runs.
Its records are dated 2026-10-02, so the month it reads holds them on any day.

## What was built

- [`code://packages/sdk/test/users-gate-commands.test.ts`](../../../../packages/sdk/test/users-gate-commands.test.ts) - the usage pools case fakes `Date` alone, sets it inside October 2026, and restores real timers in a `finally`.

## Verified

- On 2026-11-01 before the change, `pnpm exec vitest run packages/sdk/test/users-gate-commands.test.ts -t "usage pools"` failed: the month read `{}` where the case wants two calls.
- After the change, `pnpm exec vitest run packages/sdk/test/users-gate-commands.test.ts` passes 21 of 21.
- `pnpm run typecheck` exits 0.

## Departures from the plan

- None.

## Left for later

- Nothing.
