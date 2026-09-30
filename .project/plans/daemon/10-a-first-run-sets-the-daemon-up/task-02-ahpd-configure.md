---
title: "`ahpd configure`"
status: todo
depends: [task-01-a-question-with-its-default.md]
layer: "server"
refs:
  - "[code://packages/server/src/install.ts#L137-L352](../../../../packages/server/src/install.ts#L137-L352) - the file helpers and `installPlugins`"
  - "[code://packages/server/src/commands/registry.ts#L38-L57](../../../../packages/server/src/commands/registry.ts#L38-L57) - where a local command is registered"
---

## Objective

`ahpd configure` (terminal only, no HTTP) asks the backends, host, port, token and folders as the plan's table says, confirms each folder as a trusted one, writes `config.json` keeping every key it did not ask, and installs the chosen backends not yet installed.

## Files

- `CREATE: packages/server/src/commands/configure.ts` - the command.
- `UPDATE: packages/server/src/commands/registry.ts` - registered in the local registry.
- `CREATE: packages/server/test/server-configure.test.ts` - the cases below, with a faked npm runner.

## Steps

1. Tests first in a temp config directory: all Enter writes the defaults and installs Claude; a second run shows the written values; a typed token is written to the token file; Enter on the token generates one and keeps an existing one; a folder answered No is left out; a key not asked (`users`) is kept.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
