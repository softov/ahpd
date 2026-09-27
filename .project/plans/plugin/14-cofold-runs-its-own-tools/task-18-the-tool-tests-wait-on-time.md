---
title: The tool tests wait on time, not on a count of ticks, and the mode table is one case per row
status: todo
depends: [task-15-a-declined-edit-sends-its-after-when-declined.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L32-L37](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L32-L37) - `when`, which gives up silently after 800 zero-delay ticks"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L517-L570](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L517-L570) - `ROWS`, run inside one case that takes 3 to 5 seconds against vitest's 5"
---

## Objective

`agent-cofold-tools.test.ts` passes on a loaded machine: `when` waits up to a wall-clock budget and throws when it runs out, and each mode-table row is its own case.

## Files

- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:32-37` - `when`.
- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:517-570` - the table as `it.each`.

## Steps

1. `when(check, ms = 5000)` polls with `setTimeout(r, 0)` until `check()` or `ms` has passed, and then throws `Error('timed out waiting')`; every caller keeps its meaning.
2. The mode table runs each row as `it.each(ROWS)`, named after the row.
3. The declined-edit case asserts two `session/inputNeededSet` notifications arrived before it checks the `after`.

## Validation

- `node_modules/.bin/vitest run packages/agent-cofold` green five times in a row while another `pnpm test` runs beside it.
- With `when`'s check made never true, the case using it fails with `timed out waiting` rather than on a later assertion.

## Resume
