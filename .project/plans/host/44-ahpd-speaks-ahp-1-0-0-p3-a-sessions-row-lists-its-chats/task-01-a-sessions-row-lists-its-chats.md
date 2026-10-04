---
title: A session's row lists its chats and its default chat
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L6601-L6615](../../../../packages/sdk/src/host.ts#L6601-L6615) - the session state's `chats`, which becomes one shared function"
  - "[code://packages/sdk/src/host.ts#L2418-L2436](../../../../packages/sdk/src/host.ts#L2418-L2436) - `summaryOf`"
  - "[code://packages/sdk/src/host.ts#L2464-L2485](../../../../packages/sdk/src/host.ts#L2464-L2485) - `summaryMoved`, which strips identity fields and sends the rest"
  - "[code://packages/sdk/src/host.ts#L3511](../../../../packages/sdk/src/host.ts#L3511) - a worker chat added"
  - "[code://packages/sdk/src/host.ts#L5017](../../../../packages/sdk/src/host.ts#L5017) - a chat removed"
  - "[code://packages/sdk/src/host.ts#L5975](../../../../packages/sdk/src/host.ts#L5975) - a chat added by a fork"
  - "[code://packages/sdk/src/host.ts#L9043](../../../../packages/sdk/src/host.ts#L9043) - a chat added by `createChat`"
  - "[code://packages/sdk/src/host.ts#L9081-L9084](../../../../packages/sdk/src/host.ts#L9081-L9084) - a default chat changed and a chat removed by `disposeChat`"
  - "[code://packages/sdk/test/conformance.test.ts](../../../../packages/sdk/test/conformance.test.ts) - replays emitted actions through the protocol's reducers"
---

## Objective

`root/sessionAdded` and every `root/sessionSummaryChanged` for a running session carry `chats`, one `SessionChatSummary` per chat in the session state's order with its `status`, and `defaultChat`; a change to any chat's status, title, list or the default chat is followed by such a notification.

## Files

- `UPDATE: packages/sdk/src/host.ts:6601-6615` - the list moves into `chatCatalogOf(session)`, which the session state calls.
- `UPDATE: packages/sdk/src/host.ts:2418-2436` - `summaryOf` adds `chats` (each entry cut to `resource`, `title`, `origin`, `interactivity`, `status`) and `defaultChat`.
- `UPDATE: packages/sdk/src/host.ts` at :3511, :5017, :5975, :9043, :9081-9084 - `summaryMoved` after each, where it is not already called.
- `UPDATE: packages/sdk/test/host.test.ts`, `packages/sdk/test/conformance.test.ts` - the cases below.
- `UPDATE: docs/AHP.md` - `SessionSummary.chats` and `defaultChat` are served.

## Steps

1. Extract the list, unchanged, and have the session state use it; the suite must pass before anything else moves.
2. Add the two fields in `summaryOf`; `summaryMoved` then sends them with the rest.
3. Read each add, remove and default-change site and add `summaryMoved` where missing.

## Validation

- `packages/sdk/test/host.test.ts`: a session with two chats is listed with both in `chats` and its `defaultChat`; a turn starting in the second chat sends `session/chatUpdated` with `status` and a `root/sessionSummaryChanged` whose `chats[1].status` is that same value; `createChat` and `disposeChat` each send a `root/sessionSummaryChanged` whose `chats` has the chat added or gone; a worker chat appears with `interactivity: 'read-only'`.
- `packages/sdk/test/conformance.test.ts`: the root reducer applied to the notifications leaves `chats` equal to the session state's chats cut to the same fields.
- `pnpm exec vitest run packages/sdk/test/wire.test.ts` and `pnpm test` pass.

## Resume
