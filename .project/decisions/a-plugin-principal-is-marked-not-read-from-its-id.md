---
title: A plugin's principal is marked, and its id is not read for the owner
status: accepted
date: 2026-10-10
refs:
  - "[code://packages/sdk/src/types/users.ts#L65-L72](../../packages/sdk/src/types/users.ts#L65-L72) - the `plugin` field on `Principal`"
  - "[code://packages/sdk/src/values.ts#L43-L53](../../packages/sdk/src/values.ts#L43-L53) - `ownerOfPrincipal`, which reads the field"
  - "[code://packages/server/src/commands/user.ts#L84-L88](../../packages/server/src/commands/user.ts#L84-L88) - `user add` accepts any id that does not start with a dash"
---

## Context

A plugin's own connection is served as the principal `plugin:<name>`, and its work is owned as `plugin:<name>`.
A user id has no rule on its form, so an operator can add a person with the id `plugin:bot`.
If the owner is read from the id prefix, that person owns work as the bot plugin.

## Decision

The principal a plugin's connection is served as carries a `plugin` field with the plugin's name.
Sign-in never sets the field.
`ownerOfPrincipal` answers `plugin:<name>` only when the field is set, and `user:<id>` for every other principal.
A person with the id `plugin:bot` owns work as `user:plugin:bot`.

Softov answered on 2026-10-10.
The question was "Which fix should plugin/20 take?", and the answer was "Mark the principal".

## Consequences

User ids that exist today keep working, whatever they contain.
An embedder that builds a principal by hand owns its work as a person unless it sets `plugin`.

## Options

- **Refuse a colon in a user id, and keep the prefix check.** Rejected: a users file with such an id would stop loading that person.
  The owner would also still depend on a string that any writer controls.
