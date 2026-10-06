---
title: Only a call that never connected goes to the next provider
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/proxy/listener.ts#L339-L344](../../../../packages/server/src/proxy/listener.ts#L339-L344) - every fetch failure but the header timeout is `retry: true`"
  - "[code://packages/server/src/proxy/listener.ts#L185-L189](../../../../packages/server/src/proxy/listener.ts#L185-L189) - `failureOf`, which already reads the error's `cause.code`"
  - "[code://packages/server/test/proxy-forward.test.ts](../../../../packages/server/test/proxy-forward.test.ts) - the forwarding cases to extend"
---

## Objective

A call goes to the next candidate after a fetch failure only when the provider never received it: a connection refused, a name not found, a host unreachable, or a connect timeout.
Any other failure is answered 502 to the caller and not sent again.

## Files

- `UPDATE: packages/server/src/proxy/listener.ts:339-344` - `retry` is true only for a connect-phase code (`ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH`, `UND_ERR_CONNECT_TIMEOUT`); today it is true for every failure but the header timeout, so a provider that received the call and dropped the socket (`ECONNRESET`, `UND_ERR_SOCKET`) has it sent again to the next provider, spending twice.
- `UPDATE: packages/server/test/proxy-forward.test.ts` - the cases below.

## Steps

1. Failing case first: two candidates; the first is a server that reads the request body and destroys the socket without answering. Today the second receives the call too; after, the caller gets 502 and the second receives nothing.
2. A first candidate on a port nothing listens on still falls to the second (passes before and after).
3. Read the code from `cause.code` as `failureOf` does, and set `retry` from one set of connect-phase codes, named once beside `failureOf`.

## Validation

- The case in step 1 fails on `e1c4ccc` and passes after; step 2's passes both times.
- `pnpm exec vitest run packages/server/test/proxy-*.test.ts`.

## Resume
