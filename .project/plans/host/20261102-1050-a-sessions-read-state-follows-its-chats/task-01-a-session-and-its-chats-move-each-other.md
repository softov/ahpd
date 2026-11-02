---
title: A session and its chats move each other
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L12-L111](../../../../packages/sdk/src/host/chatactions.ts#L12-L111) - `sessionFlag` and `chatFlag`"
  - "[code://packages/sdk/src/host/chatactions.ts#L191-L254](../../../../packages/sdk/src/host/chatactions.ts#L191-L254) - a client's chat bit and an archive's mark-read"
  - "[code://packages/sdk/src/host/actions.ts#L809-L824](../../../../packages/sdk/src/host/actions.ts#L809-L824) - a client's session bit"
---

## Objective

A client's session read action and chat read action each move the other's bits by VS Code's host's rules.
A tool's chat and a hidden chat move nothing of the session's.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:12-111` - `readAggregate` names the chats a session's bit is made of, and `sessionFollows` moves the session after one of them.
- `UPDATE: packages/sdk/src/host/chatactions.ts:191-254` - a client's chat bit and an archive's mark-read run `sessionFollows`.
- `UPDATE: packages/sdk/src/host/actions.ts:809-824` - a client's session read is said unread while a chat of several is unread, and moves a sole chat.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts:501-783` - the cases of each bit apart become the cases of VS Code's rules.

## Steps

1. Write `readAggregate` from the chats a running session holds, or the chats its state opens with.
2. Write `sessionFollows` from VS Code's chat rule.
3. Run `sessionFollows` after a client's chat read action, moved or not.
4. Run `sessionFollows` after an archive's mark-read that moved the chat.
5. Say a client's session read as unread while a chat of several is unread.
6. Move a sole chat to the session's new bit after the session's action.
7. Change the tests to VS Code's rules, and add a case for each rule.

## Validation

- `packages/sdk/test/host-catalogue.test.ts`: each new or changed read case fails on `6e6d1ca8` and passes after.
- `packages/sdk/test/ahp-test-cases.test.ts` passes, every protocol case among them.
- The sdk files that send a read action pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02 in `4edb4bec`.

- `readAggregate` reads a running session's held chats through their rows, and a session nothing is running through its recorded chats, its default first.
- A session the catalogue does not list has no chats there, so its read action moves no chat.
- Seven cases of `host-catalogue.test.ts` change with the rules, and two new guard cases hold the redundant read and a session of two chats marked unread.
- In the changed cases, a chat unread marks its session unread, and the last chat read marks it read.
- A sole chat follows its session both ways.
- A session read is said unread while one of two chats is, and an archive's mark-read moves the session.
- `subagent-chat.test.ts` holds a worker's chat apart from its session already, and passes unchanged.
