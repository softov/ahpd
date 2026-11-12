---
title: The host says each step of a create
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/sessionmethods.ts#L1253](../../../../packages/sdk/src/host/sessionmethods.ts#L1253) - `createSession` reads the token"
  - "[code://packages/sdk/src/host/vscodemethods.ts#L556-L571](../../../../packages/sdk/src/host/vscodemethods.ts#L556-L571) - the broadcast to copy"
  - "[code://packages/sdk/src/machines/computers.ts#L77-L80](../../../../packages/sdk/src/machines/computers.ts#L77-L80) - the call to `computers.create`"
---

## Objective

A `createSession` with a `progressToken` gets a `root/progress` for each step the host reports, and one with `progress` equal to `total` at its answer.

## Files

- `UPDATE: packages/sdk/src/types/computers.ts:476-489` - `MachineSource` gets an optional `progress(message: string): void`.
- `UPDATE: packages/sdk/src/host/sessionmethods.ts:1253` - `createSession` reads `progressToken` and makes the `progress` function.
- `UPDATE: packages/sdk/src/machines/computers.ts:77-80` - the create passes `progress` in its `MachineSource`.
- `UPDATE: packages/sdk/src/host/lifecycle.ts:2676-2727` - the create says `Starting the agent` before the backend starts.
- `UPDATE: packages/sdk/test/` - a case for the token and a case without one.

## Steps

1. Add `progress?(message: string): void` to `MachineSource`, with a doc comment on what a step is.
2. In `createSession`, read `progressToken` with `optionalStringParam`, as `vscodemethods.ts:556` does.
3. Make a `progress` function that broadcasts `root/progress` with the token, the message and a rising `progress`.
4. Carry the function through the lifecycle create to `computers.create` and to the agent start.
5. Send `Starting the agent` before the backend starts.
6. Send the closing `root/progress` with `progress` equal to `total` when `createSession` answers or throws.
7. Write the sdk cases for a token and for no token.

## Validation

- The new sdk case sees each `root/progress` in order, then the closing one.
- A `createSession` with no token sends no `root/progress`.
- `pnpm typecheck` passes.

## Resume
