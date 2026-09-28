---
title: The tool tests wait on time, not on a count of ticks, and the mode table is one case per row
status: done
depends: [task-15-a-declined-edit-sends-its-after-when-declined.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L31-L41](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L31-L41) - `when`, the wait every case uses, and the file's case timeout above its budget"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L552-L602](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L552-L602) - `ROWS`, the mode table, one case per row"
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

- 2026-09-26: `when(check, ms = 5000)` polls with `setTimeout(r, 0)` until `check()` holds and throws `Error('timed out waiting')` once `ms` of wall-clock time has passed. The mode table is `it.each` over `ROWS`, one case per row named after it, each running the six modes. The declined-edit case asserts two `session/inputNeededSet` notifications before it reads the `after`.
- Departure: the file sets `vi.setConfig({ testTimeout: 30_000 })`, since with vitest's default of 5 seconds a case would time out at the same moment as `when` and fail on vitest's message instead of `timed out waiting`.
- Seen first: with the declined-edit case's check changed to `length >= 99`, the old `when` gave up after its 800 ticks and the case passed. With the new `when` the same change fails the case with `timed out waiting` after 5 seconds; the change was reverted.
- `node_modules/.bin/vitest run packages/agent-cofold` green five times in a row (11 files, 107 tests) while a full `pnpm test` ran beside it; in that run the agent-cofold files passed too, and its only failures were three cases in `packages/server/test/server-cli.test.ts`, which another session is changing.
