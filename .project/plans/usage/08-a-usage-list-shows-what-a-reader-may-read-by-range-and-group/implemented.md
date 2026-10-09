---
title: A usage list shows the charged pools a reader may read, names them, and sums any range by user, team and project - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/scopes.ts](../../../../packages/sdk/src/scopes.ts)"
  - "[code://packages/sdk/src/usage.ts](../../../../packages/sdk/src/usage.ts)"
  - "[code://packages/sdk/src/types/usage.ts](../../../../packages/sdk/src/types/usage.ts)"
  - "[code://packages/server/src/commands/run.ts](../../../../packages/server/src/commands/run.ts)"
---

A reader without `usage:read` now sees the pools that were charged and that they may read, the same rule root sees all charged pools by. Each pool says its kind and a name from the team and project titles. A total is read for any range, and `usage://groups` sums the readable records by user, team and project.

## What was built

- [`code://packages/sdk/src/scopes.ts`](../../../../packages/sdk/src/scopes.ts) - `mayRead` answers for one pool key: the reader's own `user:` pool, `team:<team>` for any membership in that team, and `project:<team>:<project>` for `team:*` or that project.
- [`code://packages/sdk/src/usage.ts`](../../../../packages/sdk/src/usage.ts) - the list is the charged pools filtered by `mayRead`. A pool body carries `kind` and `name`. The `range` leaf takes `from` and `until`. `usage://groups?by=&from=&until=` returns `[{keys, names, total}]`, and the store's `groups` keeps a record when any of its pools is readable.
- [`code://packages/sdk/src/types/usage.ts`](../../../../packages/sdk/src/types/usage.ts) - `UsageKey`, `UsageGroup`, and `groups` on the port.
- [`code://packages/server/src/commands/run.ts`](../../../../packages/server/src/commands/run.ts) - wires the team and project titles into the provider.
- `docs/USAGE.md` and `docs/HOST.md` describe the list rule, the `range` leaf and `usage://groups`.

## Verified

- The whole suite: 257 files and 4473 tests, rerun at review. `pnpm build`, `pnpm typecheck`, `pnpm boundary` and `node tools/schema.mjs` pass.
- The review read `authorize` and the read path: anyone may ask for `usage://groups`, and the body counts only records charged to a pool the reader may read.

## Departures from the plan

- A `from` or `until` that is not a date is refused with -32602 on `records` too, where before it was read as no bound.
- Group keys come from the record's fields: `owner`, `team:<team>` and `project:<team>:<project>`.
- A grouped read with no `by` answers one row with the total.
- Only the root segment `groups` is reserved, so a pool cannot be named `groups`.
- The served `ahpd usage` command is also given the titles.
- `stat` on `usage://groups` measures the unfiltered body, so its size says how much data the host holds, not the reader's numbers.
