---
title: The daemon keys have titles of their own, and http has one type
status: done
depends: [task-01-the-schema-is-mapped-to-config-property-schema.md]
layer: "server"
refs:
  - "[code://packages/server/src/commands/options.ts#L338-L500](../../../../packages/server/src/commands/options.ts#L338-L500) - `serverFields`, the daemon keys, each with its `title`"
  - "[code://packages/server/src/commands/options.ts#L459-L471](../../../../packages/server/src/commands/options.ts#L459-L471) - `http`'s two types, and its `port` and `host`"
  - "[code://packages/server/src/commands/options.ts#L742-L749](../../../../packages/server/src/commands/options.ts#L742-L749) - `httpOf`, which already reads `true` as `{}` and `false` as off"
  - "[code://packages/server/src/rootconfig.ts#L315-L409](../../../../packages/server/src/rootconfig.ts#L315-L409) - `write()`, which stores a daemon key as sent"
  - "[code://packages/server/src/rootconfig.ts#L278-L308](../../../../packages/server/src/rootconfig.ts#L278-L308) - `schema()` and `values()`"
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

- The eight titles are on `serverFields`, which the help, the flag parser and the file's own check read. Only `description` and `cli` reach those readers. They are `Folders`, `Port`, `Bind address`, `HTTP API`, `Update check`, `Advanced tools`, `Wire capture` and `MCP servers`.
- `serverFields.paths.items` carries `title: 'Folder'`, so the array's items are named where the daemon declares them rather than taking `Folders` from above.
- `http`'s own `type` stays `['object', 'boolean']` in `serverFields`, so a file holding `true` or `false` still loads and a write is still checked against it. `schema()` sets the sent type to `'object'` after the mapping, which is the one place a client reads.
- `answered()` in `rootconfig.ts` answers a stored `http: true` as `{}`. `values()` filters a stored `http: false` out, so no `http` key is answered at all, which is what an absent key already says.
- Nothing is written by a read: a file holding `true` still holds `true` after `values()`, and the test pins that.
- `write()` is unchanged. A `null` removes the key as it does for every other daemon key, and an object is stored as sent.
