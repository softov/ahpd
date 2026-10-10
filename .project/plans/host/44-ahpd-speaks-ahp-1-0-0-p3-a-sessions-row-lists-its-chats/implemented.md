---
title: A session's row lists its chats with their status, and a chat is read or archived on its own - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/host/catalogue.ts](../../../../packages/sdk/src/host/catalogue.ts)"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/sessions.ts](../../../../packages/sdk/src/sessions.ts)"
---

A running session's catalogue row now lists its chats and names its default chat, so a client draws a session's chats without subscribing to it.
A client marks one chat read or archived, and the bits show in the chat's state, in `session/chatUpdated` and in the row.
Archiving a session's default chat archives the session.

## What was built

- [`code://packages/sdk/src/host/catalogue.ts`](../../../../packages/sdk/src/host/catalogue.ts) - `chatCatalogOf` builds a session's chat list for both the session state and the row. `compactChats` cuts it to `SessionChatSummary`, and `summaryOf` adds `chats` and `defaultChat`.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - `sessionFlag` is the session's flag path. `chat/isReadChanged` and `chat/isArchivedChanged` set a chat's own bits, or the session's archive on its default chat.
- [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts) - `chatFlags` and `setChatFlags` in the memory and file stores, so the bits survive a restart.
- [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts) - every chat status it builds carries that chat's bits.
- `spawn.ts`, `tooling.ts` and `sessionmethods.ts` call `summaryMoved` where a chat is added or removed.
- `docs/AHP.md` and `README.md` - the two row notifications and the two chat actions, and the state-action total `99 of 100`.

## Verified

- `host-catalogue.test.ts`, `host-snapshots.test.ts`, `sessions.test.ts` and `conformance.test.ts` cover the row's chats, the bits, the store and the folded notifications.
- `ahp-test-cases.test.ts` now replays the four protocol cases for the two chat actions.
- The gates passed in a review worktree on main `cf737eb`: 267 test files, 4773 tests.

## Departures from the plan

- `types/catalog.ts`, `validate.ts`, `plugin-validate.test.ts`, `ahp-test-cases.test.ts` and `README.md` changed too, and the Files lists did not name them. Each task's Resume says why.
- `lifecycle.ts` needed no change, because `root/sessionRemoved` follows its teardown at once.

## Left for later

- A row read from a transcript, with no session running, carries no `chats` or `defaultChat`, as the plan decided.
