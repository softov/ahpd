---
title: The commands are declared, with their grants
status: todo
depends: [task-01-pin-every-flag-and-verb.md]
layer: "server"
refs:
  - file:///github/cofold/packages/commands/src/registry.ts - `createRegistry`, `action`, `authorize`
  - "[code://packages/sdk/src/host.ts#L141](../../../../packages/sdk/src/host.ts#L141) - the grant pairs"
---

## Objective

A registry in `packages/server/src/commands/` declares `start` (with the daemon flags as its input), `stop`, `status`, `config`, `user` and `plugin` with their sub-commands, each with `scopes`, and their `run` calls today's functions.

## Files

- `CREATE: packages/server/src/commands/*.ts` - one file per verb.
- `UPDATE: packages/server/package.json` - `@cofold/commands`, `@cofold/terminal`.

## Steps

1. Declare each command's input as JSON Schema from the flag table; keep every flag's spelling.
2. Scopes: `status` and `plugin list` need nothing; `config` and `plugin` writes `config:write`; `user` writes `admin`.
3. `authorize` locally lets the process owner do everything; it is the hook `daemon/05` fills for HTTP.

## Validation

- A registry test: every command validates, and every flag from task 01 is an input of `start`.

## Resume
