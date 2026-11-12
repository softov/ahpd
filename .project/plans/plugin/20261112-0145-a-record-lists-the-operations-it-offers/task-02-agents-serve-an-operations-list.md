---
title: Agents serve an operations list
status: implemented
depends: [task-01-a-record-lists-its-operations.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/agents/channel.ts#L40-L50](../../../../packages/sdk/src/agents/channel.ts#L40-L50) - the fixed methods that stay"
  - "[code://packages/sdk/src/clients/channel.ts#L192](../../../../packages/sdk/src/clients/channel.ts#L192) - a small channel on `OperationChannel`, the pattern to copy"
---

## Objective

`x-ahpd-agents` serves an operations list, and each agent record carries the ids it offers now. The fixed `x-ahpd/agents/*` methods keep working.

## Files

- `UPDATE: packages/sdk/src/agents/channel.ts` - an `OperationChannel` for `x-ahpd-agents://`, and `operations` on each record.
- `UPDATE: packages/server/src/commands/run.ts:1069` - the agents channel is one of the channels `invokeOperation` finds, beside tunnels and clients.
- `UPDATE: packages/sdk/test/agents-channel.test.ts` - the list, the ids and an invocation.

## Steps

1. List Enable, Pause, Disable, Check and Remove, with labels, the grants the fixed methods check, and Remove's confirmation.
2. Offer Enable on a paused or disabled record, and Pause on an enabled one.
3. Offer Disable on an enabled or paused record.
4. Offer Check on a record that is not paused or disabled, and Remove on every record.
5. Run each operation through the same code as its fixed method, so the two never differ.
6. Add the agents channel to `channels` at `run.ts:1069`, beside tunnels and clients.

## Validation

- A test where a paused agent lists Enable and Disable, and not Pause.
- A test where Pause through `x-ahpd/invokeOperation` writes `mode: paused`, as `x-ahpd/agents/pause` does.
- A test where the fixed methods still answer.
- The sdk suite passes.

## Resume

Implemented 2026-11-11 in the worktree; the reviewer commits. Files changed:

- `packages/sdk/src/types/kinds.ts` - `OperationScope` gains `agent`, with the comment.
- `packages/sdk/src/agents/channel.ts` - the five operations, each row's `operations`, `offers`, `run`, and `removeOne` and `checkOne` shared with the fixed commands.
- `packages/server/src/commands/run.ts` - the agents channel joins `channels` in `run.ts`.
- `packages/sdk/test/agents-channel.test.ts` - the ids by mode, Pause through `x-ahpd/invokeOperation`, and the refusal of a second Pause.

Checked: `pnpm exec tsc -p tsconfig.json --noEmit` at the root passes.

