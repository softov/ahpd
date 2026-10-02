---
title: Each scheme is its own grant subject
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/users.ts#L39](../../../../packages/sdk/src/users.ts#L39) - `SUBJECTS`"
  - "[code://packages/server/src/commands/user.ts](../../../../packages/server/src/commands/user.ts) - `users:write` on every verb"
---

## Objective

`user`, `team`, `project` and `role` are subjects a grant names, in place of `users`, and the commands are gated by the one their verb touches.

## Files

- `UPDATE: packages/sdk/src/users.ts` - `SUBJECTS` loses `users` and gains the four.
- `UPDATE: packages/server/src/commands/user.ts` - `user:read` / `user:write`, and `role:read` where a verb lists roles.
- `UPDATE: packages/server/src/commands/teams.ts` - `team:*` and `project:*`.

## Steps

1. Replace the subject.
2. Read an existing `users:read` / `users:write` as `user:read` / `user:write` only, and log once at start for each role read that way (decision `a-legacy-users-grant-is-the-user-subject-only`). Rewrite the built-in roles with the four subjects.
3. Move each command's `scopes`.

## Validation

- `packages/sdk/test/users.test.ts`: a role with `team:read` reads teams and not users.
- `packages/server/test/server-commands.test.ts`: each verb refused without its subject and allowed with it.

## Resume
