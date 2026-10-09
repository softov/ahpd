---
title: Modes and effort are cofold's lists
status: todo
depends: [task-01-ahpd-takes-the-cofold-release.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L18-L26](../../../../packages/agent-cofold/src/agent.ts#L20-L26) - the cofold imports"
  - "[code://packages/agent-cofold/src/agent.ts#L130-L170](../../../../packages/agent-cofold/src/agent.ts#L130-L170) - `PERMISSION_MODES`, `PERMISSION_LABELS`, `PERMISSION_DESCRIPTIONS`, `EFFORT_LEVELS`, `effortOf`"
  - "[code://packages/agent-cofold/src/agent.ts#L370-L376](../../../../packages/agent-cofold/src/agent.ts#L370-L376) - `modelOf` forces `features: { reasoning: true }`"
  - "[code://packages/agent-cofold/src/agent.ts#L483-L498](../../../../packages/agent-cofold/src/agent.ts#L483-L498) - the schema enums built from the lists"
  - "[code://packages/agent-cofold/src/turnagent.ts#L88-L93](../../../../packages/agent-cofold/src/turnagent.ts#L88-L93) - `modeOf`"
  - "[code://packages/agent-cofold/test/agent-cofold-modes.test.ts#L109-L113](../../../../packages/agent-cofold/test/agent-cofold-modes.test.ts#L109-L113) - the effort case that expects the forced feature"
  - file:///github/cofold/.project/plans/agent/06-modes-and-effort-are-library-data/deferred.md - the ahpd row this task closes
---

## Objective

The mode list, the mode descriptions, the effort list and `effortOf` are cofold's.
ahpd keeps `PERMISSION_LABELS`, and asks the model for effort without a forced feature.

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts:18-26` - import `PERMISSION_MODES`, `PERMISSION_MODE_DESCRIPTIONS`, `EFFORT_LEVELS`, `effortOf` and `EffortLevel` from `@cofold/agents`.
- `UPDATE: packages/agent-cofold/src/agent.ts:130-170` - the local `PERMISSION_MODES`, `EFFORT_LEVELS` and `effortOf` go; `PERMISSION_DESCRIPTIONS` becomes `PERMISSION_MODES.map((mode) => PERMISSION_MODE_DESCRIPTIONS[mode])`; `PERMISSION_LABELS` stays.
- `UPDATE: packages/agent-cofold/src/agent.ts:370-376` - `modelOf` sends `params.reasoning` only.
- `UPDATE: packages/agent-cofold/src/turnagent.ts:88-93` - `modeOf` checks against cofold's `PERMISSION_MODES`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-modes.test.ts:109-113` - the effort case expects no `features` on the model options.
- `UPDATE: packages/agent-cofold/test/agent-cofold-modes.test.ts:169-171` - the description case reads cofold's text.

## Steps

1. Compare cofold's `PERMISSION_MODE_DESCRIPTIONS` text with ahpd's array, and note any line that differs.
2. Replace the local lists and `effortOf` with the cofold imports.
3. Build `PERMISSION_DESCRIPTIONS` from cofold's record, in `PERMISSION_MODES` order.
4. Remove `features: { reasoning: true }` from `modelOf`.
5. Point `modeOf` at the imported `PERMISSION_MODES`.
6. Update the two test cases.

## Validation

- `rg "const (PERMISSION_MODES|EFFORT_LEVELS)|function effortOf" packages/agent-cofold/src` finds nothing.
- The schema in the `agent.ts` enums lists the same modes and levels as before.
- `npx vitest run packages/agent-cofold/test/agent-cofold-modes.test.ts` passes.

## Resume

- The decision `permission-modes-live-in-the-harness` item 5 keeps its effect: model-openai-compat 0.2.0 turns reasoning on from the param.
