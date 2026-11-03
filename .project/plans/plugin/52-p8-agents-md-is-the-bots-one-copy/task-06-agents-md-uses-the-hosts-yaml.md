---
title: AGENTS.md uses the host's YAML
status: done
depends: [task-01-agents-md-has-parts-the-ui-owns.md]
layer: "packages/bot"
refs:
  - "[code://packages/sdk/src/types/plugin.ts#L564-L566](../../../../packages/sdk/src/types/plugin.ts#L564-L566) - `parseYaml` and `stringifyYaml` on the plugin context"
  - "[code://packages/server/src/plugins.ts#L916-L918](../../../../packages/server/src/plugins.ts#L916-L918) - the server gives a plugin its own YAML subset"
  - "[code://packages/bot/src/agents.ts](../../../../packages/bot/src/agents.ts) - imports `@cofold/yaml` directly"
---

## Objective

`agents.ts` reads and writes YAML with the plugin context's `parseYaml` and `stringifyYaml`.
`@ahpd/bot` has no runtime dependency again, only its `@ahpd/sdk` peer.

## Files

- `UPDATE: packages/bot/src/agents.ts` - take the two YAML functions as a seam, not as an import.
- `UPDATE: packages/bot/package.json` - remove `@cofold/yaml`.
- `UPDATE: pnpm-lock.yaml` - the lock without the removed dependency.
- `UPDATE: packages/bot/test/bot-agents.test.ts` - give the tests a YAML seam.

## Steps

1. Add a `Yaml` type with `parseYaml` and `stringifyYaml`, as `PluginContext` names them.
2. Make `readAgents` and `writeAgents` take a `Yaml` value as their first argument.
3. Remove the import of `@cofold/yaml` from `agents.ts`.
4. Remove `@cofold/yaml` from `packages/bot/package.json` and update the lock.
5. In the tests, use the YAML parser that other plugin tests use.

## Validation

- `bot-agents.test.ts` passes with the seam.
- `pnpm -s boundary` passes with no runtime dependency on `@ahpd/bot`.
- The gates pass: build, typecheck, boundary, schema and vitest.

## Resume

- **Done so far:** all steps. `readAgents(yaml, text)` and `writeAgents(yaml, text, parts)` take the two YAML functions as their first argument, and `agents.ts` imports no YAML.
- **Built as:** `Yaml` is the two functions as `PluginContext` names them, exported from `agents.ts`. `fields`, `setFields` and `entry` take it through, so one parse of a frontmatter and one stringify per changed key use the host's subset.
- **Built as:** `@cofold/yaml` is no longer a runtime dependency. It is a `devDependency`, because the test imports it as step 5 says. It was not removed from `package.json` altogether: an undeclared import resolves only where hoisting happens to provide it. `boundary` reports `@ahpd/bot: 1 declared, none undeclared`, the `@ahpd/sdk` peer.
- **Changed files:** `packages/bot/src/agents.ts`, `packages/bot/package.json`, `packages/bot/test/bot-agents.test.ts`, `pnpm-lock.yaml`.
- **Gates:** `node tools/schema.mjs`, `pnpm -s build`, `pnpm -s typecheck`, `pnpm -s boundary` and `git diff --quiet tools/` pass; vitest over the eight packages: 307 files and 5340 tests passed.
- **Left dirty by the suite:** `packages/sdk/test/fixtures/wire.jsonl` is rewritten on every run. Restore it with `git checkout -- packages/sdk/test/fixtures/wire.jsonl`.
- **Not committed:** the work is uncommitted, as this preset expects.
