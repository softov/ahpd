---
title: Input goes to every client of the terminal
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/actions.ts#L878-L893](../../../../packages/sdk/src/host/actions.ts#L878-L893) - the input case"
  - "[code://packages/sdk/src/host.ts#L874-L886](../../../../packages/sdk/src/host.ts#L874-L886) - `emit`'s comment, which names `echoTo`"
  - "[code://packages/sdk/src/host.ts#L1170-L1241](../../../../packages/sdk/src/host.ts#L1170-L1241) - `refuse` and `echoTo`"
  - "[code://packages/sdk/src/host/context.ts#L415-L444](../../../../packages/sdk/src/host/context.ts#L415-L444) - `refuse` and `echoTo` in the context"
  - "[code://packages/sdk/test/host-terminals.test.ts#L726-L779](../../../../packages/sdk/test/host-terminals.test.ts#L726-L779) - the two input cases"
---

## Objective

Input the terminal takes goes to every client subscribed to the terminal, at the next `serverSeq`, and is held for replay.
Input the terminal cannot take is refused to the same clients, and held for replay.

## Files

- `UPDATE: packages/sdk/src/host/actions.ts:878-893` - taken input goes through `dispatch`, and its refusal through `no` with the default audience.
- `UPDATE: packages/sdk/src/host.ts:874-886` - `emit`'s comment says `serverSeq` moves there for every accepted action.
- `UPDATE: packages/sdk/src/host.ts:1170-1241` - `refuse` names the gate as its one `alone` refusal, and `echoTo` goes.
- `UPDATE: packages/sdk/src/host/context.ts:415-444` - `echoTo` goes from the context.
- `UPDATE: packages/sdk/test/host-terminals.test.ts:726-779` - the two input cases expect every client of the terminal.
- `UPDATE: docs/sdk/AHP.md` - the `terminal/input` row, the refusal paragraph and the paragraph on accepted actions.

## Steps

1. Send taken input with `dispatch(channel, action, origin)`.
2. Refuse input with no process to reach with `no(taken)`, so it reaches every client of the terminal.
3. Remove `echoTo` from `host.ts`, `context.ts` and the destructuring in `actions.ts`.
4. Rewrite the comments in `emit`, `refuse` and the input case for the new audience.
5. Rewrite the `terminal/input` row and the two paragraphs in `AHP.md`.
6. Change the two input cases to expect the input, and its refusal, at the other client too.

## Validation

- `packages/sdk/test/host-terminals.test.ts`: the two input cases fail on `89ebe4d5` and pass after the change.
- `host-terminals`, `host-output-terminals`, `users-gate-dispatch`, `users-gate-names` and `conformance` pass.
- This task's *Resume* names each test file whose assertion moves with the behavior.
- `pnpm run typecheck` is clean.

## Resume

Not started.
