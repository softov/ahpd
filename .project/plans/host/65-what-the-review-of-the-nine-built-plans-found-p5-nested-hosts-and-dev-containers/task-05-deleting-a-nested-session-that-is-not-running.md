---
title: Deleting a nested session that is not running
status: todo
depends: [task-01-a-restart-waits-for-the-old-inner-host.md]
layer: "sdk, computer"
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L342-L381](../../../../packages/sdk/src/host/lifecycle.ts#L342-L381) - `removeSession`: a row not held goes straight to the backend's delete"
  - "[code://packages/sdk/src/nested.ts#L964-L983](../../../../packages/sdk/src/nested.ts#L964-L983) - only a running session disposes inside"
  - "[code://packages/computer/src/plugin.ts#L104-L110](../../../../packages/computer/src/plugin.ts#L104-L110) - `secretUnreadable` in the profile schema"
  - "[code://packages/computer/src/plugin.ts#L220](../../../../packages/computer/src/plugin.ts#L220) - and where a profile reads it"
---

## Objective

A profile's `nestedDelete` says what deleting a nested session that is not running does: `inside`, the default, starts the inner host in the session's machine when the machine is there, disposes the inner session, then deletes the outer record; `record` deletes the outer record only.
With `inside` and no machine, the outer record is deleted and the log says the inner copy went with the machine.

## Files

- `UPDATE: packages/computer/src/plugin.ts:104-110,220` - `nestedDelete: 'inside' | 'record'` in the profile schema and read, as `secretUnreadable` is; a value that is neither is refused at load as that key is.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:342-381` or the nested backend's `delete` - today a recorded nested session that is not running is deleted from the outer store and the record, and its inner transcript stays in the machine's store; a running one is disposed inside through `close`.
- `UPDATE: docs/COMPUTER.md:433` - a `nestedDelete` row in the profile table.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - the cases below.

## Steps

1. Failing case first: a nested session with a turn, the outer host restarted so it is only recorded, then deleted under a profile with no `nestedDelete`. Today the inner store still holds it; after, it does not.
2. The same with `nestedDelete: "record"`: the inner store still holds it, and the outer record is gone (passes before and after).
3. The same with `inside` and the machine removed first: the outer record is gone and the log names the machine.

## Validation

- The case in step 1 fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/sdk/test/nested-*.test.ts packages/computer/test/computer-options.test.ts`.

## Resume
