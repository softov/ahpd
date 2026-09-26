---
title: The connection is plugin:<name>, with the grants its entry names
status: todo
depends: [task-01-a-plugin-opens-a-connection.md]
layer: "sdk, server"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L61-L68](../../../../packages/sdk/src/types/plugin.ts#L61-L68) - `PluginSpec`"
  - "[code://packages/server/src/config.ts#L223-L250](../../../../packages/server/src/config.ts#L223-L250) - `asSpec`"
  - "[code://packages/server/src/plugins.ts#L421](../../../../packages/server/src/plugins.ts#L421) - where the spec reaches `pluginHost`"
  - "[code://packages/sdk/src/types/users.ts#L40-L66](../../../../packages/sdk/src/types/users.ts#L40-L66) - `Principal`"
  - "[code://packages/sdk/src/users.ts#L343](../../../../packages/sdk/src/users.ts#L343) - `principalOf`, how grants become `can`"
---

## Objective

A plugin's connection is served as the principal `plugin:<name>`, which can do what its configuration entry's `grants` say and nothing else.

## Files

- `UPDATE: packages/sdk/src/types/plugin.ts:61-68` - `grants?: string[]` on the object form of `PluginSpec`.
- `UPDATE: packages/server/src/config.ts:223-250` - `asSpec` keeps `grants`, dropping and reporting one whose shape is not `<subject>:<verb>`.
- `UPDATE: packages/server/src/plugins.ts:421` - hands the grants to `pluginHost`.
- `UPDATE: packages/sdk/src/plugins.ts` - `connect()` passes the principal to `Host.accept`.
- `UPDATE: test/plugin-connect.test.ts` - the cases below.

## Steps

1. Build the principal with id `plugin:<name>`, no roles, and `can` answering from the grants with the same `*` matching a role's grants use.
2. No `grants` is an empty list, so every gated command is refused `-32009`.
3. Never pass `root`.
4. On a host with no user directory nothing is gated, as for any connection.

## Validation

- `test/plugin-connect.test.ts`: with a directory, no `grants` is refused `createSession`; `session:write` is allowed it and refused `runAutomation`; a malformed grant is reported and dropped.
- `pnpm test`, `pnpm typecheck` green.

## Resume

