---
title: The session's bits go inside
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts) - a client's session read and archive"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - the relayed bits and a turn's end"
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts) - the proxy's `flag`"
---

## Objective

A client's session read and archive on a nested session go to the host inside.
The session bits the host inside says are kept here, under the client's origin where they answer one.
This host moves none of a nested session's bits at a turn's end, a chat's read or a merged pull request.

## Files

- `UPDATE: packages/sdk/src/types/session.ts` - `flag` names the chat's or the session's bit.
- `UPDATE: packages/sdk/src/sessions/nested.ts` - the proxy carries a session bit on the session's channel.
- `UPDATE: packages/sdk/src/host/actions.ts` - a client's session bit goes to the lead chat's `flag` first.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - `sessionFlag` takes an origin; the chat's call names `chat`.
- `UPDATE: packages/sdk/src/host/spawn.ts` - relayed session bits through `sessionFlag`; no read or unread of a nested session here.
- `UPDATE: packages/sdk/src/host/merged.ts` - a nested session's merged archive goes inside.
- `UPDATE: docs/sdk/AHP.md` - the session's and the chat's bit rows.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - a case.

## Steps

1. Give `Session.flag` the bit's owner, the chat or the session.
2. Carry a session bit on the session's channel from the proxy.
3. Hand a client's session bit to the lead chat's `flag` before this host keeps it.
4. Keep a relayed session bit through `sessionFlag`, under the client's origin where it answers one.
5. Leave a nested session's read alone at a turn's end and after a chat's read.
6. Send a merged archive of a nested session inside.
7. Add a case for a turn's end, a client's read and a client's archive.

## Validation

- The new case fails on `3945964a`'s sources and passes after.
- `nested-proxy.test.ts` passes.
- `pnpm run typecheck` and `pnpm run boundary` are clean.
