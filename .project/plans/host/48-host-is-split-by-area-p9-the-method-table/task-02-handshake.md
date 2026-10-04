---
title: Introduction and sign-in are one file
status: todo
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
