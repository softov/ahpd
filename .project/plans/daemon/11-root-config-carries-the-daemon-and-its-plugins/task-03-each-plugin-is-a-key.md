---
title: Each plugin is a key
status: done
depends: [task-02-the-daemons-keys.md]
layer: "server"
refs:
  - "[code://packages/server/src/plugins.ts#L420-L440](../../../../packages/server/src/plugins.ts#L420-L440) - the loaded `optionsSchema`"
  - "[code://packages/server/src/install.ts#L182-L223](../../../../packages/server/src/install.ts#L182-L223) - how `plugins` is edited"
---

## Objective

Each entry of `plugins` is a root config key `plugins.<name>` with `{ enabled, options }`, `options` carrying the plugin's `optionsSchema` when it loaded; a write sets the entry's `enabled` and `options` in `config.json`, checked against that schema, and answers `restartNeeded`.

## Files

- `UPDATE: packages/server/src/rootconfig.ts` - the plugin keys.
- `UPDATE: packages/server/src/plugins.ts` - keep each loaded plugin's schema for the port.
- `UPDATE: packages/server/test/server-root-config.test.ts`.

## Steps

1. Tests first: a loaded plugin's key carries its schema; a disabled one has `enabled: false` and a free `options`; a write of `enabled: false` turns a string spec into an object spec; a write that fails the schema is refused naming the option.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
