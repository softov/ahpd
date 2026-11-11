---
title: Each tool call says its status
status: todo
depends: [task-01-the-context-answers-vscodes-fields.md]
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/tools/session.ts#L221-L226](../../../../packages/sdk/src/tools/session.ts#L221-L226) - `CAPS`, whose `full` cut a call's error shares"
  - "[code://packages/sdk/src/tools/session.ts#L270-L280](../../../../packages/sdk/src/tools/session.ts#L270-L280) - the calls of a turn, a bare name at `digest` today"
  - https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/channels-chat/state.ts#L1223-L1236 - `ToolCallStatus`
  - https://github.com/microsoft/agent-host-protocol/blob/2c37a04f/types/channels-chat/state.ts#L1599-L1617 - a completed call's `success` and `error`, and a cancelled call's `reason`
---

## Objective

At `digest` and `full`, each tool call in a turn is `{ name, status }`.
A completed call adds `ok`, a cancelled call adds `reason`, and a call that failed adds `error`; `full` adds `input` as now.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts:270-280` - each call is an object with `status`, and `ok`, `reason` or `error` where its state has one.
- `UPDATE: packages/sdk/src/tools/session.ts:990-1006` - the `detail` description says what a call carries at each level.
- `UPDATE: packages/sdk/test/sessiontools.test.ts` - the cases in *Validation*.
- `UPDATE: docs/sdk/TOOLS.md` - a call's fields at each level.
- `UPDATE: docs/updates/v0_15.md` - under *Unreleased*, *Upgrading*: a call at `digest` is an object, not a name.

## Steps

1. Serialize each call at `digest` and `full` as `{ name, status }`, with `status` the call's own protocol word.
2. Add `ok` from a completed call's `success`.
3. Add `error` for a completed call whose `success` is false, from its `error.message`, cut to 200 characters.
4. Add `reason` for a cancelled call, such as `denied` or `skipped`.
5. Keep `input` at `full` only, cut as now.
6. Add one sentence on a call's status to the `detail` description, after VS Code's words.
7. Update the docs and the release notes.
8. Write the tests.

## Validation

- `packages/sdk/test/sessiontools.test.ts`: a call that ran reads `{ name, status: "completed", ok: true }` at `digest`.
- A call the person denied reads `status: "cancelled"` with `reason: "denied"`.
- A call that failed reads `ok: false` and its `error`, cut to 200 characters.
- A call still waiting for approval reads `status: "pending-confirmation"`.
- `full` adds `input`, and `summary` lists no calls.
- `pnpm typecheck` passes.
- `TMPDIR=/home/softov/tmp/ahpd-test npx vitest run packages/sdk` passes, then `packages/server`.

## Resume

