---
title: Teams, projects and memberships in the users file
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/users.ts#L84-L162](../../../../packages/sdk/src/types/users.ts#L84-L162) - `UserRecord` and `UserFile`"
  - "[code://packages/sdk/src/users.ts#L215-L266](../../../../packages/sdk/src/users.ts#L215-L266) - reading the file"
---

## Objective

The users file holds `teams` and `projects` (each an id and an optional title) and each person's `memberships` and `primary`, checked on read, and a `Principal` carries the memberships and primary.

## Files

- `UPDATE: packages/sdk/src/types/users.ts:84-162` - `UserFile.teams?`, `UserFile.projects?`, `UserRecord.memberships?: string[]`, `UserRecord.primary?: string`; the same two on `Principal`.
- `UPDATE: packages/sdk/src/users.ts` - parse and check them; write them back unchanged.

## Steps

1. A membership is `team`, `team:*` or `team:project`; one naming an unknown team or project is reported once and ignored.
2. `primary` must be `team` or `team:project`, never `*`, and covered by a membership; otherwise reported and ignored.
3. A file without the new keys reads as today.

## Validation

- `packages/sdk/test/users.test.ts`: the forms parse; unknown names are ignored with a report; a bad primary is ignored; an old file reads.
- `pnpm -F @ahpd/sdk test`.

## Resume
