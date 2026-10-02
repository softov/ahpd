---
title: The daemon keeps usage by default
status: done
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

Implemented. `runForeground`'s `base` carries `usage: fileUsage({ folder: join(configDir(), 'usage') })`, beside `automations` and before `onEvent`, so a plugin that registers `usage` without `replace` is refused and one that passes it takes the daemon's over.

The folder is `configDir()` and not a new path in `config.ts`. Every other daemon file has a named function there, and this one has none because the task named only `run.ts` to change; a `usagePath()` should be lifted into `config.ts` if a second caller ever needs it or the paths are gathered.

`fileUsage` is constructed while `base` is built, before the plugins are folded, so the folder is made even on the run where a plugin replaces the store. That is what the test uses to see the daemon's default, and it is harmless: an empty folder. It is not evidence that the daemon's store is in use, which is why the replacement half of the test is proved by the fold's problem instead.

Validation: `packages/server/test/usage-port.test.ts` runs the daemon as a process with a temporary `XDG_CONFIG_HOME` and a fixture at `test/fixtures/plugin-usage`. It checks that the folder is made at startup beside the automations, that a plugin registering `usage` without `replace` is told the daemon already set it, and that the same plugin with `replace` is not. What the daemon's store itself holds cannot be checked yet, because nothing records to it.
