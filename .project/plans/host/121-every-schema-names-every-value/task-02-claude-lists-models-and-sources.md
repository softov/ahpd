---
title: Claude lists models and model sources apart
status: done
depends:
  - task-01-every-schema-entry-point-checks.md
layer: "agent-claude, server, docs"
refs:
  - "[code://packages/agent-claude/src/options.ts#L169-L175](../../../../packages/agent-claude/src/options.ts#L169-L175) - `env` is `{ type: 'object' }` with no properties"
  - "[code://packages/agent-claude/src/options.ts#L197-L201](../../../../packages/agent-claude/src/options.ts#L197-L201) - `extraArgs` is `{ type: 'object' }` with no properties"
  - "[code://packages/agent-claude/src/options.ts#L216](../../../../packages/agent-claude/src/options.ts#L216) - `models` is `{ type: 'array' }` with no items"
  - "[code://packages/agent-claude/src/models.ts#L35-L38](../../../../packages/agent-claude/src/models.ts#L35-L38) - `ModelEntry`, which mixes a string, a model and a fetch in one list"
  - "[code://packages/agent-claude/src/models.ts#L136-L159](../../../../packages/agent-claude/src/models.ts#L136-L159) - `ownModels` and `offeredModels`, which read the list"
  - "[code://packages/agent-claude/src/plugin.ts#L111](../../../../packages/agent-claude/src/plugin.ts#L111) - where a record's `models` reaches the harness"
  - "[code://packages/server/src/agents/migrate.ts#L571](../../../../packages/server/src/agents/migrate.ts#L571) - the pattern: `applyPresets` rewrites stored config once at start"
  - "[code://packages/agent-acp/src/plugin.ts#L86](../../../../packages/agent-acp/src/plugin.ts#L86) - the pattern: `env` names its values with `additionalProperties`"
  - "[code://packages/agent-claude/README.md#L72](../../../../packages/agent-claude/README.md#L72) - the docs of a `models` entry"
---

## Objective

A client draws every field of a Claude record, and an edit keeps the value's shape.
Each list holds one shape: `models` holds models, and `modelSources` holds fetches.

## Files

- `UPDATE: packages/agent-claude/src/models.ts:35-38` - replace `ModelEntry` with a model `{ id, name? }` and a source `{ fetch, match?, key? }`.
- `UPDATE: packages/agent-claude/src/models.ts:136-159` - read models and sources from their own lists.
- `UPDATE: packages/agent-claude/src/claude.ts` - take `models` and `modelSources` as two options.
- `UPDATE: packages/agent-claude/src/plugin.ts:111` - pass a record's `modelSources` beside its `models`.
- `UPDATE: packages/agent-claude/src/options.ts:169-175` - give `env` an `additionalProperties` that names its four value shapes.
- `UPDATE: packages/agent-claude/src/options.ts:197-201` - give `extraArgs` an `additionalProperties` of `{}`.
- `UPDATE: packages/agent-claude/src/options.ts:216` - give `models` an object `items`, and add `modelSources` with an object `items`.
- `UPDATE: packages/server/src/agents/migrate.ts` - rewrite a stored record's mixed `models` list into `models` and `modelSources`, once at start.
- `UPDATE: packages/agent-claude/test` - cases for the two lists and for the rewrite of a mixed list.
- `UPDATE: packages/agent-claude/README.md:72` - describe `models` and `modelSources`.
- `UPDATE: CHANGELOG.md` - the new `modelSources` field and the rewrite at start.

## Steps

