---
title: The seven acknowledgements answer null
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/rpc.ts#L220](../../../../packages/sdk/src/rpc.ts#L220) - `result ?? {}`"
  - "[code://packages/sdk/src/host.ts#L7667](../../../../packages/sdk/src/host.ts#L7667) - `ping: async () => ({})`"
  - "[code://packages/sdk/src/host.ts#L8231](../../../../packages/sdk/src/host.ts#L8231) - `createTerminal`'s `return {}`"
  - "[code://packages/sdk/src/host.ts#L8242](../../../../packages/sdk/src/host.ts#L8242) - `disposeTerminal`'s"
  - "[code://packages/sdk/src/host.ts#L8867](../../../../packages/sdk/src/host.ts#L8867) - `createSession`'s"
  - "[code://packages/sdk/src/host.ts#L8991](../../../../packages/sdk/src/host.ts#L8991) - `createChat`'s"
  - "[code://packages/sdk/src/host.ts#L9022](../../../../packages/sdk/src/host.ts#L9022) - `disposeChat`'s"
  - "[code://packages/sdk/src/host.ts#L9026](../../../../packages/sdk/src/host.ts#L9026) - `disposeSession`'s"
  - "[code://packages/sdk/test/rpc.test.ts](../../../../packages/sdk/test/rpc.test.ts) - the peer's own tests"
---

## Objective

`ping`, `createSession`, `disposeSession`, `createChat`, `disposeChat`, `createTerminal` and `disposeTerminal` answer `"result": null` on the wire, and every other request answers what it does today.

## Files

- `UPDATE: packages/sdk/src/rpc.ts:220` - the shared result function p1 exported sends `null` as `null` and `undefined` as `{}`.
- `UPDATE: packages/sdk/src/host.ts:7667, 8231, 8242, 8867, 8991, 9022, 9026` - each returns `null`; any other path in those handlers that answers is read and made `null` too (a `return` inside a nested callback, such as `along` at :8805, is not an answer).
- `UPDATE: packages/sdk/test/wire.test.ts` - the seven `result is {}` lines leave `KNOWN`.
- `UPDATE: docs/AHP.md` - wherever a row says one of the seven answers `{}` (`rg -n "answers \`\{\}\`" docs/AHP.md`); `shutdown` keeps `{}`, being outside `CommandMap`.

## Steps

1. Change the shared function so `null` passes through.
2. Return `null` from the seven handlers, on every path that answers.
3. Run the suite and fix any test that asserted `{}` for these seven.

## Validation

- `packages/sdk/test/wire.test.ts` passes with the seven `result is {}` lines removed from `KNOWN`, and fails if any of the seven answers `{}` again.
- `packages/sdk/test/rpc.test.ts`: a handler answering `null` gives `{"jsonrpc":"2.0","id":1,"result":null}`, one answering `undefined` gives `"result":{}`.
- `pnpm test` passes.

## Resume
