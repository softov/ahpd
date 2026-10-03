---
title: A need value in the computer plugin's options answers set
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L61-L64](../../../../packages/computer/src/plugin.ts#L61-L64) - `needValue`, `{ type: 'string', secretAtUse: true }`, and `needValues`, which both `needs` and each profile's `needs` use"
  - "[code://packages/computer/src/plugin.ts#L85-L91](../../../../packages/computer/src/plugin.ts#L85-L91) - `needs` and `profiles`, already declared with `needValues`"
  - "[code://packages/computer/src/plugin.ts#L76](../../../../packages/computer/src/plugin.ts#L76) - `env`, the `writeOnly` pattern"
  - "[code://packages/server/src/commands/config.ts#L55-L58](../../../../packages/server/src/commands/config.ts#L55-L58) - the mask answers a `$secret` reference as written, then `<set>` wherever the schema says `writeOnly`"
---

## Objective

A value under the computer plugin's `needs`, and under `needs` in any of its `profiles`, answers `<set>` in root config, `GET /api/config` and the plugin listing, as an `env` value does.

## Files

- `UPDATE: packages/computer/src/plugin.ts:61` - `needValue` becomes `{ type: 'string', secretAtUse: true, writeOnly: true }`; `secretAtUse` stays, and `needs` and the profiles schema already use it through `needValues`, so nothing else in the schema changes.
- `UPDATE: packages/computer/test/computer-options.test.ts` - the schema case.
- `UPDATE: packages/server/test/plugin-mask.test.ts` - a computer plugin entry with a top-level and a profile need value.

## Steps

1. Add `writeOnly: true` to `needValue` and say in its doc comment that a plain value answers `<set>` and a `$secret` reference answers as written; nothing in `apply` changes, because the values are read as they are.
2. Check that a profile without `needs` still validates.

## Validation

- The mask answers `<set>` for a plain value under `needs` and under a profile's `needs`, answers a `{ "$secret": "host:x" }` value in either place as written, and leaves a profile's `image` as written.
- `pnpm --filter @ahpd/computer test` and `pnpm --filter @ahpd/server test` green.

## Resume
