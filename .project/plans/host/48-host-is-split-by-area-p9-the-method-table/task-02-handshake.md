---
title: Introduction and sign-in are one file
status: implemented
depends: [task-01-the-classification-test-reads-every-file.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L7380-L7468](../../../../packages/sdk/src/host.ts#L7380-L7468) - `tokensFor`, `expiring`, `LONGEST`, `expire`, `forgetExpiry`"
  - "[code://packages/sdk/src/host.ts#L7763-L8077](../../../../packages/sdk/src/host.ts#L7763-L8077) - `initialize`, `ping`, `reconnect`"
  - "[code://packages/sdk/src/host.ts#L8560-L8706](../../../../packages/sdk/src/host.ts#L8560-L8706) - `authenticate`"
---

## Objective

`host/handshake.ts` exports a per-connection factory that holds the token expiry and returns `initialize`, `ping`, `reconnect` and `authenticate`, unchanged.

## Files

- `CREATE: packages/sdk/src/host/handshake.ts` - `tokensFor`, `expiring`, `LONGEST`, `expire`, `forgetExpiry`, and the four methods.
- `UPDATE: packages/sdk/src/host.ts` - those removed; `accept` builds the factory from `ctx` and the `ConnectionContext`, and spreads its methods first into `handlers`.

## Steps

1. Move each declaration and method with its comment, unchanged but for indentation.
2. `handshook` becomes `conn.handshook` on the `ConnectionContext`; `initialize`, `reconnect` and `handle` read and write it there.
3. `tokensFor` and `forgetExpiry` go on the `ConnectionContext`, for `createSession`, the dispatch branches and `handle`'s close.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass; `test/users-*.test.ts`, `test/toolauth.test.ts`, `test/listen-identity.test.ts` cover sign-in and expiry.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume

Built 2026-10-04. `packages/sdk/src/host/handshake.ts` (559 lines) holds `tokensFor`, `expiring`, `LONGEST`, `expire`, `forgetExpiry` and the four methods, and returns them as a table `accept` spreads first into `handlers`. `host.ts` is 4,548 lines, down from 5,077.

The per-connection state is built once in `accept` as `const conn = { connection, storeFor } as ConnectionContext` - the same `as` idiom `ctx` already uses - and `admit` is assigned onto it from `createAdmission` before `createHandshake(ctx, conn)` runs. `handshake` hands `tokensFor`, `expiring` and `forgetExpiry` back the same way, because `handle`'s close walks `expiring` to stop the clocks of tokens that went with the connection.

`HostContext` grew five fields the moved code reads: `dir`, `known`, `replayable`, `seenBy` and `leaves`. The last two are the funnel the parent's table says stays in `host.ts` - `seenBy` is what `reconnect`'s replay and `subscribe` both call, and `leaves` is what `reconnect` calls when a client does not resume a channel it was watching.

The move was done by extracting the exact source ranges and de-indenting by four, so the bodies are the ones in the tree.

Validation: `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` all pass, 176 files and 2,707 tests. `users-gate.test.ts` still finds the 45 task 01 recorded.
