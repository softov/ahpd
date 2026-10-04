---
title: The connection is plugin:<name>, with the grants its entry names
status: todo
depends: [task-01-a-plugin-opens-a-connection.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L66-L73](../../../../packages/sdk/src/types/plugin.ts#L66-L73) - `PluginSpec`"
  - "[code://packages/server/src/config.ts#L378-L392](../../../../packages/server/src/config.ts#L378-L392) - `asSpec`"
  - "[code://packages/server/src/plugins.ts#L684](../../../../packages/server/src/plugins.ts#L684) - where the spec reaches `pluginHost`"
  - "[code://packages/sdk/src/types/users.ts#L40-L101](../../../../packages/sdk/src/types/users.ts#L40-L101) - `Principal`"
  - "[code://packages/sdk/src/users.ts#L79](../../../../packages/sdk/src/users.ts#L79) - `holds`"
  - "[code://packages/sdk/src/host/owners.ts#L47-L51](../../../../packages/sdk/src/host/owners.ts#L47-L51) - `ownerFor`, which answers `plugin:<name>` for a plugin's principal"
  - "[code://packages/sdk/src/types/usage.ts#L19](../../../../packages/sdk/src/types/usage.ts#L19) - `Owner`, which gains the `plugin:<name>` form"
  - "[code://packages/server/src/commands/options.ts#L408-L416](../../../../packages/server/src/commands/options.ts#L408-L416) - `pluginEntry`"
  - "[code://packages/sdk/src/users.ts#L545](../../../../packages/sdk/src/users.ts#L545) - `principalOf`, how grants become `can`"
---

## Objective

A plugin's connection is served as the principal `plugin:<name>`, which can do what its configuration entry's `grants` say and nothing else.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:66-73` - `grants?: string[]` on the object form of `PluginSpec`.
- `UPDATE: packages/server/src/config.ts:378-392` - `asSpec` keeps `grants` when it is an array of strings.
- `UPDATE: packages/server/src/commands/options.ts:408-416` - `pluginEntry` gains `grants: { type: 'array', items: { type: 'string' } }`.
- `UPDATE: packages/server/src/plugins.ts:684` - the loader checks each grant, drops one whose shape is not `<subject>:<verb>` with a line in its `problems` naming `plugins.<name>.grants`, and hands the rest to `pluginHost`.
- `UPDATE: packages/sdk/src/types/usage.ts:19` - `Owner` gains the `plugin:<name>` form.
- `UPDATE: packages/sdk/src/host/owners.ts:47-51` - `ownerFor` answers `plugin:<name>` for a plugin's principal, not `user:plugin:<name>`.
- `UPDATE: packages/sdk/src/plugins.ts` - `connect()` passes the principal to `Host.accept`.
- `UPDATE: packages/server/test/plugin-connect.test.ts` - the cases below.

## Steps

1. Build the principal with id `plugin:<name>`, no roles, no `memberships`, `primary` or `teams` (its work is charged to no team), and `can` answering from the grants with `holds` (`users.ts:79`), the matching a role's grants use. A policy matches it by its id.
2. No `grants` is an empty list, so every gated command is refused `-32009`.
3. Never pass `root`.
4. On a host with no user directory nothing is gated, as for any connection.
5. Add the `plugin:<name>` form to `Owner`, and have `ownerFor` answer it for a plugin's principal, so a plugin's sessions and usage are its own.

## Validation

- `packages/server/test/plugin-connect.test.ts`: with a directory, no `grants` is refused `createSession`; `session:write` is allowed it and refused `runAutomation`; a malformed grant is dropped and appears in the loader's `problems` naming `plugins.<name>.grants`; a session the plugin creates is owned by `plugin:<name>`, and its usage is recorded under that owner.
- `pnpm test`, `pnpm typecheck` green.

## Resume