1. Write `env`'s values as `oneOf`: a string, `null`, `{ fromEnv }` and `{ "$secret" }`.
2. Keep `fromEnv` and `secretAtUse` on `env`, so the channel reads it as today.
3. Write `extraArgs` with `additionalProperties: {}`, because a value is any JSON.
4. Write `models.items` as an object with a required `id` and an optional `name`.
5. Add `modelSources`, whose items are an object with a required `fetch`, an optional `match` and an optional `key`.
6. Mark `key` as a credential, as `env` marks its values, so a client never shows its value.
7. Change the readers in `models.ts` and `claude.ts` to read the two lists.
8. In the rewrite at start, turn a string entry into `{ id }`, and keep an `{ id }` entry.
9. Move each `fetch` entry to `modelSources`.
10. Write each rewritten record once, and leave a record already in the new shape untouched.
11. Never write a `key` value into a log line or a problem line.
12. Add the test cases, the docs and the changelog line.

## Validation

- `schemaGaps` finds no gap in the `claude` engine schema.
- A stored record with `["deepseek-flash", { "fetch": ..., "match": ..., "key": { "fromEnv": ... } }]` reads back with one `models` entry and one `modelSources` entry.
- That record offers the same models as before the rewrite.
- A second start does not write the record again.
- `pnpm -s typecheck && pnpm -s build && pnpm -s boundary && pnpm -s test` passes.
- By hand: ahpw draws each `models` row and each `modelSources` row as fields.

## Resume

- **Done so far:** `env`'s values are `oneOf` a string, `null`, `{ fromEnv }` and `{ "$secret" }`, and `fromEnv` and `secretAtUse` stay. `extraArgs` is `additionalProperties: {}`. `models` items are `{ id, name? }`. The new `modelSources` items are `{ fetch, match?, key? }`, and `key` is `writeOnly` and `secretAtUse`. `models.ts` and `claude.ts` read the two lists: the written models first, then each source's models, each id once. `plugin.ts` reads each list through `modelsOf` and `sourcesOf`, which drop an entry of the wrong shape. `splitModels` in `packages/server/src/agents/migrate.ts` rewrites a stored Claude record's mixed list into the two lists, once. `run.ts` calls it after `applyPresets` and before the records open. The README describes the two lists and the `modelSources` example.
- **Next action:** Softov reads the report.
- **Files:** `packages/agent-claude/src/options.ts`, `packages/agent-claude/src/models.ts`, `packages/agent-claude/src/claude.ts`, `packages/agent-claude/src/plugin.ts`, `packages/agent-claude/README.md`, `packages/agent-claude/test/agent-claude-models.test.ts`, `packages/agent-claude/test/agent-claude-options-schema.test.ts`, `packages/agent-claude/test/agent-claude-presets.test.ts`, `packages/agent-claude/test/engine.test.ts`, `packages/sdk/src/channels/owners.ts`, `packages/sdk/src/agents/channel.ts`, `packages/sdk/src/index.ts`, `packages/sdk/test/owners-nested-secrets.test.ts` (new), `packages/server/src/agents/migrate.ts`, `packages/server/src/commands/run.ts`, `packages/server/test/agents-migrate.test.ts`.
- **Open questions:** none.
- **Departures:** the rewrite is in `packages/server/src/agents/migrate.ts`, with its tests in `packages/server/test/agents-migrate.test.ts`. It rewrites a stored record through the server's record store, as `applyPresets` does. `splitModels` runs after `applyPresets`, so a record that a preset writes is split in the same start. It logs each record it leaves whole, with the reason and no value. It moves a plain `modelSources` key to the vault, in the owner's scope.
- **Departures, the vault:** `writeOnlyPaths` in `packages/sdk/src/channels/owners.ts` finds a `writeOnly` field at any depth, in a list entry or a map value. The agents channel and the start migration use it, so each such value moves to the vault and a client sees `<set>`. An empty list key keeps its secret only while its entry is unchanged. Otherwise the channel refuses the put, so a key never goes to another endpoint. A host agent may name a `host:` secret in a nested field, such as an ACP `env` value. `sourcesProblem` in `models.ts` drops a source it cannot read, and names the field and never the value.
- **Watch out for:** only agent-claude reads a `models` list from a record. The proxy's `ModelEntry` has one shape and did not change. A plain ACP `env` value already in a stored host record stays plain until the next put of that record.
