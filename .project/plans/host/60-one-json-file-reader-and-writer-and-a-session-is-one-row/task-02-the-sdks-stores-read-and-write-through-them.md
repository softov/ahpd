---
title: The sdk's stores read and write through them
status: todo
depends: [task-01-one-json-file-reader-and-one-atomic-writer.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/policies.ts#L273-L323](../../../../packages/sdk/src/policies.ts#L273-L323) - `load` and `save`"
  - "[code://packages/sdk/src/scheduled.ts#L197-L207](../../../../packages/sdk/src/scheduled.ts#L197-L207) - the write"
  - "[code://packages/sdk/src/scheduled.ts#L278-L292](../../../../packages/sdk/src/scheduled.ts#L278-L292) - the read"
  - "[code://packages/sdk/src/users.ts#L540-L552](../../../../packages/sdk/src/users.ts#L540-L552) - `read`, an empty file as `{}`"
  - "[code://packages/sdk/src/users.ts#L672-L687](../../../../packages/sdk/src/users.ts#L672-L687) - `write`"
---

## Objective

`policies.ts`, `scheduled.ts` and `users.ts` read with the shared reader and write with the shared writer, and every message they say is the one they say today.

## Files

- `UPDATE: packages/sdk/src/policies.ts:273-323` - `load` maps each outcome to today's sentence (`missing` silent, `unreadable` "Could not read", `not-json` "is not JSON", the list check as now); `save` calls `writeJsonAtomic` inside its `try`.
- `UPDATE: packages/sdk/src/scheduled.ts:197-207,278-292` - the same; a read failure stays silent and a parse failure keeps its sentence.
- `UPDATE: packages/sdk/src/users.ts:540-552,672-687` - `read` keeps its empty-file check before the shared reader (open question 2); `write` keeps its broken-file refusal and calls `writeJsonAtomic`.

## Steps

1. Replace the read and write bodies only; the shape checks after a successful read stay in each store.

## Validation

- A pure refactor: `policies.test.ts`, `scheduled.test.ts`, `users.test.ts` and host 58's mode and temp-name cases stay green unchanged, their message assertions included.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk`.

## Resume
