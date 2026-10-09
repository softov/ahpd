---
title: Each optionsSchema declares every field the code reads - implemented
date: 2026-10-09
refs:
  - git://1171c04
  - "[code://packages/agent-claude/src/plugin.ts](../../../../packages/agent-claude/src/plugin.ts)"
  - "[code://packages/agent-acp/src/plugin.ts](../../../../packages/agent-acp/src/plugin.ts)"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts)"
---

Three plugin schemas now declare every field the code reads. A client sees each field of a Claude preset, an acp `machine` block and a computer profile. Each new property has a description and no type. So a wrong value still costs only its own preset or setting, and a load that passed before still passes. The changes are not committed: the base is `1171c04` on `build/agents/p39`.

## What was built

- [`code://packages/agent-claude/src/plugin.ts`](../../../../packages/agent-claude/src/plugin.ts) - the preset properties `sandbox`, `thinking`, `outputStyle` and `extraArgs`, each with the description of its declaration.
- [`code://packages/agent-claude/src/options.ts`](../../../../packages/agent-claude/src/options.ts) - `DECLARED` is exported.
- [`code://packages/agent-acp/src/plugin.ts`](../../../../packages/agent-acp/src/plugin.ts) - the `machine` properties `part`, `state` and `seed`, and the `machine` description names all five fields. `MACHINE_KEYS` is exported.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - the 16 profile properties, each with its type in words and its default. `profilesOf` is exported.
- [`code://packages/agent-claude/test/agent-claude-options-schema.test.ts`](../../../../packages/agent-claude/test/agent-claude-options-schema.test.ts) - each key of `DECLARED` is a preset property, and a preset with `thinking: 5` is skipped while the built-in registers.
- [`code://packages/agent-acp/test/agent-acp-catalog.test.ts`](../../../../packages/agent-acp/test/agent-acp-catalog.test.ts) - each entry of `MACHINE_KEYS` is a `machine` property and is named in the `machine` description.
- [`code://packages/computer/test/computer-options-schema.test.ts`](../../../../packages/computer/test/computer-options-schema.test.ts) - each field that `profilesOf` keeps is a profile property, and a profile with `cpus: 2` loads and keeps no `cpus`.

## Verified

- `pnpm install && node tools/schema.mjs && pnpm build && pnpm typecheck && pnpm boundary` exits 0. `tools/schema.mjs` writes 508 definitions, and `pnpm boundary` finds no undeclared import.
- `npx vitest run packages/agent-claude packages/agent-acp packages/computer`: 64 files, 843 tests pass.
- `npx vitest run --maxWorkers=2 --testTimeout=10000`: 257 files, 4468 tests pass. The baseline is 255 files and 4463 tests. The difference is the 2 new files, and 5 new tests: 2 for Claude, 1 for acp and 2 for computer.
- A probe gave the Claude `thinking` property `type: 'string'`, and the `thinking: 5` case still passed. The daemon check does not read into a preset or a profile, so today a typed property there would not fail a load either.

## Departures from the plan

- Task 01, 02 and 03 - `DECLARED`, `MACHINE_KEYS` and `profilesOf` are exported so that each test reads the list the code uses. The plan named only the descriptions as a possible export.
- Task 03 step 4 - the load with `cpus: 2` goes through `loadPlugins`. The check that the profile keeps no `cpus` calls `profilesOf` directly, because the loaded plugin does not expose its profiles.
- Step 5 of each task - each new description agrees with its README row, so no README changed.

## Left for later

- The Claude `thinking` description does not name `adaptive` and `disabled`, because the preset property takes the text of its declaration as written.
- The computer profile `needs` property has no description.
