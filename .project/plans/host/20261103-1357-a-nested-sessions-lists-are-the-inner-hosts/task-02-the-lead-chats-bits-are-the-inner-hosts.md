---
title: The lead chat's bits are the inner host's
status: todo
depends: [01]
layer: host
refs:
  - "[code://packages/sdk/src/sessions/nested.ts](../../../../packages/sdk/src/sessions/nested.ts) - `carry`, which takes a client's action to the host inside"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - a chat's read and archived bits, set by a client"
  - "[code://packages/sdk/src/host/spawn.ts](../../../../packages/sdk/src/host/spawn.ts) - a chat's read bit, moved at a turn's start and end"
---

## Objective

A client's read and archive of a nested session's lead chat go to the host inside, which answers the client.
The lead chat's read and archived bits are the ones that host says.
The outer host keeps them as said, and moves none of them itself.

## Files

- `UPDATE: packages/sdk/src/types/session.ts` - `Session.flag`, a client's bit carried to the host that runs the chat.
- `UPDATE: packages/sdk/src/sessions/nested.ts` - `flag`, carried to the host inside.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - a read or an archive of a chat whose backend takes `flag` goes to that backend.
- `UPDATE: packages/sdk/src/host/spawn.ts` - the bits such a backend says, kept as said, and none of this host's own on its chat.
- `UPDATE: packages/sdk/src/host/catalogue.ts` - the comment on the bits of a backend's row.
- `UPDATE: packages/sdk/test/nested-proxy.test.ts` - a read and an archive of the lead chat through a host.
- `UPDATE: docs/sdk/AHP.md` - the rows of `chat/isReadChanged` and `chat/isArchivedChanged`: the lead chat of a nested session.

## Steps

1. Add `Session.flag`, which carries a client's read or archived bit to the host that runs the chat.
2. Implement `flag` in the proxy with `carry`, so the host inside answers the client.
3. Hand a read or an archive of a chat to its backend's `flag` before this host keeps any bit.
4. Keep the bits such a backend says, and move the session's read bit after them.
5. Leave the chat's read bit to that backend at a turn's start and end.
6. Add a case for a read and an archive of the lead chat through a host.

## Validation

- The new case fails on `4b2e706f`'s sources and passes after.
- `nested-proxy.test.ts` passes alone at one worker.
- `pnpm run typecheck` and `pnpm run boundary` are clean.
