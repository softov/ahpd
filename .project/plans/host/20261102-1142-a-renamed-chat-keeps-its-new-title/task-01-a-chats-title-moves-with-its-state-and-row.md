---
title: A chat's title moves with its state and its row
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L1316-L1338](../../../../packages/sdk/src/host/tooling.ts#L1316-L1338) - `renameChat`"
  - "[code://packages/sdk/src/host/chatactions.ts#L620-L643](../../../../packages/sdk/src/host/chatactions.ts#L620-L643) - a client's rename"
---

## Objective

A client's rename on a chat's channel is said back there, and the chat's held title and its row take the new title together.
A default chat's rename renames its session after the row.

## Files

- `UPDATE: packages/sdk/src/host/tooling.ts:1316-1338` - `renameChat` sets the chat's held title and says its row, and `renameSession` renames a session from its own channel.
- `UPDATE: packages/sdk/src/host/chatactions.ts:620-643` - a rename on a chat's channel is said back there, then `renameChat`; one on the session's channel goes to `renameSession`.
- `UPDATE: packages/sdk/test/host-chats.test.ts` - a peer chat and a default chat renamed on their channels.
- `UPDATE: docs/sdk/AHP.md:235` - the `session/titleChanged` row.

## Steps

1. Split the session's rename out of `renameChat` as `renameSession`, with the steps it has now.
2. Make `renameChat` set the chat's held title and say its row, then a default chat's session title.
3. Say a client's rename on a chat's channel back on that channel before `renameChat`.
4. Add the cases of a peer chat and a default chat renamed on their channels.
5. Write the answer in the `session/titleChanged` row.

## Validation

- `packages/sdk/test/host-chats.test.ts`: the new cases fail on `6e6d1ca8` and pass after.
- The sdk files that rename a session or a chat pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02 in `ce8c9b6b`.

- `renameChat` replaces the chat's held state with one that carries the title, as `updateChatTitle` replaces its entry's state.
- `renameSession` keeps the steps a rename on the session's channel had: the backend's title, the store and `session/titleChanged`.
- A probe drove the revert on `6e6d1ca8`: a renamed peer chat's row said `Renamed`, and `New session` after its next turn.
- With the change the row says `Renamed` after the turn, and the probe was removed.
