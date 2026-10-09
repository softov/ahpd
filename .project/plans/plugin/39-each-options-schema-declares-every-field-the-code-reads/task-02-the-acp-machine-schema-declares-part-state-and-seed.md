---
title: The acp machine schema declares part, state and seed
status: todo
depends: []
layer: agent-acp
refs:
  - "[code://packages/agent-acp/src/plugin.ts#L77-L87](../../../../packages/agent-acp/src/plugin.ts#L77-L87) - the `machine` schema"
  - "[code://packages/agent-acp/src/plugin.ts#L209](../../../../packages/agent-acp/src/plugin.ts#L209) - `MACHINE_KEYS`"
---

## Objective

`presets.<id>.machine.properties` declares `part`, `state` and `seed` beside `env` and `copy`.

## Files

- `UPDATE: packages/agent-acp/src/plugin.ts:77-87` - add the three properties, each with a description and no type, and name them in the `machine` description.
- `UPDATE: packages/agent-acp/README.md` - correct a `presets.<id>.machine` row only where it disagrees with the description.
- `UPDATE: packages/agent-acp/test/agent-acp-catalog.test.ts` - the schema case.

## Steps

1. Read what `machineOf` does with `part`, `state` and `seed`.
2. Add one property for each to `machine.properties`, with a description from that reading.
3. Add the three names to the `machine` description beside `env` and `copy`.
4. Write a test that each entry of `MACHINE_KEYS` is a property of the `machine` schema.
5. Compare each new description with its README row, and correct the README where they differ.

## Validation

- `agent-acp-catalog.test.ts` holds the case above.
- `pnpm build`, `pnpm typecheck` and `npx vitest run packages/agent-acp` pass.

## Resume
