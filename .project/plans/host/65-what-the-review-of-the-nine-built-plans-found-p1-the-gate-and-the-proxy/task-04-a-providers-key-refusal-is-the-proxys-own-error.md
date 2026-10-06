---
title: A provider's key refusal is the proxy's own error
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/proxy/listener.ts#L394-L403](../../../../packages/server/src/proxy/listener.ts#L394-L403) - a 401 or 403 is streamed back with the provider's body"
  - "[code://packages/server/src/proxy/dialects.ts#L91](../../../../packages/server/src/proxy/dialects.ts#L91) - `refusalBody`"
  - "[code://packages/server/test/proxy-forward.test.ts](../../../../packages/server/test/proxy-forward.test.ts) - the forwarding cases to extend"
---

## Objective

A provider's 401 or 403 reaches the caller as the dialect's own error with status 502, saying the host's provider refused the host's key for that model; the provider's status and message are on the daemon's log line (decision [the-proxy-answers-a-providers-key-refusal-with-its-own-error](../../../decisions/the-proxy-answers-a-providers-key-refusal-with-its-own-error.md)).

## Files

- `UPDATE: packages/server/src/proxy/listener.ts:394-403` - a 401 or 403 is read (bounded), logged through `said`, and answered with `refuse(...)`; today `streamed` returns it as it came, so a client reads a 401 as its own token being wrong and sees the provider's body.
- `UPDATE: packages/server/test/proxy-forward.test.ts` - the cases below.

## Steps

1. Failing case first, for each dialect: the provider answers 401 with a body naming an account. Today the caller gets 401 and that body; after, 502 and the dialect's error, the body nowhere in it, and the log line holds the provider's status and message.
2. The same for 403.
3. Read the provider's body up to a bound for the log, cancel the rest, and answer through `refusalBody`.

## Validation

- Both cases fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/server/test/proxy-*.test.ts`.

## Resume
