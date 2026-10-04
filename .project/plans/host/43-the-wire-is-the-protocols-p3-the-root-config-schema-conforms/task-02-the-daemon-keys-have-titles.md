---
title: The daemon keys have titles of their own, and http has one type
status: todo
depends: [task-01-the-schema-is-mapped-to-config-property-schema.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L248-L252](../../../../packages/server/src/commands/options.ts#L248-L252) - `serverFields`, the daemon keys, with no `title`"
  - "[code://packages/server/src/commands/options.ts#L345-L352](../../../../packages/server/src/commands/options.ts#L345-L352) - `http`'s two types"
  - "[code://packages/server/src/commands/options.ts#L588-L600](../../../../packages/server/src/commands/options.ts#L588-L600) - `httpOf`, which already reads `true` as `{}` and `false` as off"
  - "[code://packages/server/src/rootconfig.ts#L215-L245](../../../../packages/server/src/rootconfig.ts#L215-L245) - `write()`, which stores a daemon key as sent"
  - "[code://packages/server/src/rootconfig.ts#L183-L201](../../../../packages/server/src/rootconfig.ts#L183-L201) - `schema()` and `values()`"
---

## Objective

Every daemon key in root config has a written title, and `http` is sent as `type: 'object'`, with a stored `true` answered as `{}` and a stored `false` answered as no value.

## Files

- `UPDATE: packages/server/src/commands/options.ts` - a `title` on each field `DAEMON_KEYS` publishes; the CLI help ignores it.
- `UPDATE: packages/server/src/rootconfig.ts` - `schema()` sends `http` with `type: 'object'` and its `port` and `host` properties; `values()` answers a stored `true` as `{}` and leaves `http` out for a stored `false`; `write()` stores an object as sent and `null` removes the key, as today.
- `UPDATE: packages/sdk/test/wire.test.ts` - the `http` lines leave `KNOWN`.

## Steps

1. Add titles (`Port`, `Bind address`, `HTTP API`, `MCP servers`, ...) to the published keys.
2. In `schema()`, set `http`'s `type` to `'object'` explicitly, even though task 01's first-member rule already yields it, so reordering the list cannot change it; the daemon's own `configSchema` keeps `['object', 'boolean']`, so a file holding `true` or `false` still loads and a write is still checked against it.
3. In `values()`, map a stored `true` to `{}` and a stored `false` to absent; leave every other shape as it is.

## Validation

- `packages/sdk/test/wire.test.ts` passes with no `RootState /config/schema/properties/http` line in `KNOWN`.
- `packages/server/test/server-root-config.test.ts`: every daemon key's title is not its key; the schema's `http` has `type: 'object'`; a file with `http: true` answers `http: {}`; a file with `http: false` answers no `http`; a write of `{ port: 8081 }` stores that object; a write of `null` removes the key; a file holding `true` that nobody writes to keeps `true`.
- `pnpm test` passes.

## Resume
