---
title: moveChat is refused as VS Code refuses it
status: dropped
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L1021-L1026](../../../../packages/sdk/src/host.ts#L1021-L1026) - the unknown-method answer `moveChat` reaches"
  - "[code://packages/sdk/test/host-handshake.test.ts#L98-L200](../../../../packages/sdk/test/host-handshake.test.ts#L98-L200) - `what it will not pretend`, the describe the new case joins"
  - "[code://docs/AHP.md#L75-L76](../../../../docs/AHP.md#L75-L76) - the `createChat` and `disposeChat` rows the `moveChat` row goes beside"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1720-L1722 - `MethodNotFound` for `moveChat`"
---

## Objective

`moveChat` is answered `-32601` after the handshake, and no chat state, chat summary or session catalogue entry carries `movable`, so a test fails the day either changes without a decision.

## Files

- `UPDATE: packages/sdk/test/host-handshake.test.ts` - two cases in `what it will not pretend`.
- `UPDATE: docs/AHP.md` - a `moveChat` row beside `createChat`: not served, as in VS Code's agent host, and no chat says it is movable.

## Steps

1. Add the test that sends `moveChat` with `{ channel: <a peer chat>, destination: { kind: 'session', session: <its session> } }` to a running session and expects `-32601`.
2. Add the test that opens a session with two peer chats and a worker, reads the session snapshot, each chat snapshot and the `listSessions` row, and expects no `movable` key anywhere.
3. Write the docs row; `host.ts` does not change.

## Validation

- `pnpm exec vitest run packages/sdk/test/host-handshake.test.ts -t "will not pretend"` passes, with the two new cases.
- `pnpm test` passes.

## Resume

Dropped 2026-10-03: Softov chose to build reordering and moving ("build both"), which tasks 02-04 cover.
