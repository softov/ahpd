---
title: A held test folder fails no job, and the cofold truncation case says how its turn ended - implemented
date: 2026-11-13
refs:
  - "[code://tools/test-tmpdir.ts](../../../../tools/test-tmpdir.ts) - the teardown"
  - "[code://packages/agent-cofold/test/agent-cofold-fork.test.ts](../../../../packages/agent-cofold/test/agent-cofold-fork.test.ts) - the case"
---

The global teardown no longer fails a job whose tests all passed when Windows holds the run's folder. The cofold truncation case says how its third turn ended when it fails.

## What was built

- [`code://tools/test-tmpdir.ts`](../../../../tools/test-tmpdir.ts) - 10 retries, 200 ms apart. `EBUSY`, `EPERM` and `ENOTEMPTY` give one warning line with the folder, and any other error throws.
- [`code://packages/agent-cofold/test/agent-cofold-fork.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-fork.test.ts) - the case asserts on `t3`'s end actions first.
- The cofold problem file has the runs of 2026-11-13, what a print of the turn actions showed, and why its first fix does not apply.

## Verified

- `npx vitest run packages/agent-cofold/test/agent-cofold-fork.test.ts`: 12 passed.
- The bot suite ran through the changed teardown, and the run's folder was gone after it.
- `pnpm typecheck` is clean.

## Departures from the plan

- None.

## Left for later

- The cause of the cofold case. Its problem file stays open.
