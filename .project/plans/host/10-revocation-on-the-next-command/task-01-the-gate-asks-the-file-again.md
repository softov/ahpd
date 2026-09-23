---
title: The gate asks the file again
status: done
depends: []
layer: packages/sdk
refs:
  - "[code://packages/sdk/src/types/users.ts#L34-L60](../../../../packages/sdk/src/types/users.ts#L34-L60) - `Principal`, which gains `standing`"
  - "[code://packages/sdk/src/users.ts#L177-L205](../../../../packages/sdk/src/users.ts#L177-L205) - `principalOf`, which resolves from the file"
  - "[code://packages/sdk/src/host.ts#L7553-L7580](../../../../packages/sdk/src/host.ts#L7553-L7580) - the command gate"
  - "[code://packages/sdk/src/host.ts#L6346-L6365](../../../../packages/sdk/src/host.ts#L6346-L6365) - the dispatch gate"
---

## Objective

A principal resolves through the directory on every question, so a removed person is answered `-32007` and a changed role is in force on the next command.

## Files

- `UPDATE: packages/sdk/src/types/users.ts` - `Principal.standing?()`, with the comment saying absent means still standing.
- `UPDATE: packages/sdk/src/users.ts` - `principalOf` returns a live `standing` and `can`; `grantsOf` gains the `complain` flag so the undefined-role line is said once at verification.
- `UPDATE: packages/sdk/src/host.ts` - both gates ask `standing` before `can`.
- `UPDATE: test/users-gate.test.ts` - a real `fileUsers`: a role change answers `-32009`, removal answers `-32007`, both on the next command.

## Steps

1. Add `standing?(): boolean` to `Principal`, documented as the record still being there.
2. Have `grantsOf` take a `complain` flag, defaulting true, and be called once at `principalOf` with it and once per `can` without it.
3. Have `principalOf` read the file for `standing` and for `can`, answering false when the record is gone.
4. Ask `standing` in both gates, refusing `-32007` on the command path and the same message through `no` on the dispatch path.
5. Add the gate test with a real directory rather than the hand-made one, because the behaviour under test is the file being re-read.

## Validation

- `test/users-gate.test.ts` - sign in with `member`, `listSessions` served; `add` the same person a role nothing defines and it answers `-32009`; `remove` them and it answers `-32007`, both without reconnecting.
- `test/users.test.ts` unchanged and green, including the undefined-role complaint being said once.
- `pnpm test`, `pnpm typecheck`, `pnpm boundary` and `pnpm build` green.

## Resume

Done 2026-09-23.
`Principal.standing` and the live `can` are in; both gates ask standing first; `grantsOf` says the undefined-role line only at verification.
Found: the existing `test/users.test.ts` caught the first cut, where the complaint moved entirely to the first `can` and was therefore never said for a principal nobody asked about. It is now said once at verification and never per command.
