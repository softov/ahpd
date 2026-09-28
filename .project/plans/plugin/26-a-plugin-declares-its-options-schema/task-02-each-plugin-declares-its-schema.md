---
title: Each shipped plugin declares its options schema
status: implemented
depends: [task-01-the-loader-checks-the-schema.md]
layer: "agent-acp, agent-claude, agent-cofold, agent-pi, computer, tunnel-devtunnel"
refs:
  - "[code://packages/agent-acp/src/plugin.ts#L30-L93](../../../../packages/agent-acp/src/plugin.ts#L30-L93) - `optionsOf`, replaced by a schema"
  - "[code://packages/agent-pi/src/plugin.ts](../../../../packages/agent-pi/src/plugin.ts) - `optionsOf`"
  - "[code://packages/agent-cofold/src/plugin.ts](../../../../packages/agent-cofold/src/plugin.ts) - `optionsOf`"
  - "[code://packages/agent-claude/src/plugin.ts](../../../../packages/agent-claude/src/plugin.ts) - `optionsOf`"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - options read inline"
  - "[code://packages/tunnel-devtunnel/src/plugin.ts](../../../../packages/tunnel-devtunnel/src/plugin.ts) - options read inline"
---

## Objective

Every plugin in this repository exports an `optionsSchema` matching the options table in its README, and its `apply` reads the checked values without its own type tests.

## Files

- `UPDATE: packages/<each>/src/plugin.ts` - `export const optionsSchema`; `optionsOf` reduced to building the typed options from checked values, or removed.
- `UPDATE: packages/<each>/README.md` - nothing unless a documented option disagrees with the schema.

## Steps

1. One package at a time, its existing plugin tests first, then a case per option with a wrong type.
2. agent-acp's `command` becomes `required` in the schema; its load-time sentence becomes the loader's.

## Validation

- Each package's plugin tests: a wrong type per option is reported by the loader and the plugin skipped.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

- **Changed:** each `packages/<each>/src/plugin.ts` exports `optionsSchema`, re-exported from its `index.ts` so the module the loader imports carries it. agent-acp: `command` required. agent-claude: `computerConfigDir` is `anyOf` string or `false`, `workerStop` an enum. agent-cofold: `tools` nested to `files`, `shell`, `memory` and `web` (`boolean` or `{ search: { brave, tavily, duckduckgo } }`, `apiKey` required on brave and tavily). agent-pi: `projectTrust` is `enum: ['trust', 'deny']`, so `ask` is now refused where it used to become `trust`. computer: `runtime` is `enum: ['docker']`, which replaces its own `runtime ... is not one this package has` throw; `max` integer >= 1; `devcontainer` object or boolean. tunnel-devtunnel: `name`, `keep`, `anonymous`.
- **optionsOf:** acp, cofold and pi are now a cast of the checked values; claude keeps only `paths ?? host.paths`; tunnel and computer read each option with a cast and `?? defaults.<key>` for a direct `apply` call. The helpers that tested types (`str`, `words`, `strings`, `line`, `flag`, `word`) are gone. Kept on purpose: computer's `named` and `profilesOf` for the values inside a map (`env`, `needs`, `devcontainer.env`, `profiles`), because cofold's `JsonSchema` has `additionalProperties` as a boolean only and cannot say what a map's values are. agent-cofold's exported `toolsOf` stays (public API with its own tests) but the plugin no longer calls it. Strings are `type: 'string'` without `minLength`: `check` words a `minLength` field as `must be at least 1 character` even for a number, so an empty string now reaches `apply` where it used to be dropped; whitespace is no longer trimmed (pi, tunnel `name`).
- **Tests:** one `test/<package>-options.test.ts` per package, through the real loader: a case per option with a wrong value, each expecting exactly `plugin <name> skipped: plugins.<name>.options.<key> must be ...` and nothing loaded; a case that the schema's keys equal the README options table's (for computer, that they include it); acp's missing `command` is `plugins.@ahpd/agent-acp.options.command is required`; cofold's `tools.files: 'no'` is named by its full key. Updated: `agent-pi.test.ts` lost the two `optionsOf` cases that pinned dropping a misspelled value and `ask` becoming `trust` (the loader cases cover both) for one that the checked values pass as they are; `computer-plugin.test.ts`'s `runtime: 'kvm'` case now expects `runtime must be one of docker`.
- **Failed first, for the right reason:** with no schema exported, every README case failed reading `properties` of `undefined`, and the wrong-value cases failed because the plugin loaded with no problem (the value dropped) or with the plugin's own throw (`plugin @ahpd/agent-acp failed ...`, `plugin ahpd-computer failed ...`) instead of the loader's `skipped` line.
- **README and code disagree:** computer's README table lists 9 options and the code reads 18; `mounts`, `profiles`, `needs`, `bodyMounts`, `images` and `devcontainer` are in `docs/COMPUTER.md` or `docs/CONTAINERS.md`, and `prefix`, `sessionSetting` and `sessionDefault` are documented nowhere. The schema declares all 18. No README was edited, because the main tree has uncommitted edits to every one of them.
- **Manifests disagree with the schemas:** `ahpd.options` (read by `ahpd plugin list`) lists `command` for tunnel-devtunnel, which its code never reads; omits `displayName`, `description`, `model` for agent-acp and `description`, `sessionDir` for agent-pi; lists 12 of computer's 18; and agent-cofold has no `ahpd.options`. Not changed here.
- **Cofold's apiKey:** the README says a key may be a function; the schema says `string`, so a function only works through a direct `apply` call, which the loader never makes from a configuration file.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean (8 packages, none undeclared); full `pnpm test` 117 files, 1691 tests passed. The first full run had one failure, `packages/sdk/test/changes-refresh.test.ts > re-reads a changeset when git is changed outside the host`, which passed 3 of 3 alone and on the second full run.
