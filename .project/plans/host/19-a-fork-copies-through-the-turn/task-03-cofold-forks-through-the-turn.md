---
title: cofold forks through the turn
status: todo
depends: [task-01-the-contract-says-a-fork-copies-through-the-turn.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/session.ts#L1167-L1168](../../../../packages/agent-cofold/src/session.ts#L1167-L1168) - `forkPoint` from `points.input`"
  - "[code://packages/agent-cofold/src/session.ts#L316-L324](../../../../packages/agent-cofold/src/session.ts#L316-L324) - `points`, the two ids kept per turn"
  - "[code://packages/agent-cofold/src/session.ts#L213-L220](../../../../packages/agent-cofold/src/session.ts#L213-L220) - the fork copies `throughMessageId: forkAt`"
  - "[code://test/agent-cofold-fork.test.ts#L144-L160](../../../../test/agent-cofold-fork.test.ts#L144-L160) - the fork case that expects the question without its answer"
---

## Objective

A cofold fork copies the source through the chosen turn's last message, so the fork holds that turn's answer.

## Files

- `UPDATE: packages/agent-cofold/src/session.ts:1167` - `forkPoint` answers `points.get(turnId)?.last`.
- `UPDATE: packages/agent-cofold/src/session.ts:316-324` - `input` goes from `points` and from where it is filled, if nothing else reads it; the comment says what a fork cuts at now.
- `UPDATE: test/agent-cofold-fork.test.ts` - the fork cases expect the chosen turn's answer in the fork, and the through-host case forks at the end.

## Steps

1. Point `forkPoint` at `last`.
2. Drop `input` when nothing else reads it.
3. Update the fork cases: a fork at `t2` holds questions one and two and both answers, and the source is still whole.

## Validation

- `test/agent-cofold-fork.test.ts` green with the new expectations.
- `pnpm test`, `pnpm typecheck` green.

## Resume
