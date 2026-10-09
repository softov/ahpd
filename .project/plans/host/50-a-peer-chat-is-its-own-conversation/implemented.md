---
title: A peer chat is its own conversation, and survives a restart - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/host/chatrecord.ts](../../../../packages/sdk/src/host/chatrecord.ts)"
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts)"
  - "[code://packages/sdk/src/sessions.ts](../../../../packages/sdk/src/sessions.ts)"
  - "[code://packages/server/src/rootconfig.ts](../../../../packages/server/src/rootconfig.ts)"
---

On Claude, pi and cofold, a peer chat runs under its own backend id.
So two chats of one session write two conversations.
The store records each session's chats, and a restart or a resume starts every recorded chat again with its own conversation.
A client can open a peer chat's URI after the daemon restarts, before anything has listed its session.
Closing a chat hides its conversation by default, and the daemon key `closedChats: delete` deletes it instead.

## What was built

- [`code://packages/sdk/src/types/agent.ts`](../../../../packages/sdk/src/types/agent.ts) - `Start.chatId`, the id a peer chat runs under; Claude, pi and cofold read it.
- [`code://packages/sdk/src/types/sessions.ts`](../../../../packages/sdk/src/types/sessions.ts) - `StoredChat`, and `SessionStore.chats`, `setChats` and `sessions`.
- [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts) - both stores keep the list, and the file store reads it back.
- [`code://packages/sdk/src/host/chatrecord.ts`](../../../../packages/sdk/src/host/chatrecord.ts) - `createChatRecord`: the chat-to-session map built at start from `sessions()`, the claimed backend ids, and the record kept as chats open and close.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - the restart starts every chat again under the id its backend answered with; disposing a session deletes each recorded chat's conversation.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - closing a chat marks it closed or deletes its conversation, by `closedChats`.
- [`code://packages/server/src/rootconfig.ts`](../../../../packages/server/src/rootconfig.ts) - `closedChats` is a daemon key, applied while the daemon runs.

## Verified

- The builder's gates passed after the review fixes.
- In the review worktree on main `7810f6d`: install, schema, build, typecheck and boundary pass, and the suite passes 4629 of 4630 tests.
- The one failure is `computer-attachments.test.ts`, an `ENOTEMPTY` in its cleanup. It fails 1 run in 12 on main as well, so host/50 does not cause it.
- `host-chats.test.ts` covers two conversations in one session, the restart, and a chat found before its session is listed.
- It also covers the moved default, the minted backend id, `closedChats: delete`, and a session inside a machine.

## Departures from the plan

- none.

## Left for later

- Peer chats opened before this change share the session's conversation and have no record, so they are not rebuilt.
