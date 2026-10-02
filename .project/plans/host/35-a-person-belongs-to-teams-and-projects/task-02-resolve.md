---
title: A scope is resolved from what work names, or the primary
status: todo
depends: [task-01-file.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/users.ts#L40-L74](../../../../packages/sdk/src/types/users.ts#L40-L74) - `Principal`"
---

## Objective

`scopeFor(principal, named?)` answers `{ team, project? }` or a refusal that lists what the person can name.

## Files

- `CREATE: packages/sdk/src/scopes.ts` - `scopeFor` and the membership parser.
- `CREATE: packages/sdk/test/scopes.test.ts`.
- `UPDATE: packages/sdk/src/index.ts` - export it.

## Steps

1. Named: it must match a membership (`team:*` matches any project of that team; a bare `team` matches only team work); otherwise refuse. A named `team` under `team:*` alone is refused, since a project is needed.
2. Not named: the primary; else the only concrete membership; else refuse with the list.
3. No users directory or a root connection: no scope, nothing refused.

## Validation

- `scopes.test.ts`: the three cases of the plan's checklist, a bare team, `team:*` with and without a project named, no memberships at all.
- `pnpm -F @ahpd/sdk test`.

## Resume
