---
title: The usage pools case holds its clock
status: todo
depends: []
layer: "sdk tests"
refs:
  - "[code://packages/sdk/test/users-gate-commands.test.ts#L473-L521](../../../../packages/sdk/test/users-gate-commands.test.ts#L473-L521) - the case that reads the month under the wall clock"
  - "[code://packages/sdk/test/usage-scheme.test.ts#L27-L39](../../../../packages/sdk/test/usage-scheme.test.ts#L27-L39) - the pinned clock this copies"
---

## Objective

The usage pools case reads its records' month on any day, because `Date` is held at 2026-10-07T12:00:00.000Z while it runs.

## Files

- `UPDATE: packages/sdk/test/users-gate-commands.test.ts:3` - `vi` imported beside `expect` and `it`.
- `UPDATE: packages/sdk/test/users-gate-commands.test.ts:473-521` - the case fakes `Date` alone, sets it inside October 2026, and restores real timers in a `finally`.

## Steps

1. Import `vi` from `vitest` in `users-gate-commands.test.ts`.
2. Start the usage pools case with `vi.useFakeTimers({ toFake: ['Date'] })`.
3. Then set the clock with `vi.setSystemTime(new Date('2026-10-07T12:00:00.000Z'))`.
4. Say in a comment that the records fall in October 2026.
5. Wrap the rest of the case in `try`, with `vi.useRealTimers()` in its `finally`.

## Validation

- `pnpm exec vitest run packages/sdk/test/users-gate-commands.test.ts -t "usage pools"` fails before the change on 2026-11-01. The month reads `{}` where the case wants two calls. After the change it passes.
- `pnpm exec vitest run packages/sdk/test/users-gate-commands.test.ts` passes whole.

## Resume
