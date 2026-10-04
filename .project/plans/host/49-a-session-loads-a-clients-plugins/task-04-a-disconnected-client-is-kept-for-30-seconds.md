---
title: A disconnected client is kept for 30 seconds
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L658-L679](../../../../packages/sdk/src/host.ts#L658-L679) - `leaves`: `session/activeClientRemoved`, then the client's tools and pending calls go"
  - "[code://packages/sdk/src/host.ts#L1128-L1135](../../../../packages/sdk/src/host.ts#L1128-L1135) - a connection closing calls `leaves` at once, the path that waits from now on"
  - "[code://packages/sdk/src/host.ts#L976-L983](../../../../packages/sdk/src/host.ts#L976-L983) - an explicit unsubscribe, which still leaves at once"
  - "[code://packages/sdk/src/host/handshake.ts#L370-L373](../../../../packages/sdk/src/host/handshake.ts#L370-L373) - a reconnect that does not subscribe again, which still leaves at once"
  - "[code://packages/sdk/test/host-close.test.ts#L188](../../../../packages/sdk/test/host-close.test.ts#L188) - `vi.useFakeTimers()` in this suite"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/protocolServerHandler.ts#L87 - `CLIENT_TOOL_CALL_DISCONNECT_TIMEOUT = 30_000`"
  - "https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1145-L1192 - the client stays active through the window, a resubscribe keeps its slot, the timeout removes it and fails its pending tool calls, an unsubscribe or a reconnect without resubscription removes it sooner"
---

## Objective

A client whose connection closes stays in each session it was active in, with its tools, its plugins and its pending tool calls, for 30 seconds; if it subscribes to the session again within that time nothing is dispatched and no chat restarts; otherwise `leaves` runs as today when the time is up.

## Files

- `UPDATE: packages/sdk/src/host.ts`, `packages/sdk/src/host/handshake.ts` - `CLIENT_DISCONNECT_GRACE_MS = 30_000`; a timer per `(session, clientId)` started on close in place of the immediate `leaves`; a subscribe from the same `clientId` clears it; the timer runs `leaves`, which still checks that no connection of that client watches the session; `close()` clears every timer.
- `UPDATE: packages/sdk/test/presence.test.ts` - the cases below.

## Steps

1. Replace the `leaves` on close with the timer; leave the unsubscribe and reconnect paths immediate.
2. Clear the timer when the client subscribes to the session again, and on host close.

## Validation

- `packages/sdk/test/presence.test.ts`, with `vi.useFakeTimers()`: a client with a tool and a client plugin disconnects, and at 29 999 ms no `session/activeClientRemoved` has been sent, the tool is still offered and a pending client tool call is still pending; at 30 000 ms the removal is sent, the tool is gone and the call fails; a client that reconnects and subscribes again at 10 s causes no removal, no `session/activeClientSet` echo and no chat restart, and nothing fires at 30 s; an explicit unsubscribe removes at once; closing the host leaves no timer.
- `pnpm test` passes.

## Resume
