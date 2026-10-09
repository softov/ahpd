---
title: The server README lists every command and flag
status: implemented
depends: []
layer: "docs"
refs:
  - "[code://packages/server/README.md](../../../../packages/server/README.md) - its `Commands` block lists 9 commands"
  - "[code://packages/server/src/commands/options.ts](../../../../packages/server/src/commands/options.ts) - the flags, `programGlobals` among them"
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - the detail each line links to"
---

## Objective

The server README's `Commands` block has one line for each command the daemon runs, and its `Options` table has one row for each global flag.

## Files

- `UPDATE: packages/server/README.md` - complete the `Commands` block and the `Options` table, and link `docs/DAEMON.md`.

## Steps

1. List the commands from `packages/server/src/commands/` and from the dispatch in `packages/server/src/main.ts`.
2. Write one line for each command and subcommand in the `Commands` block, with what it does.
3. List the flags from `programGlobals` and the other `OptionSpec` lists in `options.ts`.
4. Write one row for each flag in the `Options` table, with its default.
5. Link the `docs/DAEMON.md` section for each command that has one.

## Validation

- Every file in `packages/server/src/commands/` maps to a line in the README.
- `node packages/server/dist/src/main.js --help` lists no command the README leaves out.
- `pnpm build` passes.

## Resume
