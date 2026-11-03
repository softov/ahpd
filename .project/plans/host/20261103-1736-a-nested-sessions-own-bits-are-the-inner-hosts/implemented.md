---
title: A nested session's own bits are the inner host's - implemented
date: 2026-11-03
refs:
  - git://f31a0d8e - the change
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts)"
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts)"
---

A client's read and archive of a session nested in a machine go to the host inside, which answers the client.
The session bits the host inside says are kept here through `sessionFlag`, said once.
This host moves none of a nested session's bits at a turn's end, after a chat's read, or at a merged pull request.

## What was built

- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - `flag` names the chat's or the session's bit.
- [`code://packages/sdk/src/sessions/nested.ts`](../../../../packages/sdk/src/sessions/nested.ts) - the proxy carries a session bit on the session's channel.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - a client's session bit goes to the lead chat's `flag` first.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - `sessionFlag` says its action under an origin it is given.
- [`code://packages/sdk/src/host/spawn.ts`](../../../../packages/sdk/src/host/spawn.ts) - relayed session bits through `sessionFlag`; no read or unread of a nested session here.
- [`code://packages/sdk/src/host/merged.ts`](../../../../packages/sdk/src/host/merged.ts) - a nested session's merged archive goes inside.
- AHP.md's rows for the session's and the chat's bits, and a nested proxy case.

## Verified

- On `3945964a`'s sources the case fails: a client hears the session's unread at a turn's end twice.
- One is this host's own and one the host inside's, relayed.
- With the change, `nested-proxy` passes 70 of 70.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

None.
