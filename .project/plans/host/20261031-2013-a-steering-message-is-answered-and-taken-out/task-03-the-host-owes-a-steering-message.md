---
title: The host owes a steering message, so a session in a machine answers it
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1219-L1233](../../../../packages/sdk/src/host/chatactions.ts#L1219-L1233) - a client's steering message, handed to the session"
  - "[code://packages/sdk/src/sessions/nested.ts#L1308-L1313](../../../../packages/sdk/src/sessions/nested.ts#L1308-L1313) - the proxy's `steer`"
---

## Objective

A steering message a client sends to a session in a machine is answered by the host inside, and that answer reaches the client with its own origin.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts` - a steering message is owed, as a queued one is, before it is handed to the session.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - a steering message on a nested session carries the origin of the client outside that sent it.

## Steps

1. Write the case and run it on `ab07054c` to see the answer go out with no origin.
2. Owe the message.

## Validation

- The new case fails on `ab07054c` and passes after the change.
- `nested-proxy`, `echo-origin`, `host-input` and `host-senders` pass.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Resume
