---
title: The sole chat takes the session's title
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/tooling.ts#L1331-L1364](../../../../packages/sdk/src/host/tooling.ts#L1331-L1364) - `renameChat` and `renameSession`"
  - "[code://packages/sdk/src/host/chatactions.ts#L112-L140](../../../../packages/sdk/src/host/chatactions.ts#L112-L140) - `readAggregate`"
---

## Objective

A rename on a session's own channel moves its default chat's held title and row too, when the session counts one chat or none.
A session with peer chats keeps its default chat's held title and row.

## Files

- `UPDATE: packages/sdk/src/host/tooling.ts:1318-1364` - `updateChatTitle` holds the step both renames share, and `renameSession` retitles a sole chat.
- `UPDATE: packages/sdk/test/host-chats.test.ts` - a session renamed on its own channel, with one chat and with a peer chat.
- `UPDATE: docs/sdk/AHP.md:235` - the `session/titleChanged` row.

## Steps

1. Move the held title and the `session/chatUpdated` of `renameChat` into `updateChatTitle`.
2. Make `renameSession` call `updateChatTitle` for the default chat when `readAggregate` counts one chat or none.
3. Add the cases of a session renamed on its channel, alone and beside a peer chat.
4. Write what a session's rename moves in the `session/titleChanged` row.

## Validation

- `packages/sdk/test/host-chats.test.ts`: the sole chat's case fails on `b91d615e` and passes after; the peer chat's case passes on both.
- The sdk files that rename a session or a chat pass.
- `pnpm run typecheck` is clean.

## Resume

Not started.
