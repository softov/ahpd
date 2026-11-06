---
title: The host config names its maps
status: done
depends:
  - task-01-every-schema-entry-point-checks.md
layer: server
refs:
  - "[code://packages/server/src/commands/options.ts#L567](../../../../packages/server/src/commands/options.ts#L567) - `shellEnv`, a map with no value schema"
  - "[code://packages/server/src/commands/options.ts#L657-L662](../../../../packages/server/src/commands/options.ts#L657-L662) - `modelProxy` and `mcpServers`, maps with no value schema"
  - "[code://packages/server/src/commands/options.ts#L398-L410](../../../../packages/server/src/commands/options.ts#L398-L410) - why `mcpServers` checks each entry on its own"
  - "[code://packages/server/src/proxy/providers.ts#L99](../../../../packages/server/src/proxy/providers.ts#L99) - `proxySchema`, whose `models` is a map with no value schema"
  - npm://@cofold/commands@0.3.0 - `check` takes a schema in `additionalProperties` and copies each value without a check
---

## Objective

A client draws the host's `shellEnv`, `modelProxy.models` and `mcpServers` as name and value rows.
The fix stays in ahpd: cofold 0.3.0 accepts the schema, and the host checks each value itself.

## Files

- `UPDATE: packages/server/src/commands/options.ts:567` - give `shellEnv` the value schema of one variable.
- `UPDATE: packages/server/src/commands/options.ts:657-662` - give `modelProxy.models` and `mcpServers` their value schemas.
- `UPDATE: packages/server/src/proxy/providers.ts:99` - give `models` the schema of a list of `ModelEntry`.
- `CREATE: packages/server/test/config-maps.test.ts` - the maps carry a value schema, and `check` still accepts a config.
- `UPDATE: CHANGELOG.md` - the schema change.

## Steps

1. Add a local `MapSchema` type in `options.ts` that widens cofold's `JsonSchema` with a schema in `additionalProperties`.
2. Give each of the four maps its value schema through `MapSchema`.
3. Keep the check of `mcpServers` one entry at a time, so one bad server does not stop a start.
4. Check each `shellEnv` and `models` value in the host, because cofold copies a map value without a check.
5. Write `config-maps.test.ts` against `check` from `@cofold/commands` 0.3.0.
6. Add the changelog line.

## Validation

- `schemaGaps` finds no gap in `configSchema` and `proxySchema`.
- `check` accepts a valid `config.json`, and a bad `shellEnv` or `models` value is still a problem line.
- A `config.json` with one bad `mcpServers` entry still starts, with that entry named and left out.
- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test` passes.

## Resume

- **Done so far:** `MapSchema` and `asJsonSchema` in `packages/server/src/commands/options.ts` widen cofold's `JsonSchema` with a schema in `additionalProperties`. `shellEnv` names one variable as text or null. `mcpServers` names one server with `mcpServerSchema`. `modelProxy.models` and the proxy's own `models` name one value as a list of `modelEntrySchema`. The host still checks each value itself. `shellEnvProblems` and `proxyProblems` check `shellEnv` and the model lists. `mcpServers` still checks one entry at a time, and names a bad one without stopping the start. `packages/server/test/config-maps.test.ts` covers the maps, cofold 0.3.0's copy of a map value, and each host check.
- **Next action:** Softov reads the report.
- **Files:** `packages/server/src/commands/options.ts`, `packages/server/src/proxy/providers.ts`, `packages/server/test/config-maps.test.ts` (new).
- **Open questions:** none.
- **Departures:** a plugin entry's `options` in the daemon config also had no value schema, which the plan did not list. It is now `additionalProperties: {}`, because a plugin names its own options.
- **Watch out for:** a map schema on `mcpServers` must not make `check` refuse the whole config for one entry. The case with a bad entry asserts that `check` accepts the config, and that the host names and drops the entry.
