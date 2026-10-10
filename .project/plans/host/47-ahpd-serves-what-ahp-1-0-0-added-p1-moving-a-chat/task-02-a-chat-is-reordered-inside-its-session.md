---
title: A chat is reordered inside its session
status: done
depends: [task-04-a-chat-says-when-it-can-move.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/state.ts#L12-L41](../../../../packages/sdk/src/host/state.ts#L12-L41) - `Held.chats`, the order to change"
  - "[code://packages/sdk/src/host/snapshots.ts#L230-L245](../../../../packages/sdk/src/host/snapshots.ts#L230-L245) - the state's `chats`, the list `session/chatsReordered` must name in full"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L576](../../../../packages/sdk/src/host/sessionmethods.ts#L576) - `createChat`, the handler shape"
  - "[code://packages/sdk/src/host/gate.ts#L79-L80](../../../../packages/sdk/src/host/gate.ts#L79-L80) - `NEEDS`, where `moveChat` gets its grant"
  - "[plans/host/50-a-peer-chat-is-its-own-conversation/task-02-the-store-records-a-sessions-chats.md](../50-a-peer-chat-is-its-own-conversation/task-02-the-store-records-a-sessions-chats.md) - `chats(id)` and `setChats(id, list)`, whose list order is the stored order"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `moveChat` with a `session` destination naming the source's own session repositions only the requested entry; `after` absent places it first; the host MUST reject a missing source, a source not `movable`, an unresolved anchor and a source anchoring itself, leaving everything unchanged (`channels-chat/commands.ts:164-199`)"
---

## Objective

`moveChat` with a `session` destination naming the chat's own session moves a `movable` chat after the anchor, or first, keeps that order across a restart, and says it with `session/chatsReordered`.

## Files

- `UPDATE: packages/sdk/src/host/gate.ts:79-80` - `moveChat: 'session:write'` in `NEEDS` (`chat:move` once host/46 lands).
- `UPDATE: packages/sdk/src/host/sessionmethods.ts` - a `moveChat` handler beside `createChat`; the reorder writes host/50's chat list in the new order.
- `UPDATE: packages/sdk/test/host-chats.test.ts` - the cases below, in `more than one chat in a session`.
- `UPDATE: docs/AHP.md` - the `moveChat` and `session/chatsReordered` rows.

## Steps

1. Validate before changing anything: the source is a chat of a running session and task 04's `movable` answers `true`; the destination session is the source's own (another session is task 03, refused here with `-32602` until then); `after`, when present, is another chat of that session.
2. Rebuild `held.chats` in the new order, `setChats` in that order, and dispatch `session/chatsReordered` with every chat URI the state's `chats` lists, workers included in their place; then `summaryMoved`, and answer `{ session }`.
3. A restored session rebuilds its chats in the stored list's order, which host/50 task 03 already does.

## Validation

- `packages/sdk/test/host-chats.test.ts`, in `more than one chat in a session`: with chats A (default), B and C, moving C after A sends one `session/chatsReordered` naming A, C, B and the workers, and the session snapshot lists them so; moving B with no `after` puts it first; moving A, an unknown chat, a worker, B after itself, or B during a turn on B is refused and nothing is dispatched; the order survives a new host over the same file store.
- `packages/sdk/test/conformance.test.ts` replays the reorder through `sessionReducer` and reaches the same list; `pnpm test` passes.

## Resume
