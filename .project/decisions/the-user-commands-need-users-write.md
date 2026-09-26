---
title: The user commands need users:write
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/commands/user.ts#L53-L153](../../packages/server/src/commands/user.ts#L53-L153) - `user list`, `add`, `rm` and `token`, declared with `admin`"
  - "[code://packages/sdk/src/users.ts#L22-L35](../../packages/sdk/src/users.ts#L22-L35) - the built-in roles and `SUBJECTS`"
  - "[code://.project/decisions/a-grant-is-a-subject-and-a-verb.md](a-grant-is-a-subject-and-a-verb.md) - a grant is a subject and a verb"
---

## Context

The `user` commands declare the scope `admin`, which is a role name and not a grant pair.
It passes only because `holds` answers true for `*:*`, so no role short of `admin` can ever be given the right to manage people.

## Decision

`users` joins `SUBJECTS`, and `user list`, `user add`, `user rm` and `user token` declare `users:write` in place of `admin`.
`user list` needs `users:write` like the other three, not a `users:read` of its own (Softov confirmed, 2026-09-26).

Source: Softov, 2026-09-26, answering the daemon/04 review's question on the scope the `user` commands declare: "The `user` commands require a real grant pair: add `users:write` (add `users` to SUBJECTS in the sdk grant model), replacing `admin`".

## Consequences

A role can be given the management of people without everything else, and `admin` keeps it through `*:*`.
Every scope a command declares is a grant pair the WebSocket's `refusalReason` can name.

## Options

- **Keep `admin`.** A scope that is not a grant, matched only by the wildcard.
