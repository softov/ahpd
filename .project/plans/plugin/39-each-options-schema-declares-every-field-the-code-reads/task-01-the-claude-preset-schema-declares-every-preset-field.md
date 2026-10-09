---
title: The Claude preset schema declares every preset field
status: implemented
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/plugin.ts#L58-L82](../../../../packages/agent-claude/src/plugin.ts#L58-L82) - the `presets` schema"
  - "[code://packages/agent-claude/src/options.ts#L157](../../../../packages/agent-claude/src/options.ts#L157) - `DECLARED`, each with a `schema`"
---

## Objective

`presets.additionalProperties.properties` declares `sandbox`, `thinking`, `outputStyle` and `extraArgs` beside `name`, `models`, `keepCliModels` and `env`.

## Files

- `UPDATE: packages/agent-claude/src/plugin.ts:58-82` - add the four preset properties, each with a description and no type.
- `UPDATE: packages/agent-claude/src/options.ts` - export the descriptions if `plugin.ts` cannot read them from `DECLARED` now.
- `UPDATE: packages/agent-claude/README.md` - correct a `presets.<id>` row only where it disagrees with the description.
- `CREATE: packages/agent-claude/test/agent-claude-options-schema.test.ts` - the schema test.

## Steps

1. Read the `schema` of `sandbox`, `thinking`, `outputStyle` and `extraArgs` in `options.ts`.
2. Add one property for each to `presets.additionalProperties.properties`, with the declaration's `description` only.
3. Write a test that each key of `DECLARED` is a property of the preset schema.
4. Write a test: a load leaves out a preset with `thinking: 5` and registers the built-in.
5. Compare each new description with its README row, and correct the README where they differ.

## Validation

- `agent-claude-options-schema.test.ts` holds the two cases above.
- `pnpm build`, `pnpm typecheck` and `npx vitest run packages/agent-claude` pass.

## Resume

`presets.additionalProperties.properties` in `packages/agent-claude/src/plugin.ts` declares `sandbox`, `thinking`, `outputStyle` and `extraArgs`. Each property holds only a `description`, read from the `schema` of its declaration in `options.ts`, and a comment says that `presetSchema` types them. `options.ts` exports `DECLARED` for the test. `plugin.ts` imports the four declarations, which `options.ts` already exported.

`packages/agent-claude/test/agent-claude-options-schema.test.ts` holds the two cases. Each key of `DECLARED` is a property of the preset schema with a description. A load with `presets: { work: { thinking: 5 } }` skips `work` with the line `options.presets.work.thinking is not one of adaptive, disabled` and registers the built-in `claude`. The README rows agree with the four descriptions, so the README did not change.

Found: the daemon check does not read into a preset. A probe that gave `thinking` a `type: 'string'` still passed the second case. So the case proves that `optionsOf` drops the preset, and not that a typed property would fail the load. The `thinking` description does not name `adaptive` and `disabled`, because the property takes its text from the declaration as written.
