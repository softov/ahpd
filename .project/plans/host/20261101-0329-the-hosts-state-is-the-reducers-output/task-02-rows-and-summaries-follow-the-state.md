---
title: Rows and summaries follow the held state
status: done
depends: [01]
layer: "sdk host"
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L125-L144](../../../../packages/sdk/src/host/catalogue.ts#L125-L144) - a chat's row from its backend"
  - "[code://packages/sdk/src/host/catalogue.ts#L379-L421](../../../../packages/sdk/src/host/catalogue.ts#L379-L421) - the session's status and activity"
  - "[code://packages/sdk/src/host/catalogue.ts#L596-L637](../../../../packages/sdk/src/host/catalogue.ts#L596-L637) - the summary change"
  - "[code://packages/sdk/src/host/spawn.ts#L1454-L1468](../../../../packages/sdk/src/host/spawn.ts#L1454-L1468) - the row re-sent whole"
  - "[code://packages/sdk/src/host/facts.ts#L296-L305](../../../../packages/sdk/src/host/facts.ts#L296-L305) - `session/metaChanged` from the folder's facts alone"
---

## Objective

A chat's row in its session, the session's activity and the catalogue row are read from the held states.
Each moves by an action that carries what changed.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts` - `chatSummary` and `subagentSummary` from the chat's state; `drivingOf` by the protocol's aggregation; `summaryOf` from the session's state; `sayMoved` carries changed fields; `chatMoved`.
- `UPDATE: packages/sdk/src/host.ts` - `chatMoved` after each chat action; `session/metaChanged` and the seed's customizations composed in one place.
- `UPDATE: packages/sdk/src/host/spawn.ts` - the backend's own row bookkeeping and its `session/activityChanged` go; the sender rides on the message.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - a chat's bit moves its row through the chat's state.

## Steps

1. Read a chat's row fields from its held state, a worker's included.
2. Send `session/chatUpdated` with the fields that changed, after each chat action.
3. Send `session/activityChanged` when the deciding chat's activity moves.
4. Decide the catalogue's status, activity and time by the protocol's aggregation over every chat.
5. Carry only the changed fields in `root/sessionSummaryChanged`, measured against what each client holds.
6. Compose the whole `_meta` on every `session/metaChanged`.
7. Lay the client plugins on the seed's customizations instead of on each subscribe.
8. Put `ahpd.sender` on the message of a `chat/turnStarted`, where the chat's state keeps it.

## Validation

- `pnpm exec vitest run packages/sdk/test/host-snapshots.test.ts packages/sdk/test/host-harness.test.ts` passes.
- The oracle passes with the entries of task 05 removed.

## Resume

Done; [implemented.md](implemented.md) says what was built.
