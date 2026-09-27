---
title: A user command gives, mints for and removes only what its caller holds
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/commands/user.ts#L97-L161](../../packages/server/src/commands/user.ts#L97-L161) - `user add`, `user rm` and `user token`, which check only `users:write`"
  - "[code://packages/sdk/src/users.ts#L22-L31](../../packages/sdk/src/users.ts#L22-L31) - `BUILT_IN`, the roles every install has"
  - "[code://packages/sdk/src/users.ts#L49-L55](../../packages/sdk/src/users.ts#L49-L55) - `holds`, the matching rule"
  - "[code://packages/server/src/commands/authorize.ts#L29-L37](../../packages/server/src/commands/authorize.ts#L29-L37) - `ROOT`, the deployment token's caller"
---

## Context

The `user` commands need `users:write`, and nothing else bounds what they do.
A caller holding only `users:write` can `user add eve --role admin` and then `user token eve`, and eve's token then holds `*:*`.
The same caller can re-mint an admin's token, which replaces the admin's hash and locks them out.
So `users:write` is `admin` in practice, and [The user commands need users:write](the-user-commands-need-users-write.md) says a role can manage people "without everything else".

## Decision

`user add` refuses a role unless the caller holds every grant that role resolves to.
`user token` refuses unless the caller holds every grant the person's roles resolve to.
`user rm` refuses on the same terms as `user token` (defaulted: removing a person above the caller is the same lockout as replacing their token; Softov may erase this line).
The refusal is a 403 with the grant the caller lacks, the sentence `refusalReason` gives.
The deployment token and the terminal's process owner hold every grant, so neither is bounded.

Source: Softov, 2026-09-26, asked "How should the users:write escalation be closed?": "Grant only held roles".

## Consequences

`users:write` delegates the management of people at or below the caller, and `admin` keeps everything through `*:*`.
A role that holds `file:read` and `file:write` cannot give a role that names `file:*`, because `holds` matches a wildcard in the held set, not in the one asked for.
A role name that resolves to nothing gives no grant, so it passes the bound, and the directory's own refusal still answers for it.

## Options

- **`users:write` is root.** Say so in this decision and the docs, and change no code. Delegation would mean handing over everything.
- **The user commands need `admin`.** Simplest, and no role short of `admin` could manage people.
