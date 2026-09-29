---
title: An action reaches an aliased subscriber in its own spelling
status: todo
depends: [task-01-a-created-session-is-held-under-its-providers-name.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L1623-L1633](../../../../packages/sdk/src/host.ts#L1623-L1633) - `broadcast`, which swaps only `channel` for an alias"
  - "[code://packages/sdk/src/host.ts#L1484-L1613](../../../../packages/sdk/src/host.ts#L1484-L1613) - `spelledFor`, the rules for which URIs are respelled"
  - "[code://packages/sdk/src/host.ts#L1908-L1930](../../../../packages/sdk/src/host.ts#L1908-L1930) - `dispatch`, which builds the envelope under the held channel"
  - "[code://packages/sdk/src/host.ts#L1810-L1816](../../../../packages/sdk/src/host.ts#L1810-L1816) - `withWorkerUri`, which stamps `_meta.subagentChatUri` in the held spelling"
  - "[code://packages/sdk/test/subagent-chat.test.ts#L534](../../../../packages/sdk/test/subagent-chat.test.ts#L534) - `takes an approval given on a worker chat spelt from a session alias`"
---

## Objective

A connection subscribed to a session or chat under an alias receives each action with the session's URIs inside it in that alias's spelling, the same as its snapshot, so a subagent chat, a pending input or a new chat it is told about has a URI it can match.

## Files

- `UPDATE: packages/sdk/src/host.ts:1484-1613` - split the per-URI respelling in `spelledFor` into a function that takes one value and the pair (held, asked), so a snapshot and an action use the same rules.
- `UPDATE: packages/sdk/src/host.ts:1623-1633` - for an aliased connection on a session or chat channel, respell the action with that function, not only `channel`.
- `UPDATE: packages/sdk/test/host.test.ts` or `packages/sdk/test/subagent-chat.test.ts` - the cases below.

## Steps

1. Extract the respelling rules from `spelledFor`: the session URI itself, `ahp-chat://default/<b64>`, `ahp-chat://subagent/<b64>/<call>`, `<session>/changeset/<scope>`, `<session>/annotations`, and only for chats of this session (the "mine" check at 1530-1534).
2. Apply them in `broadcast` to the action of an envelope sent under an alias; leave the canonical copy untouched and do not mutate the shared envelope.
3. Keep `replayable` under the held channel; the replay in `subscribe` (6339-6345) respells with the same function.

## Validation

- A client subscribed as `ahp-session:/<uuid>` receives `session/chatAdded` with `summary.resource` and `summary.origin.chat` in that spelling when a subagent starts.
- The same client receives `session/inputNeededSet` with `request.chat` in that spelling, and `chat/toolCallStart` or `chat/toolCallReady` with `_meta.subagentChatUri` in that spelling.
- A client subscribed under the held name receives the same actions unchanged.
- `conformance.test.ts` still replays every emitted action through the protocol reducers.
- `pnpm -C packages/sdk test` passes.

## Resume

