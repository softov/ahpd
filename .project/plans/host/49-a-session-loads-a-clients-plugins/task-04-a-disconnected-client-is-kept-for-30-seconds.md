---
title: A disconnected client is kept for 30 seconds
status: done
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

## Outcome

`CLIENT_DISCONNECT_GRACE_MS = 30_000` is declared in `packages/sdk/src/host.ts` beside `HOST_CLOSE_WAIT_MS`, module-private: nothing outside this file reads it, and the number a client depends on is the behaviour rather than the constant.

The wait itself is three things in the same file. `graces` is the map of what is being waited on, keyed `<session>\u0000<clientId>`. `waitsOut(channel, clientId)` is what a connection's close now calls in place of `leaves` - once per channel it was watching - and it begins nothing for a client that holds no place in the session, which is every session a connection watched without ever announcing itself in it. `waitingOver(channel, clientId)` calls a wait off. `gracesOver()` clears every one, and `Host.close` runs it as the first thing after `deltas.stop()`, because a wait outliving the host would dispatch a removal for a session the close below is taking down anyway.

`leaves` is unchanged and is what the timer runs when it expires. It still checks every connection for one of that client watching the session, so a wait whose client came back by another window, or resubscribed while the timer was pending, ends in nothing being said.

Four things the plan left open or stale. The task names `packages/sdk/src/host/handshake.ts`, and it needed no change: `initialize` and `reconnect` subscribe through the same `snapshotOf` the `subscribe` command does, so the clear is one call in the wrapper `host.ts` already puts over `ctx.snapshotOf` - which leaves the ordinary subscription, served from `host/sessionmethods.ts`, covered without this task reaching into a file it does not name. The task says "a timer per (session, clientId) started on close" without saying what a second close does: a later close of the same client starts the wait again rather than leaving the first one running, because what is being measured is how long the client has been gone. The unsubscribe notification and `reconnect`'s drop of what was not asked back for are untouched, as the task says - both call `leaves` at once. And `presence.test.ts` drives the example backend, which has no client tool calls of its own, so "the tool is still offered" is read where a backend is told what to offer (`setTools`) and "the call fails" is read as the chat being told the client is gone (`clientGone`) - the call `clientcalls.ts` fails the pending work on.

`packages/sdk/test/presence.test.ts` keeps its three-ways case whole and adds the wait to it: unsubscribe and a reconnect without resubscribing still remove at once, and a connection that closes removes thirty seconds later. Two new cases sit beside it - a client that dropped, with its tool, at 29 999 ms and at 30 000 ms, and one that subscribes again on a new connection at 10 s, which is still in `activeClients` at 40 s with its tool offered, nothing said about it, and its chat started exactly once. A third closes a host with a wait pending and finds no timer left. The clock is faked only for these cases, with `setTimeout` and `clearTimeout` alone, so the suite's own waits keep working.
