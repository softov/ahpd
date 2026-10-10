---
title: A chat says when it can move
status: done
depends: []
layer: "sdk, agent-acp"
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L55-L65](../../../../packages/sdk/src/host/catalogue.ts#L55-L65) - `chatSummary`, where `movable` goes"
  - "[code://packages/sdk/src/host/spawn.ts#L615-L616](../../../../packages/sdk/src/host/spawn.ts#L615-L616) - a turn starting or ending, already the moment `operationsMoved` is said"
  - "[code://packages/sdk/src/host/sessionmethods.ts#L689-L719](../../../../packages/sdk/src/host/sessionmethods.ts#L689-L719) - `disposeChat`, where another chat becomes the default"
  - "[code://packages/sdk/src/types/session.ts#L236-L243](../../../../packages/sdk/src/types/session.ts#L236-L243) - `agentId()`, beside which `resumable()` goes"
  - "[code://packages/sdk/src/nested.ts#L412](../../../../packages/sdk/src/nested.ts#L412) - the nested host answers an `agentId()` it cannot resume, so `agentId()` alone does not say a chat can be picked up again"
  - "[code://packages/agent-acp/src/session.ts#L1088-L1093](../../../../packages/agent-acp/src/session.ts#L1088-L1093) - an ACP server without `loadSession` refuses a resume"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `ChatState.movable` and `ChatSummary.movable`, absent meaning `false`, never `true` on the default chat (`channels-chat/state.ts:72-79`, `:197-203`); `chat/movableChanged`, the host updating the catalogue through `session/chatUpdated` (`channels-chat/actions.ts:579-595`)"
---

## Objective

A peer chat carries `movable: true` in its `ChatState` and `ChatSummary` exactly when it is not the default chat, its backend can resume it by its own id, and neither it nor any worker chat it carries is running a turn; every change goes out as `chat/movableChanged` on the chat and `session/chatUpdated` on its session.

## Files

- `UPDATE: packages/sdk/src/types/session.ts` - `resumable?(): boolean` beside `agentId()`, documented: absent means `agentId()` can be resumed.
- `UPDATE: packages/sdk/src/nested.ts` - `resumable: () => false`.
- `UPDATE: packages/agent-acp/src/session.ts` - `resumable` answers whether the handshake advertised `loadSession`.
- `UPDATE: packages/sdk/src/host/catalogue.ts`, `packages/sdk/src/host/spawn.ts`, `packages/sdk/src/host/sessionmethods.ts` - a `movable(chatUri)` function; `movable` in `chatSummary` and a peer chat's state; a `movableMoved(chatUri)` that dispatches the two actions when the answer changed, called at a turn's start and end (`packages/sdk/src/host/spawn.ts:615`), when a worker of the chat starts or ends a turn, and when the default chat changes in `disposeChat`.
- `UPDATE: packages/sdk/test/host-chats.test.ts`, `packages/agent-acp/test/agent-acp.test.ts` - the cases below, the host's in `more than one chat in a session`.
- `UPDATE: docs/AHP.md` - the `chat/movableChanged` row.

## Steps

1. Add `resumable` and its two implementations.
2. Compute `movable` from the chat's place, `resumable() ?? true` with an `agentId()` present, and the running turns of the chat and its workers; a worker chat is never movable on its own.
3. Keep the last answer per chat and dispatch only on a change, so a 0.9.0 and a 1.0.0 connection see the same actions.

## Validation

- `packages/sdk/test/host-chats.test.ts`, in `more than one chat in a session`: with chats A (default) and B on a fake agent, A has no `movable` and B has `movable: true` in state and summary; a turn on B sends `chat/movableChanged` `false` and `session/chatUpdated` at its start and `true` at its end; a worker of B running a turn keeps B `false`; disposing A makes B the default and B goes `false`; a fake session answering `resumable: false` keeps B `false` with no action sent.
- `packages/agent-acp/test/agent-acp.test.ts`: a fake server without `loadSession` makes `resumable()` answer `false`, and one with it `true`.
- `pnpm test` passes.

## Resume
