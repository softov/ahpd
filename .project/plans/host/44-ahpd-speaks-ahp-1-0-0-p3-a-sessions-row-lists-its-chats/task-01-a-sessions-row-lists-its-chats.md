---
title: A session's row lists its chats and its default chat
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/snapshots.ts#L230-L245](../../../../packages/sdk/src/host/snapshots.ts#L230-L245) - the session state's `chats`, which becomes one shared function"
  - "[code://packages/sdk/src/host/catalogue.ts#L173-L191](../../../../packages/sdk/src/host/catalogue.ts#L173-L191) - `summaryOf`"
  - "[code://packages/sdk/src/host/catalogue.ts#L219-L240](../../../../packages/sdk/src/host/catalogue.ts#L219-L240) - `summaryMoved`, which strips identity fields and sends the rest"
  - "[code://packages/sdk/src/host/spawn.ts#L211](../../../../packages/sdk/src/host/spawn.ts#L211) - a worker chat added"
  - "[code://packages/sdk/src/host/lifecycle.ts#L121](../../../../packages/sdk/src/host/lifecycle.ts#L121) - a chat removed"
  - "[code://packages/sdk/src/host/tooling.ts#L305](../../../../packages/sdk/src/host/tooling.ts#L305) - a chat added by a fork"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L676](../../../../packages/sdk/src/host/sessionmethods.ts#L676) - a chat added by `createChat`"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L714-L717](../../../../packages/sdk/src/host/sessionmethods.ts#L714-L717) - a default chat changed and a chat removed by `disposeChat`"
  - "[code://packages/sdk/test/conformance.test.ts](../../../../packages/sdk/test/conformance.test.ts) - replays emitted actions through the protocol's reducers"
---

## Objective

`root/sessionAdded` and every `root/sessionSummaryChanged` for a running session carry `chats`, one `SessionChatSummary` per chat in the session state's order with its `status`, and `defaultChat`; a change to any chat's status, title, list or the default chat is followed by such a notification.

## Files

- `UPDATE: packages/sdk/src/host/snapshots.ts:230-245` - the list moves into `chatCatalogOf(session)`, which the session state calls.
- `UPDATE: packages/sdk/src/host/catalogue.ts:173-191` - `summaryOf` adds `chats` (each entry cut to `resource`, `title`, `origin`, `interactivity`, `status`) and `defaultChat`.
- `UPDATE: packages/sdk/src/host/spawn.ts:211`, `packages/sdk/src/host/lifecycle.ts:121`, `packages/sdk/src/host/tooling.ts:305`, `packages/sdk/src/host/sessionmethods.ts:676` and `:714-717` - `summaryMoved` after each, where it is not already called.
- `UPDATE: packages/sdk/test/host-catalogue.test.ts`, `packages/sdk/test/conformance.test.ts` - the cases below.
- `UPDATE: docs/AHP.md` - `SessionSummary.chats` and `defaultChat` are served.

## Steps

1. Extract the list, unchanged, and have the session state use it; the suite must pass before anything else moves.
2. Add the two fields in `summaryOf`; `summaryMoved` then sends them with the rest.
3. Read each add, remove and default-change site and add `summaryMoved` where missing.

## Validation

- `packages/sdk/test/host-catalogue.test.ts`: a session with two chats is listed with both in `chats` and its `defaultChat`; a turn starting in the second chat sends `session/chatUpdated` with `status` and a `root/sessionSummaryChanged` whose `chats[1].status` is that same value; `createChat` and `disposeChat` each send a `root/sessionSummaryChanged` whose `chats` has the chat added or gone; a worker chat appears with `interactivity: 'read-only'`.
- `packages/sdk/test/conformance.test.ts`: the root reducer applied to the notifications leaves `chats` equal to the session state's chats cut to the same fields.
- `pnpm exec vitest run packages/sdk/test/wire.test.ts` and `pnpm test` pass.

## Resume

- **Implemented** 2026-10-09 on `build/agents/cf58b4f7`.
- `chatCatalogOf(session, held, restored)` in `catalogue.ts` builds a session's chats once.
- `restoredOf` gathers the worker chats read back from a backend.
- The session state's `chats` and the row's `chats` both call it, so the two cannot disagree about which chats a session has.
- `compactChats` cuts each entry to `resource`, `title`, `origin`, `interactivity` and `status`, which is `SessionChatSummary`'s field set. It keeps the order.
- `summaryOf` adds `chats` and `defaultChat`, so `summaryMoved` carries them with the rest.
- `sayMoved` compares a partial against the last one sent and drops a repeat, so no client is told a list it already holds.
- A running session's row carries both fields.
- A row listed from a transcript, with no session running, carries neither: that is the plan's decision, not an omission.
- `summaryMoved` is now called at each site that adds or removes a chat: `spawn.ts`, `tooling.ts` and `sessionmethods.ts`.
- In `spawn.ts` the worker branch no longer compares `status` and `activity` itself.
- A worker is a chat of its session, and `summaryMoved` answers whether its own summary moved.
- **Departure 1.** `packages/sdk/src/types/catalog.ts` is not in the Files list. `SummaryChat`, and the two optional fields on `Summary`, are declared there.
- **Departure 2.** `lifecycle.ts:121` needed no change. `teardown` is reached only from `removeSession`, and `root/sessionRemoved` follows at once.
- `packages/sdk/test/conformance.test.ts` folds the two root notifications by hand, because the protocol ships no reducer for them. It compares the folded `chats` with the session state's.
- `docs/AHP.md`: the `root/sessionAdded` and `root/sessionSummaryChanged` rows say a running session's row carries `chats` and `defaultChat`.
- `pnpm typecheck`, `pnpm boundary` and the full suite pass.
