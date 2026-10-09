---
title: A pool says its kind and name
status: doing
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

- `packages/sdk/src/usage.ts`: `UsageProviderOptions.titles` is a reader with `teams()` and `projects()`, which a `Users` port answers.
- The pool body is `{ pool, kind, name, day, week, month }`.
- `kind` is the pool key's prefix, and `name` is the user's id, the team's title, `<team title> / <project title>`, or the host of a `root:` pool, each title falling back to its id.
- A titles reader that throws is reported through `onProblem`, and the names fall back to ids.
- `packages/server/src/commands/run.ts`: the daemon passes its `users` directory as `titles`.
- `packages/server/src/commands/usage.ts`: the served `ahpd usage` passes `served.users` as `titles`, and `TotalsRow` declares `kind` and `name`.
- `packages/sdk/test/usage-scheme.test.ts`: a test of the names, and `packages/server/test/usage-command.test.ts` expects the two new fields.
- `docs/USAGE.md`: a section on the kind and the name.
