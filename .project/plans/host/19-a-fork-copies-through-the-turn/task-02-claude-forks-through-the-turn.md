---
title: Claude forks through the turn
status: done
depends: [task-01-the-contract-says-a-fork-copies-through-the-turn.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L2019-L2031](../../../../packages/agent-claude/src/session.ts#L2019-L2031) - `cuts` and `ends`"
  - "[code://packages/agent-claude/src/session.ts#L2480-L2485](../../../../packages/agent-claude/src/session.ts#L2480-L2485) - where `cuts` is filled"
  - "[code://packages/agent-claude/src/session.ts#L2705-L2706](../../../../packages/agent-claude/src/session.ts#L2705-L2706) - `forkPoint` and `endPoint`"
  - "[code://test/host.test.ts#L5459-L5480](../../../../test/host.test.ts#L5459-L5480) - the test that expects the prompt's id"
---

## Objective

A Claude fork resumes with `forkSession` at the chosen turn's last chain entry, so the new chat's agent has the answer the new chat shows.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:2705` - `forkPoint` answers from `ends`.
- `UPDATE: packages/agent-claude/src/session.ts:2019-2020, 2480-2485` - `cuts` goes, with its comment, if nothing else reads it.
- `UPDATE: test/host.test.ts:5459-5480` - the CLI also echoes an assistant frame for `t1`, and the fork expects `resumeSessionAt` to be that frame's id.

## Steps

1. Point `forkPoint` at `ends`.
2. Remove `cuts` and the code that fills it when nothing else reads them.
3. Update the test to send an assistant frame after the prompt and expect its id.

## Validation

- `test/host.test.ts`: the fork resumes at the assistant frame's id with `forkSession: true`.
- `pnpm test`, `pnpm typecheck` green.
