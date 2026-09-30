---
title: "`mcpServers` in the configuration and in root config"
status: todo
depends: []
layer: "server"
refs:
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/common/agentHostSchema.ts#L697-L760 - VS Code's key and schema, copied
  - "[code://packages/server/src/commands/options.ts#L117-L263](../../../../packages/server/src/commands/options.ts#L117-L263) - `serverFields`"
---

## Objective

`config.json` takes `mcpServers`, a map of name to `{ type: "stdio", command, args?, env?, cwd? }` or `{ type: "http", url, headers? }` as VS Code's schema has it, and daemon/11's root config port publishes it as a live key; an entry of neither shape is skipped with a warning.

## Files

- `UPDATE: packages/server/src/commands/options.ts` - the file key (no flag).
- `UPDATE: packages/server/src/rootconfig.ts` - the root key, applied live.
- `UPDATE:` the options and root config tests.

## Steps

1. Tests first: both shapes accepted, a malformed entry warned and skipped, the key in root config for `config:read`, a write applied without `restartNeeded`; `headers` and `env` values are `writeOnly`.
2. Implement; depends on daemon/11 task 02 for the port.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
