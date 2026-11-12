---
title: Connectors serve an operations list
status: implemented
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

1. List Enable, Disable and Remove, with labels, the grants the fixed methods check, and Remove's confirmation.
2. Offer Enable on a disabled record and Disable on an enabled one.
3. Offer Remove on every record. Sign in stays `x-ahpd/connectors/signin`, and no record lists it.
4. Run each operation through the same code as its fixed method.
5. Register the connectors channel with `invokeOperation` as task 02 registers agents.

## Validation

- A test where an enabled connector lists Disable and not Enable.
- A test where Disable through `x-ahpd/invokeOperation` does what `x-ahpd/connectors/disable` does.
- A test where the fixed methods still answer.
- The sdk suite passes.

## Resume

Implemented 2026-11-11 in the worktree; the reviewer commits. Files changed:

- `packages/sdk/src/connectors/channel.ts` - Enable, Disable and Remove as an `OperationChannel`, each row's `operations`, `offers`, and `removeOne` shared with the fixed command.
- `packages/sdk/src/types/kinds.ts` - `OperationScope` gains `connector`, with the comment.
- `packages/server/src/commands/run.ts` - the connectors channel joins `channels` in `run.ts`.
- `packages/sdk/test/connectors-channel.test.ts` - the ids by state, Disable and Remove through `x-ahpd/invokeOperation`, and the refusal of a second Disable.

Sign in stays `x-ahpd/connectors/signin`, as the Answers table says, and no record lists it. The fixed `enable`, `disable` and `remove` commands still answer: the operations call the same `toggleOne` and `removeOne`.

Checked: `pnpm exec tsc -p tsconfig.json --noEmit` at the root passes.

