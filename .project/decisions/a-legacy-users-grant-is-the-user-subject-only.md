---
title: An existing users grant reads as the user subject only, not teams, projects or roles
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/users.ts#L23-L39](../../packages/sdk/src/users.ts#L23-L39) - the built-in roles and `SUBJECTS`"
---

## Context

Decision `people-are-resource-schemes-with-a-grant-each` splits the one `users` subject into `user`, `team`, `project` and `role`.
Roles written before name `users:read` and `users:write`, which today cover people, teams, projects and roles together.

## Decision

An existing `users:read` or `users:write` grant is read as `user:read` or `user:write` only.
Teams, projects and roles need their own grants added to a role.
Source: Softov, 2026-10-02, asked "once people are four schemes, what does an existing `users:*` grant mean?": "Users only".

## Consequences

A role that edited teams through `users:write` loses that after the upgrade until `team:write` is added, so the daemon says so once at start for each role it reads that way.
The built-in roles are rewritten with the four subjects, so only hand-written roles are affected.

## Options

- **All four subjects**: rejected; an old grant would silently widen to subjects it never named.
- **Refused at load**: rejected; a daemon would not start over a role that still means something.
