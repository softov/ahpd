---
title: A token reaches only the sessions its connection watches - implemented
date: 2026-10-30
refs:
  - git://fadb8dcb - the change
  - "[code://packages/sdk/src/host/auth.ts#L24-L35](../../../../packages/sdk/src/host/auth.ts#L24-L35) - `watchedAs`, the name a connection watches a session under"
---

A token a client pushes for an MCP server is spent only on the sessions that client's connection watches, with or without a target.
Another client's session never gets it.
The connections asked to sign in for a session are the ones that watch it, each under its own spelling.

## What was built

- [`code://packages/sdk/src/host/auth.ts#L24-L35`](../../../../packages/sdk/src/host/auth.ts#L24-L35) - `watchedAs` finds the spelling a connection watches a session by, with the test `leaves` uses.
- [`code://packages/sdk/src/host/auth.ts#L37-L68`](../../../../packages/sdk/src/host/auth.ts#L37-L68) - `asking` tells each watcher under its own spelling.
- [`code://packages/sdk/src/host/auth.ts#L181-L198`](../../../../packages/sdk/src/host/auth.ts#L181-L198) - `channelAwaiting` looks only at the sessions the connection watches.
- [`code://packages/sdk/src/host/handshake.ts#L225-L233`](../../../../packages/sdk/src/host/handshake.ts#L225-L233) - `aimedAt` refuses a session the connection does not watch.
- [`code://packages/sdk/src/host/handshake.ts#L653-L672`](../../../../packages/sdk/src/host/handshake.ts#L653-L672) - a token with no target goes to the waiting chats of the watched sessions.
- [`code://packages/sdk/src/host/handshake.ts#L184-L192`](../../../../packages/sdk/src/host/handshake.ts#L184-L192) - an expiry names a session the connection watches.
- [`code://packages/sdk/test/authenticate-watching.test.ts`](../../../../packages/sdk/test/authenticate-watching.test.ts) - five cases with two clients on one host, and one client that watches under an older name.
- [`code://docs/sdk/AUTHENTICATION.md#L78`](../../../../docs/sdk/AUTHENTICATION.md#L78) and [`code://docs/sdk/AHP.md#L96`](../../../../docs/sdk/AHP.md#L96) - the sessions a connection asks for are the ones it watches.

## Verified

- On the first plan's host, all five cases in `authenticate-watching.test.ts` fail.
  Bea's server took Ana's token, and Cy's token and Bea's target at Ana's session resolved `{}`.
  The client watching `claude:/one` was never asked to sign in, and Bea's expiry named Ana's session.
- With the change, the new file passes with `authenticate-target.test.ts`, `nested-proxy.test.ts`, `host-handshake.test.ts`, `toolauth.test.ts`, `users-host.test.ts` and `host-harness.test.ts`, 167 tests.
- `host-github.test.ts`, `connectors-signin.test.ts` and `agent-acp-signin.test.ts` pass, 36 tests.
- The type check passes.

## Departures from the plan

- none.

## Left for later

- none.
