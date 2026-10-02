---
title: Each Claude option is one declaration
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/claude.ts#L221-L263](../../../../packages/agent-claude/src/claude.ts#L221-L263) - `outputStyle`, `thinking` and `sandboxEnabled` in `schema()`"
  - "[code://packages/agent-claude/src/session.ts#L2092](../../../../packages/agent-claude/src/session.ts#L2092) - `sandboxOf`"
  - "[code://packages/agent-claude/src/session.ts#L2149-L2150](../../../../packages/agent-claude/src/session.ts#L2149-L2150) - `thinking`"
---

## Objective

`options.ts` declares `sandbox`, `thinking`, `outputStyle`, `env` and `extraArgs`, each with its JSON schema and how its value becomes `query()` options, and the existing session keys are made from these declarations with no change in behaviour.

## Files

- `CREATE: packages/agent-claude/src/options.ts` - the declarations and `presetSchema`.
- `UPDATE: packages/agent-claude/src/claude.ts:221-263` - the three keys come from the declarations.
- `UPDATE: packages/agent-claude/src/session.ts` - `sandboxOf`, the `thinking` mapping and the `outputStyle` flag setting go through the declarations.

## Steps

1. Tests first: each declaration's `toQuery` gives today's `query()` options for each value; `presetSchema` accepts a preset with the five fields and refuses an unknown one.
2. Move the three translations into the declarations; the existing agent-claude tests pass unchanged.

## Validation

- The new cases fail first and pass after; the existing suite passes unchanged.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

Done: `src/options.ts` declares `sandbox`, `thinking`, `outputStyle`, `env` and `extraArgs`, each with the schema one value is held to and where the value goes - `toQuery` for the options `query()` is built from, `toFlags` for the flag settings layer the one live option reaches. `claude.ts` builds `thinking`, `sandboxEnabled` and `outputStyle` from those schemas; `session.ts` builds one `values` bag out of the session's config keys and every `query()` option and the handshake's flag settings out of it.

Four things this task did not settle as written, and what was done instead:

- `presetSchema` is a check (`(value, by) => string | undefined`) rather than a JSON Schema. The daemon holds a plugin's options to `optionsSchema`, and that validator takes `additionalProperties` only as a yes or a no - never a shape - so a schema-valued `presets` would be published and not enforced. The declarations are walked by hand instead, which is what `plugin.ts` calls in task 02.
- `sandboxOf` stays in `session.ts` for the live `setConfig` branch. Routing that through a declaration would need a `toFlags` on the sandbox that nothing calls once task 03 removes the branch, and task 03 names no `options.ts`. The query path goes through the declaration now; the live one goes in task 03, with its helper.
- The new cases are in `test/agent-claude-declarations.test.ts`. The task named no file, and this is the module under test; task 02's file is about presets through a plugin and a session.
- `packages/sdk/test/fixtures/wire.jsonl` moved: `thinking` and `sandboxEnabled` now carry `type` and `enum` from the declaration spread before their own fields. Key order only, no value changed, and the fixture is written by the run that produces it.
