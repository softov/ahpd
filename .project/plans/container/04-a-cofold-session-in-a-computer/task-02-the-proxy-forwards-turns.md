---
title: The proxy opens an inner session and forwards turns
status: implemented
depends: [task-01-a-computer-starts-a-nested-host.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/rpc.ts#L74-L100](../../../../packages/sdk/src/rpc.ts#L74-L100) - a `Wire` over the spawn's stdio"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `AhpClient`
---

## Objective

`nestedAgent(provider)` is an `Agent` whose session starts the nested host, initializes, creates the inner session with the same config minus `computer`, subscribes, forwards `begin` and `queue` as dispatches, and emits the inner session's chat and session actions as its own.

## Files

- `CREATE: packages/sdk/src/nested.ts`
- `UPDATE: packages/sdk/src/index.ts`

## Steps

1. A stdio `Wire` over `createPeer`, framed as `--stdio` frames them.
2. The inner turn ids are the outer ones.

## Validation

- `test/nested-proxy.test.ts`: an inner `createHost` with the echo agent over an in-memory pipe; a turn goes in and its actions come out unchanged.

## Resume

Implemented 2026-09-26.
`packages/sdk/src/nested.ts` creates the proxy: `nestedAgent(provider | agent, options)` returns an `Agent` that keeps everything the real backend answers before a session exists and replaces only `create`.
The default start asks `start.computers.nested(id, { plugins, cwd })` and spawns the descriptor here; `NestedOptions.start` is the seam a test uses to hand it an in-memory pipe instead.
A line framer over the spawn's stdout is an `AhpTransport`, and `AhpClient` does the handshake: `initialize` with this build's `SUPPORTED_PROTOCOL_VERSIONS`, `createSession` with the session's config minus `computer`, then `subscribe` to the inner session and to the default chat it named.
Turns sent before the inner session exists wait behind a gate in order; a chat action is forwarded to the outer chat channel and a session action to the outer session channel, with the turn ids untouched.
The inner state is reduced with `sessionReducer`/`chatReducer` beside the forwarding, so `sessionState()`/`chatState()` answer a late subscriber.
A departure from the task's step 1: `createPeer` is not used inside the proxy - `AhpClient` owns both directions over the transport, and `createPeer`/`receive` are what the test's inner `createHost` answers on the other end of the pipe.
Validated by `test/nested-proxy.test.ts`: a turn goes in and its actions come out unchanged.
