---
title: Each Claude option is one declaration
status: todo
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
