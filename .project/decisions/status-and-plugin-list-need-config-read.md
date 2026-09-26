---
title: "`status` and `plugin list` need config:read"
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/server/src/commands/status.ts#L16-L22](../../packages/server/src/commands/status.ts#L16-L22) - `daemon.status`, declared with no scopes"
  - "[code://packages/server/src/commands/plugin.ts#L20-L26](../../packages/server/src/commands/plugin.ts#L20-L26) - `plugin.list`, declared with no scopes"
  - "[code://packages/sdk/src/users.ts#L35](../../packages/sdk/src/users.ts#L35) - `SUBJECTS`, where `config` already is"
  - "[code://.project/decisions/a-grant-is-a-subject-and-a-verb.md](a-grant-is-a-subject-and-a-verb.md) - what a grant is"
---

## Context

`status` and `plugin list` declare no scopes, so over HTTP any signed-in person may call them, a `guest` included.
They describe the daemon: its pid, the directories it serves, and every plugin it would load with the path it resolves to.

## Decision

`status` and `plugin list` declare `config:read`.

Source: Softov, 2026-09-26, asked "Which grant should `status` and `plugin list` need: none, a read grant such as `config:read`, or `admin`?": "`status` and `plugin list` need `config:read`".

## Consequences

A `guest` or a `member` is refused both with the WebSocket's sentence, and a role that should see them names `config:read`.
`config:write` does not imply `config:read`; a role that holds only the write is given both or `config:*`.

## Options

- **No grant.** Any signed-in person reads the daemon's layout and plugin paths.
- **`admin`.** Not a grant pair, and it would put reading the daemon's state behind the same wall as managing people.
