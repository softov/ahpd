---
title: A plugin is loaded once and keyed by its name
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/plugins.ts#L660-L678](../../../../packages/server/src/plugins.ts#L660-L678) - the repeated-name check by `provider`"
  - "[code://packages/server/src/commands/config.ts#L105-L118](../../../../packages/server/src/commands/config.ts#L105-L118) - `keyed`, which builds `plugins.<name>#<provider>`"
  - "[code://packages/server/src/rootconfig.ts#L109-L114](../../../../packages/server/src/rootconfig.ts#L109-L114) - root config entries"
  - "[code://packages/server/test/plugin-load.test.ts](../../../../packages/server/test/plugin-load.test.ts) - the load tests and the `plugin-provider` fixture"
---

## Objective

A plugin name written twice in `plugins` fails the start with a problem naming it, and every plugin's root config key is `plugins.<name>`.

## Files

- `UPDATE: packages/server/src/plugins.ts:660-678` - a repeated name is a problem whatever its options; the `provider` check goes.
- `UPDATE: packages/server/src/commands/config.ts:105-118` - `keyed` returns `plugins.<name>` only.
- `UPDATE: packages/server/src/rootconfig.ts` - follows `keyed`.
- `UPDATE: packages/server/test/plugin-load.test.ts` and the root config tests - the repeated cases.
- `DELETE: packages/server/test/fixtures/plugin-provider` - if nothing else uses it.

## Steps

1. Replace the repeated-name check: the second and later entries of one name are refused with "plugin <name> is named <n> times; write it once and use its options for variants". A switched-off entry still counts, since root config would key it the same.
2. Drop the `#<provider>` suffix and the comments citing the superseded decision.

## Validation

- Tests: two entries of one name refuse the second; a single entry is keyed `plugins.<name>`.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test`.

## Resume
