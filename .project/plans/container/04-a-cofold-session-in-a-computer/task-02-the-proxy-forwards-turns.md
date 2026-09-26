---
title: The proxy opens an inner session and forwards turns
status: todo
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
