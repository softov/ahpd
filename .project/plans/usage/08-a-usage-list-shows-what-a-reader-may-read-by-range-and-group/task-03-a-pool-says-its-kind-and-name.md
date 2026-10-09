---
title: A pool says its kind and name
status: todo
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/usage.ts#L558-L590](../../../../packages/sdk/src/usage.ts#L558-L590) - `body`"
---

## Objective

`usage://<pool>` answers `kind` and `name` beside the totals, so a client names a pool without `team` or `project` grants.

## Files

- `UPDATE: packages/sdk/src/usage.ts` - the pool body gains `kind` and `name`, read from the people records the provider is given.
- `UPDATE: packages/sdk/test/usage-scheme.test.ts` - the name cases.
- `UPDATE: docs/USAGE.md` - the two fields.

## Steps

1. Give the usage provider a reader for the titles of users, teams and projects.
2. Answer `kind` from the pool key's prefix.
3. Answer `name`: the user's name, the team's title, or `<team title> / <project title>`, each falling back to its id.
4. Write a test: a reader with no `team` grant gets `Backend / ahpapp` for `project:backend:ahpapp`.
5. Write a test: a team with no title gets its id.
6. Describe `kind` and `name` in `docs/USAGE.md`.

## Validation

- The ahpd gates pass.

## Resume
