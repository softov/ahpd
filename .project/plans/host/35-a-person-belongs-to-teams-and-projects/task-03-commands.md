---
title: Commands for teams, projects and memberships
status: todo
depends: [task-01-file.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/user.ts#L93-L170](../../../../packages/server/src/commands/user.ts#L93-L170) - the `user` commands to mirror"
---

## Objective

`ahpd team add|rm|list`, `ahpd project add|rm|list`, `ahpd user member <id> <entries...>` and `ahpd user primary <id> <entry>`, each also under `/api`.

## Files

- `CREATE: packages/server/src/commands/teams.ts` - team and project commands, `users:write` to change, `users:read` to list.
- `UPDATE: packages/server/src/commands/user.ts` - `member` replaces a person's memberships; `primary` sets it, allowed for oneself without `users:write`; `list` shows both.
- `UPDATE: packages/server/src/commands/registry.ts`, `packages/server/src/commands/served.ts` - register.

## Steps

1. Removing a team or project in use is refused, naming who uses it.

## Validation

- `packages/server/test/server-commands.test.ts`: each command over the CLI and `/api`; a person sets their own primary; another's needs `users:write`.
- `pnpm -F @ahpd/server test`.

## Resume
