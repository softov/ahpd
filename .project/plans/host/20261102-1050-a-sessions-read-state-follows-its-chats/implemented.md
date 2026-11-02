---
title: A session's read state follows its chats - implemented
date: 2026-11-02
refs:
  - git://4edb4bec - the change
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/host/actions.ts](../../../../packages/sdk/src/host/actions.ts)"
---

A session's read bit and its chats' read bits move each other, as VS Code's host couples them.
A session read while one of its two or more chats is unread is said unread.
A session of one chat moves that chat with it.
A chat marked unread marks a read session unread, and the last chat read marks an unread session read.
A tool's chat and a hidden chat keep their own bits.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - `readAggregate` names the chats a session's bit is made of, each with its bit.
- The same file has `sessionFollows`, which moves the session after a read action on one of those chats.
- The same file runs `sessionFollows` after a client's chat read action, moved or not, and after an archive's mark-read that moved the chat.
- [`code://packages/sdk/src/host/actions.ts`](../../../../packages/sdk/src/host/actions.ts) - a client's session read is said unread while a chat of several is unread, and a sole chat follows the session's new bit.
- The same block takes the session's read and archived bits, as one function moves both.
- [`code://packages/sdk/test/host-catalogue.test.ts`](../../../../packages/sdk/test/host-catalogue.test.ts) - the read cases hold VS Code's rules.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the read rows say how the bits move.

## Verified

- On `6e6d1ca8`'s `chatactions.ts` and `actions.ts`, seven cases of `host-catalogue.test.ts` fail, each with the bit the rule moves left where it was.
- With `4edb4bec` the file passes, 72 of 72.
- Seventeen files that send a read action ran with the change: 1062 tests passed, all the protocol's cases among them.
- The three that failed read the wire schema `tools/schema.mjs` writes, which the run had not made; with it made they pass, 65 of 65.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- Task 01 - `readAggregate` gives no chats to a session the catalogue does not list.
- VS Code's host has no catalog row to read for such a session, and moves no chat with it.
- Task 01 - the two archive cases keep their names' first half and change their session's bit.

## Left for later

- None.
