---
title: The watch starts a repair turn
status: todo
depends:
  - task-01-github-reads-checks-and-threads.md
layer: "sdk"
refs:
  - "[code://packages/sdk/src/vscoderootconfig.ts#L381-L432](../../../../packages/sdk/src/vscoderootconfig.ts#L381-L432) - the seven keys"
---

## Objective

For a folder with Agent Merge on, the host watches its pull request and starts a repair turn as VS Code's controller does.
It never merges.

## Files

- `CREATE: packages/sdk/src/host/agentmerge.ts` - each folder's state, the watch and the repair actions.
- `UPDATE: packages/sdk/src/vscoderootconfig.ts:381-432` - the keys are read.
- `UPDATE: packages/sdk/test` - the cases of the watch and each action.

## Steps

1. Keep each folder's Agent Merge state as VS Code's `agentMerge.ts` holds it, with the session.
2. Poll the pull request as VS Code's controller does, and stop when the session closes.
3. Start `fixCI`, `addressReviews` or `resolveConflicts` as a turn in the chat, as the keys allow.
4. Hold `mergePullRequest` at `never` in this plan.
5. Stop the folder's watch when a review reply waits at a turn's end.

## Validation

- A failed check, a new review thread and a conflict each start one turn.
- A key turned off starts none.
- `pnpm typecheck`, then the sdk suite.

## Resume

