---
title: An unknown target is answered as the reference host answers it
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/actions.ts#L742-L824](../../../../packages/sdk/src/host/actions.ts#L742-L824) - an active client, and a session's two flags"
  - "[code://packages/sdk/src/host/chatactions.ts#L460-L505](../../../../packages/sdk/src/host/chatactions.ts#L460-L505) - the refusal of an action naming nothing held"
---

## Objective

A read or an archive of an unknown chat is refused.
Any other action on an unknown chat is said back on the chat's channel, and runs nothing.
A session's read or archive toggle for an unknown session is dropped, and any other session action on one is refused.

## Files

- `UPDATE: packages/sdk/src/host/actions.ts:37-54` - `knownSession`, beside the context it reads.
- `UPDATE: packages/sdk/src/host/actions.ts:740-742` - an action on an unknown chat, before any handler reads the channel for a session.
- `UPDATE: packages/sdk/src/host/actions.ts:809-824` - a session's toggle for an unknown session is dropped.
- `UPDATE: packages/sdk/test/host-chats.test.ts` - the four cases, each against an unknown chat or session.
- `UPDATE: docs/sdk/AHP.md` - how an action naming nothing here is answered.

## Steps

1. Add `knownSession`: running, listed, or recorded in the store as a session this host started.
2. Read the catalogue for a target no check knows, then apply the action again when the read found it.
3. Refuse a read or an archive of an unknown chat in the reference host's words.
4. Say any other action on an unknown chat back on its channel with the client's origin.
5. Drop a session's toggle for an unknown session, saying nothing and keeping nothing.
6. Add the cases, with a control for a session action on an unknown session.
7. Describe in `AHP.md` how this host answers an action naming nothing here.

## Validation

- `packages/sdk/test/host-chats.test.ts`: the dropped toggle and the said chat action fail on `60fa2ccd` and pass after.
- The refused chat flags fail on `60fa2ccd` for their words, and the refused session action passes on both.
- The sdk test files pass.
- This task's *Resume* names each test file whose assertion moves with the behavior.
- `pnpm run typecheck` is clean.

## Resume

Not started.
