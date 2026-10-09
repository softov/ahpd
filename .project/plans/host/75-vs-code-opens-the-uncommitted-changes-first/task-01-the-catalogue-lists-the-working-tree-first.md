---
title: The catalogue lists the working tree first
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L845-L890](../../../../packages/sdk/src/changes.ts#L845-L890) - `scopes()`, the catalogue order"
---

## Objective

`scopes()` lists `uncommitted` before `session`, so VS Code opens the working tree and shows Commit.

## Files

- `UPDATE: packages/sdk/src/changes.ts:845-890` - put the `uncommitted` entry before `session`, and rewrite the comment to say why.
- `UPDATE: packages/sdk/test/changes-uris.test.ts` - assert the order, and update any case that read `session` as the first entry.

## Steps

1. Move the `session` entry after the `uncommitted` entry in `scopes()`.
2. Rewrite the comment: VS Code opens the first entry, and Commit is on the working tree.
3. Find the tests that depend on the old order with `rg -n "'session'" packages/*/test`, and update them.
4. Add a case: a session with turns lists `uncommitted`, `session`, `turn/{turnId}`, `compare/{originalTurnId}/{modifiedTurnId}` in that order.

## Validation

- The new order case passes, and fails with the old order.
- `pnpm test` passes.

## Resume

- **Status:** implemented, awaiting review.
- **Done:** [`code://packages/sdk/src/changes.ts`](../../../../packages/sdk/src/changes.ts) `scopes()` returns `...scopes` before the `session` entry, so `uncommitted` leads, then `session`, then the two templates. The comment says a client shows the first entry and Commit is on the working tree.
- **Files:** the task named `packages/sdk/test/changes.test.ts`, which the repository does not have. The changes tests are split into `changes-locks`, `changes-refresh` and `changes-uris`. Softov chose `packages/sdk/test/changes-uris.test.ts` on 2026-10-09, this file's Files line now names it, and the case sits beside the session-catalogue case there.
- **Tests:** `packages/sdk/test/changes-uris.test.ts`, "lists the working tree, then the session, then the two templates". A real repository, one `refresh` so the working tree has an entry, and one observed turn; `scopes()` must then answer `uncommitted`, `session`, `turn/{turnId}`, `compare/{originalTurnId}/{modifiedTurnId}`.
- **Failed first:** with the old order it answered `['session', 'uncommitted', 'turn/{turnId}', 'compare/...']`.
- **Step 3:** `rg -n "'session'" packages/*/test` finds no case that read `session` as the first catalogue entry, so no other case moved.
- **Gates:** `pnpm install` and `node tools/schema.mjs` clean; `pnpm build`, `pnpm typecheck` and `pnpm boundary` clean, 8 packages and none undeclared; `npx vitest run --maxWorkers=2 --testTimeout=10000` passed 4606 of 4606 tests in 263 files, exit 0.
- **Watch out for:** the full suite rewrites `packages/sdk/test/fixtures/wire.jsonl`, and the restore is denied in don't-ask mode, so it is left modified for Softov to restore.
