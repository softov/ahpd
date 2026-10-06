---
title: The machine follows the host's branch
status: todo
depends: [task-04-ahpd-brings-the-work-back-by-fetch.md]
layer: "computer, sdk"
refs:
  - "[code://packages/sdk/src/changes.ts#L223-L345](../../../../packages/sdk/src/changes.ts#L223-L345) - commit, discard, revert, create a pull request and checkout move the host's branch or tree"
  - "[code://packages/sdk/src/host/spawn.ts#L626-L634](../../../../packages/sdk/src/host/spawn.ts#L626-L634) - the turn events"
---

## Objective

Before a turn starts, and after a changeset operation, a machine whose branch holds nothing the host has not fetched is set to the host's checked-out branch and commit, its index reset to it; a machine holding unfetched work is left as it is.

## Files

- `UPDATE: packages/sdk/src/types/computers.ts` - `follow?(id: string): Promise<void>`.
- `UPDATE: packages/computer/src/runtime.ts` - `follow`: read the host's `HEAD` and branch; in the machine, where its tip is the host's last fetched commit or an ancestor of the host's tip, `update-ref`, `symbolic-ref HEAD` for a branch the host switched to, and `reset -q`.
- `UPDATE: packages/sdk/src/host/spawn.ts` and `changesets.ts` - call `follow` on `chat/turnStarted` and after an operation.
- `UPDATE: packages/computer/test/computer-git-fetch.test.ts` - the cases below.

## Steps

1. Failing case first, real Docker: a commit made on the host between turns is not the machine's `HEAD` at the next turn.
2. `follow` reads the host with the hardened argv and writes only in the machine.
3. The objects need no copy: the alternates reach the host's.

## Validation

- `computer-git-fetch.test.ts`: a host commit is the machine's `HEAD` after `follow`; a host `checkout` of another branch moves the machine to it; a machine with an unfetched commit is left and the log says so.
- sdk test: `follow` on `turnStarted` and after `commit`.
- `npx vitest run packages/computer packages/sdk/test` passes.

## Resume
