---
title: A provisional session times out
status: blocked
depends: []
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L2676](../../../../packages/sdk/src/host/lifecycle.ts#L2676) - where the timer starts"
  - "[code://packages/sdk/src/host/sleep.ts#L68-L94](../../../../packages/sdk/src/host/sleep.ts#L68-L94) - the timer setting to copy"
---

## Objective

A provisional session that gets no message within `unusedSessionMinutes` is removed through `removeSession`.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:1028` - add `unusedSessionMinutes` beside `sleepAfterMinutes`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:2676` - arm the timer where the session is marked provisional.
- `UPDATE: packages/sdk/src/host/catalogue.ts:798` - clear the timer when the session stops being provisional or is removed.
- `UPDATE: packages/server/src/config.ts:562` - add the config field with its doc comment.
- `UPDATE: packages/server/src/commands/options.ts:870` - add the option entry, and pass it at 1547.
- `UPDATE: packages/sdk/test/` - cases for removal, a message in time, and zero.

## Steps

1. Add `unusedSessionMinutes` to the host options, with unset as 10 and zero as never.
2. Arm a timer per URI at `markSessionProvisional`, unless the value is zero.
3. Clear the timer at the first message and in `removeSession`.
4. Call `removeSession` for the URI when the timer fires and the session is still provisional.
5. Log one line that names the session and the minutes.
6. Add the config field and the option entry, as `sleepAfterMinutes` has them.
7. Write the sdk cases with fake timers.

## Validation

- The new cases: removed after the time, kept after a message, kept with zero.
- `pnpm typecheck` and the sdk suite pass.

## Resume

2026-11-12: blocked. Softov chose release as VS Code over deletion, so these steps are rewritten after the plan's open questions are answered.
