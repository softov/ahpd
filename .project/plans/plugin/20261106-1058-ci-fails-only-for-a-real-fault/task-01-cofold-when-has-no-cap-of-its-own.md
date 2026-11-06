---
title: The cofold when has no deadline of its own
status: todo
depends: []
layer: "tests"
refs:
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L36-L43](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L36-L43) - `when`, with its 5000 ms deadline"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L476-L525](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L476-L525) - the two edit cases that time out on Windows"
  - "[code://packages/agent-cofold/test/agent-cofold-tools.test.ts#L705-L734](../../../../packages/agent-cofold/test/agent-cofold-tools.test.ts#L705-L734) - the titling case that times out on Windows"
---

## Objective

The cofold tools cases wait for their event until the suite's limit for a case ends them: 20 s on Windows, 5 s elsewhere.

## Files

- `UPDATE: packages/agent-cofold/test/agent-cofold-tools.test.ts:36-43` - `when` loses its `ms` parameter and its deadline.

## Steps

1. Remove the `ms` parameter and the deadline from `when` in `agent-cofold-tools.test.ts`.
2. Keep the loop that turns the event loop with `setTimeout(r, 0)` until `check` holds.
3. Change the doc comment of `when` to say that the suite's `testTimeout` ends the wait.
4. Remove any second argument that a call of `when` passes.
5. Run the file alone 24 times, and record the failures.

## Validation

- `pnpm vitest run packages/agent-cofold/test/agent-cofold-tools.test.ts`, 24 times in a row: 0 failures.
- `pnpm typecheck` passes.
- The PR's `windows (1/3)` job passes with no rerun.

## Resume
