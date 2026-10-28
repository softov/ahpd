---
title: A listed session is named from its row
status: todo
depends: [task-01-the-store-keeps-a-sessions-uri.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L985-L1003](../../../../packages/sdk/src/host/catalogue.ts#L985-L1003) - `adopt`, which names a listed row `${provider}:/${row.id}`"
  - "[code://packages/sdk/src/host/catalogue.ts#L841-L862](../../../../packages/sdk/src/host/catalogue.ts#L841-L862) - one listed row per id, its agent picked from the stored provider"
  - "[code://packages/sdk/src/host/catalogue.ts#L872-L879](../../../../packages/sdk/src/host/catalogue.ts#L872-L879) - nested sessions, also named through `adopt`"
  - "[code://packages/sdk/test/host-catalogue-held.test.ts](../../../../packages/sdk/test/host-catalogue-held.test.ts) - the listing tests"
---

## Objective

A listed session is named by its row's `uri` when the row has one.
A row with no `uri` keeps the name it has today and stores it.
A listed session with no row is `ahp-session:/<id>`, and nothing is stored for it.

## Files

- `UPDATE: packages/sdk/src/host/catalogue.ts:999-1003` - `adopt` takes the name from the row, as the steps say, before it sets `names`, `owners`, `wheres`, `births` and `moves`.
- `UPDATE: packages/sdk/src/host/catalogue.ts:985-998` - the comment on `adopt` says how a listed session is named.
- `UPDATE: packages/sdk/test/host-catalogue-held.test.ts` - the three cases of a listed name.

## Steps

1. In `adopt`, use `kept.uri?.(row.id)` as the name if the row has one.
2. Otherwise, when the store has a row for `row.id`, take `${waiting ?? agent.provider}:/${row.id}` as today.
3. Store that name with `kept.setUri?.(row.id, name)`.
4. When the store has no row for `row.id`, take `uriFor(row.id)`, and store nothing.
5. Read whether the store has a row once per listing, with `kept.sessions()`, not once per row.

## Validation

- Test that a listing after a restart gives `ahp-session:/<id>` for a row with that `uri`.
- Test that a listing gives `<provider>:/<id>` for a row with a provider and no `uri`.
- Test that this row then holds `<provider>:/<id>` as its `uri`.
- Test that a listing names a row with no provider and no `uri` after the agent that lists it.
- Test that a listing gives `ahp-session:/<id>` for a session on disk with no row.
- Test that the listing writes no row for that session.
- Test that `claude:/<id>` still opens a session listed as `ahp-session:/<id>`.
- `pnpm boundary`, `pnpm typecheck` and `pnpm test` pass.

## Resume
