---
title: The memory session store keeps one row per session
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/sessions.ts#L30-L99](../../../../packages/sdk/src/sessions.ts#L30-L99) - `memorySessions`, nine maps"
  - "[code://packages/sdk/src/sessions.ts#L124-L137](../../../../packages/sdk/src/sessions.ts#L124-L137) - `Saved`, the row's fields"
  - "[code://packages/sdk/src/types/sessions.ts](../../../../packages/sdk/src/types/sessions.ts) - `SessionStore`, unchanged"
  - "[code://packages/sdk/test/sessions.test.ts](../../../../packages/sdk/test/sessions.test.ts) - the store's cases"
---

## Objective

`memorySessions` holds `rows: Map<string, Row>`, where `Row` is `Saved` without `version` and `id` and with `senders` and `chatTitles` as maps; every method answers exactly what it answers today.

## Files

- `UPDATE: packages/sdk/src/sessions.ts:30-99` - one map; each getter reads a field; each setter patches the row through one `patch(id, change)` that deletes the row once every field is empty; `forget` is `rows.delete(id)`; `prune` walks `rows.keys()`.
- `UPDATE: packages/sdk/src/sessions.ts:124-137` - `Row` declared beside `Saved`, and `Saved` as `Row`'s on-disk form with `version` and `id`.
- `UPDATE: packages/sdk/test/sessions.test.ts` - the helper's cases below.

## Steps

1. A field's empty value is what its setter treats as unset today: flags `0`, scope `undefined`, owner `undefined`, provider `undefined`, artifacts `[]`, a sender or a chat title removed, so a row with nothing left is gone and `prune` sees only ids with something set.
2. `config` and `pullRequests` are set as given and never cleared by value, as today.
3. `chatTitlesOf` and `sendersOf` answer `Object.fromEntries` of the row's map, or `undefined` when there is none.

## Validation

- A pure refactor: every existing `sessions.test.ts` case stays green unchanged.
- New cases for the row: set flags then set them to `0` leaves no row (`prune` with an always-true predicate calls nothing back); a sender set then removed leaves no row; `forget` after six fields set answers every getter as unset.
- `pnpm exec tsc --noEmit`, `pnpm test packages/sdk/test/sessions.test.ts`.

## Resume

Implemented 2026-10-09 in the `build/agents/61968c74` worktree, test-first.

- `memorySessions` holds `rows = new Map<string, Row>()`; every getter is `rows.get(id)?.field`, every setter patches through one `patch(id, change)` that spreads the row it had and deletes it once `empty(row)` holds, `forget` is `rows.delete(id)`, `prune` walks `[...rows.keys()]`, and `nestedSessions` walks the rows that have a nested record, which is the same set the nine maps answered for.
- `Row` is declared beside `Saved`, each optional field as `field?: T | undefined` so `Partial<Row>` takes an explicit `undefined`; `Saved` keeps the shape the file has always had and is now written down as `Row` as the file holds it. `Held` gains `rowOf(id)`, which answers the row in the canonical field order or nothing, and still has the eleven setters the port names - `setFlags`, `setConfig`, `setScope`, `setOwner`, `setSender`, `setProvider`, `setArtifacts`, `setPullRequests`, `setChatTitle`, `setParent` and `setNested` - each now one `patch`. The doc comment on `Held` is untouched.
- Steps 1 to 3 as written: a field left at its setter's empty value drops out of the row (flags `0`, scope, owner, provider and a removed sender or chat title as `undefined`, artifacts as `[]`), so `prune` sees only ids with something set; `config` and `pullRequests` are set as given and never cleared by value; `sendersOf` and `chatTitlesOf` answer `Object.fromEntries` of the row's map, or `undefined` when the row has none.
- `packages/sdk/test/sessions.test.ts` gains two cases: `keeps no row for a session whose every field was set back to nothing` (flags set and then `0`, a sender set and then removed, `prune` with an always-true predicate calls back for nothing) and `forgets a session entirely, whatever was set on it` (six fields set, `forget`, every getter answers as unset). Every existing case is unchanged.
