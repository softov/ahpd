---
title: Deleting a nested session that is not running
status: done
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

Implemented. `nestedDelete: 'inside' | 'record'` is a profile key in the computer plugin's schema, read by the profile reader beside `secretUnreadable` and refused at load by name when it is neither, the same `answers` list that holds the other four two-valued keys. The sdk side is a `NestedDelete` type and a `nestedDelete?(id)` on `ComputerPort`, `deleteNested` in `nested.ts`, and `deletedInside` in `host/lifecycle.ts`, called from `removeSession`'s not-held branch before the backend's delete.

`deleteNested` starts the machine's host through the port's `nested` seam, lists the inner host's sessions and disposes the one whose resource is the recorded inner id, bounded by `DISPOSE_WAIT`. Listing rather than opening is the point: a session this host is not running is one nobody asked to resume, and starting its agent only to delete it would be that resume. A machine that is not there, or a host that cannot be started, is a log line and not a throw, so the outer record is deleted either way: the machine's copy went with the machine, and the line says so. `record` returns before any of that.

The cases are in `nested-proxy.test.ts`, where they failed first with the call site neutered: case 1 as `expected [ 'cofold:/kept' ] to deeply equal []` and case 3 with no line matching `computer://box`, while case 2 passed before and after, as the task's step 2 says it should. The plugin's refusal case failed first as `expected [ { spec: ... } ] to deeply equal []` with its `answers` entry removed.

One thing met while writing the cases is worth keeping: `Host.close()` disposes inside the machines it holds today, `chat.close()` with no argument at `host.ts:844`, so stopping a host that ran a nested session leaves the machine with no copy of it. A case cannot reach "the outer host records it and the machine holds it" that way. `container/05 p9 task 05` is the unbuilt task that changes that call to `close('stopping')`, and this plan's task 05 does not touch `host.ts`, so the case stages the state the road to it leaves: `scriptedPort` gains `keep(channel)`, which puts a session in the machine's store with no host behind it, and `madeKeptAndStopped` says why in its comment.

Gates: `npx tsc -b` clean, `pnpm exec vitest run packages/sdk/test/nested-proxy.test.ts packages/computer/test/computer-options.test.ts` 63 passed.
