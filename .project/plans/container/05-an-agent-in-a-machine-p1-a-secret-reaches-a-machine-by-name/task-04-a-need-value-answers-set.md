---
title: A need value in the computer plugin's options answers set
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L71](../../../../packages/computer/src/plugin.ts#L71) - `needs`, a bare object today"
  - "[code://packages/computer/src/plugin.ts#L72](../../../../packages/computer/src/plugin.ts#L72) - `profiles`, a bare object today, whose entries carry `needs`"
  - "[code://packages/computer/src/plugin.ts#L62](../../../../packages/computer/src/plugin.ts#L62) - `env`, the pattern"
  - "[code://packages/server/src/commands/config.ts#L61-L69](../../../../packages/server/src/commands/config.ts#L61-L69) - the mask honours `writeOnly` at any depth"
---

## Objective

A value under the computer plugin's `needs`, and under `needs` in any of its `profiles`, answers `<set>` in root config, `GET /api/config` and the plugin listing, as an `env` value does.

## Files

- `UPDATE: packages/computer/src/plugin.ts:71-72` - `needs` gets `additionalProperties: { type: 'string', writeOnly: true }`; `profiles` gets `additionalProperties: { type: 'object', properties: { needs: <the same> } }`.
- `UPDATE: packages/computer/test/computer-options.test.ts` - the schema case.
- `UPDATE: packages/server/test/plugin-mask.test.ts` - a computer plugin entry with a top-level and a profile need value.

## Steps

1. Declare the two schemas; nothing in `apply` changes, because the values are read as they are.
2. Check that a profile without `needs` still validates.

## Validation

- The mask answers `<set>` for both need values and leaves a profile's `image` as written.
- `pnpm --filter @ahpd/computer test` and `pnpm --filter @ahpd/server test` green.

## Resume
