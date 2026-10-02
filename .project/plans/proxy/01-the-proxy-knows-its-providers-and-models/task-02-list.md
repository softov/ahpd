---
title: ahpd proxy list
status: todo
depends: [task-01-config.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/registry.ts#L48-L59](../../../../packages/server/src/commands/registry.ts#L48-L59) - the CLI registry"
  - "[code://packages/server/src/commands/served.ts#L60-L67](../../../../packages/server/src/commands/served.ts#L60-L67) - the `/api` registry"
---

## Objective

`ahpd proxy list` and `/api/proxy/list` show each provider (endpoint, accepts, whether its key is set) and each model name with its providers.

## Files

- `CREATE: packages/server/src/commands/proxy.ts` - the command, `config:read` scope.
- `UPDATE: packages/server/src/commands/registry.ts:48-59`, `packages/server/src/commands/served.ts:60-67` - register it.

## Steps

1. Never print a key's value.

## Validation

- A command test: the listing has the built-ins and a user provider, `key set: false` when the variable is missing.
- `pnpm -F @ahpd/server test`.

## Resume
