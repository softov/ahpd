---
title: The seven acknowledgements answer null
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/rpc.ts#L183](../../../../packages/sdk/src/rpc.ts#L183) - `resultFrame`, the one road a handler's answer leaves by"
  - "[code://packages/sdk/src/host/handshake.ts#L286](../../../../packages/sdk/src/host/handshake.ts#L286) - `ping: async () => null`"
  - "[code://packages/sdk/src/host/terminals.ts#L323](../../../../packages/sdk/src/host/terminals.ts#L323) - `createTerminal`'s answer"
  - "[code://packages/sdk/src/host/terminals.ts#L334](../../../../packages/sdk/src/host/terminals.ts#L334) - `disposeTerminal`'s"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L606](../../../../packages/sdk/src/host/sessionmethods.ts#L606) - `createSession`'s"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L730](../../../../packages/sdk/src/host/sessionmethods.ts#L730) - `createChat`'s"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L761](../../../../packages/sdk/src/host/sessionmethods.ts#L761) - `disposeChat`'s"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L768](../../../../packages/sdk/src/host/sessionmethods.ts#L768) - `disposeSession`'s"
  - "[code://packages/sdk/test/rpc.test.ts](../../../../packages/sdk/test/rpc.test.ts) - the peer's own tests"
---

## Objective

`ping`, `createSession`, `disposeSession`, `createChat`, `disposeChat`, `createTerminal` and `disposeTerminal` answer `"result": null` on the wire, and every other request answers what it does today.

## Files

- `UPDATE: packages/sdk/src/rpc.ts:183` - the shared result function p1 exported sends `null` as `null` and `undefined` as `{}`.
- `UPDATE: packages/sdk/src/host/handshake.ts:286` and `packages/sdk/src/host/terminals.ts:323, 334` and `packages/sdk/src/host/sessionmethods.ts:606, 730, 761, 768` - each returns `null`; any other path in those handlers that answers is read and made `null` too (a `return` inside a nested callback, such as `along` at `sessionmethods.ts:543`, is not an answer).
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
