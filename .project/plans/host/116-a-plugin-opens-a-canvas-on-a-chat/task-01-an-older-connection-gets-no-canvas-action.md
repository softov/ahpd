---
title: An older connection gets no canvas action
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/handshake.ts#L149-L227](../../../../packages/sdk/src/host/handshake.ts#L149-L227) - the negotiation, where `agreed` is known"
  - "[code://packages/sdk/src/types/host.ts#L1084-L1175](../../../../packages/sdk/src/types/host.ts#L1084-L1175) - `Connection`, which gets the agreed version"
  - "[code://packages/sdk/src/host.ts#L622-L686](../../../../packages/sdk/src/host.ts#L622-L686) - `seenBy`, the one per-connection filter"
  - "[code://packages/sdk/test/host-handshake.test.ts#L37-L62](../../../../packages/sdk/test/host-handshake.test.ts#L37-L62) - the silence test, which this task replaces"
  - npm://@microsoft/agent-host-protocol@1.0.0 - `isActionKnownToVersion(action, clientVersion)` (`src/types/version/registry.ts:216`)
  - https://github.com/microsoft/agent-host-protocol/blob/main/docs/specification/versioning.md - L120, no newer-version-only behaviour on an older connection
---

## Objective

Each connection keeps the protocol version it agreed on.
`seenBy` holds back an action that the agreed version does not know, so a `0.9.0` connection gets no canvas action live or in a replay.

## Files

- `UPDATE: packages/sdk/src/types/host.ts:1084-1175` - add `protocolVersion?: string` to `Connection`, with a comment that says what it holds.
- `UPDATE: packages/sdk/src/host/handshake.ts:149-227` - set `connection.protocolVersion` to `agreed` before the snapshots are read.
- `UPDATE: packages/sdk/src/host.ts:622-686` - return `undefined` when `isActionKnownToVersion` is false for the connection's version.
- `UPDATE: packages/sdk/test/host-handshake.test.ts:37-62` - replace the silence test with the version gate tests.

## Steps

1. Add `protocolVersion` to `Connection`.
2. Set it in the handshake when the negotiation gives `agreed`.
3. In `seenBy`, after the audience checks, return `undefined` for an action that the connection's version does not know.
4. Keep a connection with no version, such as one built by a test, unfiltered.
5. Replace the silence test with the tests in Validation, using a host-dispatched `chat/canvasesChanged`.

## Validation

- `host-handshake.test.ts`: a `0.9.0` connection gets no `chat/canvasesChanged` live.
- `host-handshake.test.ts`: a `0.9.0` connection that reconnects gets no `chat/canvasesChanged` in its replay.
- `host-handshake.test.ts`: a `0.10.0` connection and a `1.0.0` connection get the action.
- Run `pnpm --filter @ahpd/sdk test` and expect every case to pass.
- Run `git checkout -- packages/sdk/test/fixtures/wire.jsonl` after the run.

## Resume
