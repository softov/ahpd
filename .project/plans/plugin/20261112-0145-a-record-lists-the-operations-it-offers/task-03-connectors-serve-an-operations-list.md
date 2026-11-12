---
title: Connectors serve an operations list
status: todo
depends: [task-01-a-record-lists-its-operations.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/connectors/channel.ts#L1654](../../../../packages/sdk/src/connectors/channel.ts#L1654) - the fixed enable and disable"
  - "[code://packages/sdk/src/clients/channel.ts#L192](../../../../packages/sdk/src/clients/channel.ts#L192) - a small channel on `OperationChannel`, the pattern to copy"
---

## Objective

`x-ahpd-connectors` serves an operations list, and each connector record carries the ids it offers now. The fixed `x-ahpd/connectors/*` methods keep working.

## Files

- `UPDATE: packages/sdk/src/connectors/channel.ts` - an `OperationChannel` for `x-ahpd-connectors://`, and `operations` on each record.
- `UPDATE: packages/server/src/commands/run.ts:1069` - the connectors channel is one of the channels `invokeOperation` finds.
- `UPDATE: packages/sdk/test/connectors-channel.test.ts` - the list, the ids and an invocation.

## Steps

1. List Enable, Disable, Sign in and Remove, with labels, the grants the fixed methods check, and Remove's confirmation.
2. Offer Enable on a disabled record and Disable on an enabled one.
3. Offer Sign in on a record whose adapter signs in, and Remove on every record.
4. Run each operation through the same code as its fixed method.
5. Register the connectors channel with `invokeOperation` as task 02 registers agents.

## Validation

- A test where an enabled connector lists Disable and not Enable.
- A test where Disable through `x-ahpd/invokeOperation` does what `x-ahpd/connectors/disable` does.
- A test where the fixed methods still answer.
- The sdk suite passes.

## Resume

