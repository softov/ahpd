---
title: The list shows charged pools the reader may read
status: doing
depends: [task-01-a-member-reads-their-teams-pool.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/usage.ts#L542-L543](../../../../packages/sdk/src/usage.ts#L542-L543) - `visible`"
---

## Objective

A listing of `usage://` answers `store.pools()` filtered by `mayRead`, for every reader.

## Files

- `UPDATE: packages/sdk/src/usage.ts:542-543` - `visible` filters `store.pools()` by `mayRead`.
- `UPDATE: packages/sdk/test/usage-scheme.test.ts` - the listing cases.
- `UPDATE: docs/USAGE.md` - a listing names the charged pools the reader may read.

## Steps

1. Change `visible` to filter `store.pools()` by `mayRead`, and keep the sort.
2. Write a test: records in `user:soft`, `team:backend`, `project:backend:ahpapp` and `root:x`.
3. In that test, `soft` lists the first three and root lists all four.
4. Write a test: a pool `soft` may read with no records is not listed.
5. Update the listing paragraph in `docs/USAGE.md`.

## Validation

- The ahpd gates pass.

## Resume

- `packages/sdk/src/usage.ts`: `visible` is `store.pools()` filtered by `refused`, for every reader, in the store's sorted order.
- `packages/sdk/test/usage-scheme.test.ts`: a test with records in `user:soft`, `team:backend`, `project:backend:ahpapp` and `root:x`, where `soft` lists the first three and root lists all four.
- The same test checks that `project:testing:ahpc`, which `soft` may read and which has no records, is not listed.
- The existing case that listed an uncharged `user:ana` now expects only the charged pool.
- `docs/USAGE.md`: the `usage://` row and a paragraph on the listing.
