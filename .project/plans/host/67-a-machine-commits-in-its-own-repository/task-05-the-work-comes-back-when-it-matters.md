---
title: The work comes back when a turn ends, before an operation, when a session leaves and before a machine goes
status: todo
depends: [task-04-ahpd-brings-the-work-back-by-fetch.md]
layer: "sdk, computer"
refs:
  - "[code://packages/sdk/src/host/spawn.ts#L626-L634](../../../../packages/sdk/src/host/spawn.ts#L626-L634) - a finished or cancelled turn"
  - "[code://packages/sdk/src/host/machines.ts#L70-L80](../../../../packages/sdk/src/host/machines.ts#L70-L80) - `inMachine`, where a session leaves"
  - "[code://packages/sdk/src/changes.ts#L223-L345](../../../../packages/sdk/src/changes.ts#L223-L345) - the changeset operations"
  - "[code://packages/computer/src/runtime.ts#L2164-L2172](../../../../packages/computer/src/runtime.ts#L2164-L2172) - `remove`"
---

## Objective

ahpd calls `bringBack` for a session's machine when a turn ends or is cancelled, before any changeset operation runs on its folder, when the session leaves the machine, and `remove` calls it before the container goes; the facts and the changeset are read after it.

## Files

- `UPDATE: packages/sdk/src/host/spawn.ts:626-634` - `bringBack` of the machine the session is in (`enteredIn`), then `refreshFacts`.
- `UPDATE: packages/sdk/src/host/changesets.ts` - before an operation on a folder whose session is in a machine, `bringBack` first; a `waiting` answer refuses the operation with the log's sentence.
- `UPDATE: packages/sdk/src/host/machines.ts:70-80` - on leave, `bringBack` before the port's `leave`.
- `UPDATE: packages/computer/src/runtime.ts:2164-2172` - `remove` brings back first; a failure is logged and the removal goes on, the hidden ref kept.
- `UPDATE: packages/sdk/test/` - a fake `ComputerPort` counting calls.

## Steps

1. Failing case first: a fake port's `bringBack` is not called when a turn completes.
2. Wire the four moments; each failure is a log line, never a failed turn.
3. A changeset read does not call it (decision 1's row in the plan).

## Validation

- sdk test: `bringBack` once on `turnComplete`, once on `turnCancelled`, before `commit` runs, on leave; not on a changeset read; a rejection logs and the turn still completes.
- `computer-disposable.test.ts`: `remove` runs the bundle before `rm -f`.
- `npx vitest run packages/sdk/test packages/computer` passes.

## Resume
