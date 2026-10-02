---
title: The daemon keeps usage by default
status: todo
depends: [task-02-jsonl-store.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/run.ts#L261-L365](../../../../packages/server/src/commands/run.ts#L261-L365) - `HostOptions` assembly"
---

## Objective

`ahpd run` passes `fileUsage` over a `usage/` folder beside the daemon's other files, unless a plugin contributes the `usage` port.

## Files

- `UPDATE: packages/server/src/commands/run.ts:261-365` - `usage: fileUsage(<data folder>/usage)`.

## Steps

1. Use the same data folder the session and automation stores use.

## Validation

- A server test: a daemon starts with a `usage` folder and a plugin's `usage` replaces it.
- `pnpm -F @ahpd/server test`.

## Resume
