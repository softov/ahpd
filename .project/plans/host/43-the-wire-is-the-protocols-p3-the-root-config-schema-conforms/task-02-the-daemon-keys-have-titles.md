---
title: The daemon keys have titles of their own, and http has one type
status: todo
depends: [task-01-the-schema-is-mapped-to-config-property-schema.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L248-L252](../../../../packages/server/src/commands/options.ts#L248-L252) - `serverFields`, the daemon keys, with no `title`"
  - "[code://packages/server/src/commands/options.ts#L346-L353](../../../../packages/server/src/commands/options.ts#L346-L353) - `http`'s two types"
  - "[code://packages/server/src/rootconfig.ts#L183-L201](../../../../packages/server/src/rootconfig.ts#L183-L201) - `schema()` and `values()`"
---

## Objective

Every daemon key in root config has a written title, and `http` is sent with one type, as open question 1 answers, with its value shown and written in that type.

## Files

- `UPDATE: packages/server/src/commands/options.ts` - a `title` on each field `DAEMON_KEYS` publishes; the CLI help ignores it.
- `UPDATE: packages/server/src/rootconfig.ts` - `http` sent as the answer says, its value shown in that shape and a write in that shape stored as the file form.
- `UPDATE: packages/sdk/test/wire.test.ts` - the `http` lines leave `KNOWN`.

## Steps

1. Do not start step 3 until open question 1 in the plan's Resume state is answered and written into its table.
2. Add titles (`Port`, `Bind address`, `HTTP API`, `MCP servers`, ...) to the published keys.
3. Apply the answer to `http` in `schema()`, `values()` and the write path.

## Validation

- `packages/sdk/test/wire.test.ts` passes with no `RootState /config/schema/properties/http` line in `KNOWN`.
- `packages/server/test/server-root-config.test.ts`: every daemon key's title is not its key; a file with `http: true` reads and writes back as `true` in the file.
- `pnpm test` passes.

## Resume
