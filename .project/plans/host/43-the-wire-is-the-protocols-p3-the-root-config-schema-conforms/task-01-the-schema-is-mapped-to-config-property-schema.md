---
title: The root config schema is mapped to ConfigPropertySchema
status: done
depends: []
layer: "server"
refs:
  - "[code://packages/server/src/rootconfig.ts#L108-L141](../../../../packages/server/src/rootconfig.ts#L108-L141) - `conforming`, the mapping, with `titleOf`, `boundOf` and `typeOf` above it"
  - "[code://packages/server/src/rootconfig.ts#L249-L297](../../../../packages/server/src/rootconfig.ts#L249-L297) - `pluginKey` and `schema()`, where every daemon key and every plugin key is mapped"
  - "[code://packages/server/test/server-root-config.test.ts](../../../../packages/server/test/server-root-config.test.ts) - the read and write tests, and the mapping cases"
  - "[code://packages/server/test/fixtures/plugin-bounded/index.ts](../../../../packages/server/test/fixtures/plugin-bounded/index.ts) - a plugin whose options carry `minItems` and `maxItems` on an array and on a string"
  - "npm://@microsoft/agent-host-protocol@1.0.0 - `ConfigPropertySchema` (`src/types/common/state.ts:159-198`), which declares `minItems` and `maxItems` for an array"
---

## Objective

`schema()` answers properties that are each a `ConfigPropertySchema`, recursively through `items`, `properties` and `additionalProperties`, while `write` and the start-time check read the schema as written.

## Files

- `UPDATE: packages/server/src/rootconfig.ts` - a pure `conforming(key, schema)` and its use on every daemon key and every plugin key in `schema()`; `pluginKey`'s `options: schema ?? {}` becomes `{ type: 'object', title: 'Options' }` when there is no schema.
- `UPDATE: packages/server/test/server-root-config.test.ts` - the mapping cases.
- `CREATE: packages/server/test/fixtures/plugin-bounded/index.ts` - a plugin whose options carry both item bounds on an array and on a string.
- `UPDATE: packages/sdk/test/wire.test.ts` - every `RootState /config/schema` line leaves `KNOWN`, the `http` type with the rest.

## Steps

1. Keep `type` when it is one of the five; `integer` -> `number`; a list -> its first non-`null` member; none -> `object` when it has `properties` or `additionalProperties`, else `string`.
2. Keep `title`, else the key spaced and capitalised; keep `description`, `default`, `enum`, `enumLabels`, `enumDescriptions`, `readOnly`, `required`, and `minItems` and `maxItems` on an `array`.
3. Fold `minimum`, `maximum` and `pattern` into the `description` as one sentence (`Between 0 and 65535.`, `Matches ^\S+$.`).
4. Recurse into `items`, `properties` and an object `additionalProperties`; drop `additionalProperties: true` or `false`, which `ConfigPropertySchema` cannot say.
5. Drop every other keyword, `writeOnly` included: Softov answered "Not sent" for where a secret is named, so it does not reach the wire.

## Validation

- `packages/sdk/test/wire.test.ts` passes with the mapped `RootState /config/schema` lines gone from `KNOWN`; its host has the daemon's root config and a plugin whose options have an `integer` with `minimum`, a `writeOnly` string and no titles.
- `packages/server/test/server-root-config.test.ts`: `port` reads as `number` with a title; a plugin's `retries` reads `number` with `At least 0.` in its description; writing `http: { port: 70000 }` or `retries: -1` is still refused; a plugin not loaded reads `options` as `{ type: 'object', title: 'Options' }`. An `array` option with `minItems` and `maxItems` keeps both, and a `string` with them loses them.
- `pnpm test` passes.

## Resume

- `conforming(key, schema)` is in `packages/server/src/rootconfig.ts`, a pure function beside `same`. Three helpers sit above it. `titleOf` titles a key that has none. `boundOf` says the bound a description carries instead. `typeOf` picks the one type sent. `TYPES` holds the five the protocol declares.
- The mapping runs in `schema()` alone. It covers the daemon keys from `configSchema` and each plugin key from `pluginKey`. A write and the start-time check still read the schema as written.
- The `http` line left `KNOWN` in this task, on the first-member rule: `['object', 'boolean']` reads as `object` with no help from task 02. Softov, 2026-10-07, confirmed that reading. Task 02 still sets the type explicitly, so reordering the list cannot change it.
- `pluginKey` answers `options: { type: 'object', title: 'Options' }` where no schema loaded, which is the smallest conforming shape that still says nothing about the plugin's keys.
- The Validation named `port: 70000` as the write that stays refused. `serverFields.port` declares no `minimum` or `maximum`, so that write is not refused. The case is written against `http: { port: 70000 }`, which is bounded. The refusal itself is unchanged.
- The plugin fixture is new: `packages/server/test/fixtures/plugin-bounded/index.ts`. `plugin-schema` is shared by three test files, so a bound on a string would have moved cases that are not about bounds.
- The existing case `carries the schema of a plugin that loaded` pinned the raw `retries` as `{ type: 'integer', minimum: 0 }`. It now pins the mapped shape, `{ type: 'number', title: 'Retries', description: 'At least 0.' }`, which is what a client reads.
- No test was weakened. `KNOWN` in `packages/sdk/test/wire.test.ts` is now empty, and its comment says why.
