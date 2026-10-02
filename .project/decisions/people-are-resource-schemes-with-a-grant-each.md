---
title: Users, teams, projects and roles are resource schemes, each with its own grant subject
status: accepted
date: 2026-10-01
refs:
  - "[code://packages/sdk/src/users.ts#L39](../../packages/sdk/src/users.ts#L39) - `SUBJECTS`, where `users` is one subject for all of it today"
  - "[code://packages/sdk/src/host.ts#L5364-L5378](../../packages/sdk/src/host.ts#L5364-L5378) - `advertisedSchemes`, how a client learns a scheme's operations and create form"
  - "[code://packages/server/src/commands/user.ts](../../packages/server/src/commands/user.ts) - the `user` commands, gated by `users:write`"
---

## Context

A client such as ahpapp lists and edits computers from what the host advertises for the `computer:` scheme: its operations and the form a create is drawn from.
People, teams, projects and roles are only reachable through the CLI and `/api`, under one `users:read` and `users:write`.
A root on a fresh host should be able to create the first team, users and roles from the app.

## Decision

The host serves `user:`, `team:`, `project:` and `role:` as resource schemes over its users directory, advertised like `computer:`, so a client lists, creates, edits and removes them the same way.
Each scheme is its own grant subject: `user:read`, `user:write`, `team:read`, `team:write`, `project:read`, `project:write`, `role:read`, `role:write`. They replace `users:read` and `users:write`.
`write` covers create, edit and delete, as it does for computers.

Source: Softov, 2026-10-01: "on ahpapp we will also need to list users and teams, like computers... computer:read, user:read and team:read... with write could configure, add user"; asked "which grant deletes a user, team, project or role?": "Write covers delete"; asked "per scheme, or one subject for everything?": "Per scheme".

## Consequences

A person can be let see teams without seeing users.
The `user` and `team` commands move to the new subjects, and a users file that grants `users:*` needs reading as something.
ahpapp gets a people screen without a protocol of its own.

## Options

- **One `users:` subject for all four:** rejected, it cannot let someone see teams without seeing people.
- **A separate `delete` verb:** rejected, no other subject has one.
