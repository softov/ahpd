---
title: A sqlite plugin keeps the host's stores in one database
created: 2026-10-02
---

Every store the daemon keeps is a file today, each behind a port a plugin can replace.
A sqlite plugin would take them over together, so one daemon's state is one database file, written in transactions rather than whole-file rewrites.
It is the first replacement the [vault](../plans/vault/01-secrets-live-in-a-vault/plan.md) and the usage store were written for, and the reference a [postgresql store](a-postgresql-store.md) mirrors.

## What it would register

| Port | Today | Registration |
| --- | --- | --- |
| `sessions` | `fileSessions`, one JSON file rewritten per change | `registerSessions(store, 'replace')` |
| `automations` | `scheduledAutomations`, a JSON file | `registerAutomations(store, 'replace')` |
| `usage` | `fileUsage`, monthly JSONL files, per-day totals rebuilt at start | `registerUsage(store, 'replace')`; totals become a query instead of a rebuild |
| `vault` | not built; a local file vault is the planned fallback | `registerVault(vault, 'replace')`, once the port exists |
| `users` | `fileUsers`, the users file | no `registerUsers` exists; the port is set only by the daemon, so this needs one first |
| machine owners | `computers.json`, private to the computer plugin | not a port; it moves only if the computer plugin is given a store to write to |

A store that has no port yet is a host change before it is a plugin, so the plugin starts with the four that have one, then `users` once it is registrable.

## What it would not cover

- A transcript is the agent's own (Claude's JSONL, cofold's store), read back through `Agent.transcript()`; a database here keeps the host's records, not the conversation.
- Replaying state after a restart, so a client's `reconnect` works across one, needs an action log the host does not have (its replay buffer is in memory). That would be a new port this plugin could serve, and it is the part most worth designing.

## Questions it leaves

- One plugin for every store, or a database per port so a host can move only usage, say.
- `node:sqlite` (Node 22 and later) and `bun:sqlite` need no dependency; Deno needs another path.
- How a host moves its existing files into the database: on first start, by a command, or not at all.
