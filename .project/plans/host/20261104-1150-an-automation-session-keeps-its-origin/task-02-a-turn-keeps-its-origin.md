---
title: A restored turn keeps its message origin
status: implemented
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/localturns.ts#L125-L139](../../../../packages/sdk/src/host/localturns.ts#L125-L139) - `Recorded` and its reader"
  - "[code://packages/sdk/src/host/localturns.ts#L289-L294](../../../../packages/sdk/src/host/localturns.ts#L289-L294) - `turnRecordedAs`"
  - "[code://packages/sdk/src/host/localturns.ts#L387-L426](../../../../packages/sdk/src/host/localturns.ts#L387-L426) - `asBegun` and `transcriptOf`"
  - "[code://packages/sdk/src/host/spawn.ts#L1279](../../../../packages/sdk/src/host/spawn.ts#L1279) - where a started turn is recorded"
---

## Objective

The host records the message origin of each turn a chat began, when it is not `user`.
A read after a restart gives each recorded turn that origin back.

## Files

- `UPDATE: packages/sdk/src/host/localturns.ts:125-139` - `Recorded` gains an optional `origin`; the reader keeps one only when it is an object with a string `kind`.
- `UPDATE: packages/sdk/src/host/localturns.ts:289-294` - `turnRecordedAs` takes an optional origin and writes it.
- `UPDATE: packages/sdk/src/host/localturns.ts:387-426` - `transcriptOf` sets the recorded origin on each recorded turn's message.
- `UPDATE: packages/sdk/src/host/localturns.ts:43` - the `turnRecordedAs` signature gains the origin.
- `UPDATE: packages/sdk/src/host/spawn.ts:1279` - pass `action.message.origin` when its kind is not `user`.
- `UPDATE: packages/sdk/src/host/spawn.ts:1697-1699` - carry the recorded origin to the record under the backend's id.
- `UPDATE: packages/sdk/test/host-local-turns.test.ts` - cases for a recorded origin, and for a record file without one.

## Steps

1. Add `origin?: Bag` to `Recorded`, and keep it in `recordedOf` only when it has a string `kind`.
2. Give `turnRecordedAs` an optional origin, and write it in the record file.
3. At `spawn.ts:1279`, pass the started message's origin when its kind is not `user`.
4. In `onTurnRecorded`, look up the origin recorded for the turn id, and pass it with the new id.
5. In `transcriptOf`, set the recorded origin on the message of each turn whose transcript id has one.
6. Apply the origin before the fold, so a folded turn does not move it.
7. Add a case: a turn recorded with origin `automation` reads back with that origin.
8. Add a case: a record file without `origin` reads back with the transcript's origin.

## Validation

- `packages/sdk/test/host-local-turns.test.ts` holds both cases, and every case passes.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the sdk and agent-claude tests pass.

## Resume

- **Done so far:** a `Recorded` file holds an optional `origin`, kept only when it is an object with a string `kind`.
`turnRecordedAs` writes it, spawn passes a started message's origin when its kind is not `user`, and `onTurnRecorded` carries the origin to the record under the backend's id.
`transcriptOf` sets each recorded origin on its transcript turn before `asBegun` folds them.
- **Next action:** none; `implemented.md` records what was verified.
- **Open questions:** none.
- **Watch out for:** [claude/20261104-1150-a-background-task-end-is-a-notice](../claude/20261104-1150-a-background-task-end-is-a-notice/plan.md) builds on this branch and changes `asBegun`.
The origin is applied before the fold, so a turn folded into one before it keeps the earlier message's origin.

Files changed by this task: `packages/sdk/src/host/localturns.ts`, `packages/sdk/src/host/spawn.ts`, `packages/sdk/test/host-local-turns.test.ts`.

