---
title: The commands are declared, with their grants
status: implemented
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

Done: `packages/server/src/commands/` holds `options.ts` (the flag table and the configuration fold), `run.ts`, `start.ts`, `stop.ts`, `status.ts`, `config.ts`, `user.ts`, `plugin.ts` and `registry.ts`.
`run` is a hidden command for the foreground daemon, because `ahpd` with no word is what people type; `start` keeps the daemon-flag input.
`config`, the plugin writes and the user sub-commands declare `config:write`/`admin`, and `authorize` allows the local process owner.
`test/server-commands.test.ts` (3 cases) checks the registry, all nineteen daemon flags on `start`, and the scopes.
The scopes each command needs are now owned by [daemon/05](../05-an-http-api/plan.md), which changes them and `test/server-commands.test.ts:41-51` with them.
