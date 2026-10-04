---
title: The root config schema is mapped to ConfigPropertySchema
status: todo
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/rootconfig.ts#L156-L201](../../../../packages/server/src/rootconfig.ts#L156-L201) - `pluginKey` and `schema()`"
  - "[code://packages/server/test/server-root-config.test.ts](../../../../packages/server/test/server-root-config.test.ts) - the read and write tests"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `ConfigPropertySchema` (`src/types/common/state.ts:159-198`), which declares `minItems` and `maxItems` for an array"
---

## Objective

`schema()` answers properties that are each a `ConfigPropertySchema`, recursively through `items`, `properties` and `additionalProperties`, while `write` and the start-time check read the schema as written.

## Files

- `UPDATE: packages/server/src/rootconfig.ts` - a pure `conforming(key, schema)` and its use on every daemon key and every plugin key in `schema()`; `pluginKey`'s `options: schema ?? {}` becomes `{ type: 'object', title: 'Options' }` when there is no schema.
- `UPDATE: packages/server/test/server-root-config.test.ts` - the mapping cases.
- `UPDATE: packages/sdk/test/wire.test.ts` - the `RootState /config/schema` lines leave `KNOWN`, except `http`'s type, which stays naming task 02.

## Steps

1. Keep `type` when it is one of the five; `integer` -> `number`; a list -> its first non-`null` member; none -> `object` when it has `properties` or `additionalProperties`, else `string`.
2. Keep `title`, else the key spaced and capitalised; keep `description`, `default`, `enum`, `enumLabels`, `enumDescriptions`, `readOnly`, `required`, and `minItems` and `maxItems` on an `array`.
3. Fold `minimum`, `maximum` and `pattern` into the `description` as one sentence (`Between 0 and 65535.`, `Matches ^\S+$.`).
4. Recurse into `items`, `properties` and an object `additionalProperties`; drop `additionalProperties: true` or `false`, which `ConfigPropertySchema` cannot say.
5. Drop every other keyword, `writeOnly` included: Softov answered "Not sent" for where a secret is named, so it does not reach the wire.

## Validation

- `packages/sdk/test/wire.test.ts` passes with the mapped `RootState /config/schema` lines gone from `KNOWN`; its host has the daemon's root config and a plugin whose options have an `integer` with `minimum`, a `writeOnly` string and no titles.
- `packages/server/test/server-root-config.test.ts`: `port` reads as `number` with a title; a plugin's `retries` reads `number` with `Between 0 and ...` in its description; writing `port: 70000` or `retries: -1` is still refused; a plugin not loaded reads `options` as `{ type: 'object', title: 'Options' }`. An `array` option with `minItems` and `maxItems` keeps both, and a `string` with them loses them.
- `pnpm test` passes.

## Resume
