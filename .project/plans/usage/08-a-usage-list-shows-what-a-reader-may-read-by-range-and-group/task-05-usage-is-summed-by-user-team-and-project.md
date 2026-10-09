---
title: Usage is summed by user, team and project
status: todo
depends: [task-01-a-member-reads-their-teams-pool.md, task-03-a-pool-says-its-kind-and-name.md, task-04-a-total-is-read-for-any-range.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/types/usage.ts#L128-L165](../../../../packages/sdk/src/types/usage.ts#L128-L165) - the `Usage` port"
  - "[code://packages/sdk/src/usage.ts#L285-L356](../../../../packages/sdk/src/usage.ts#L285-L356) - the file store's `total` and `records`"
---

## Objective

`usage://groups?by=<keys>&from=&until=` answers one row per distinct key tuple, summed over each record the reader may read, once.

## Files

- `UPDATE: packages/sdk/src/types/usage.ts` - the `Usage` port gains `groups(by, from, until, keep)` and a row type.
- `UPDATE: packages/sdk/src/usage.ts` - the file store's `groups`, and the `groups` read on the scheme root.
- `UPDATE: packages/sdk/test/usage-scheme.test.ts` - the group cases.
- `UPDATE: docs/USAGE.md` - the `groups` read.

## Steps

1. Add `groups` to the port. `by` lists keys from `user`, `team` and `project`.
2. Make `keep` a test on a record's pools.
3. Write the file store's `groups`. Read each record of the range once, and sum by the keys.
4. Keep a record when the reader may read at least one of its pools.
5. Give each row its keys, a `name` for each key as task 03 names a pool, and the total.
6. Answer `usage://groups` with the rows, and refuse a `by` with an unknown key.
7. Write a test: a record charged to user, team and project counts once in a group by `user`.
8. Write a test: a group by `team,project` splits a team's spending by project.
9. Write a test: a reader sees no row built from records whose pools they may not read.
10. Describe `groups` in `docs/USAGE.md`.

## Validation

- The ahpd gates pass.

## Resume
