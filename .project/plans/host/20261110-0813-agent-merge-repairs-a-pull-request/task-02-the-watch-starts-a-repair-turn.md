---
title: The watch starts a repair turn
status: implemented
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

- **Done so far:** `host/agentmerge.ts` is a host part, `ctx.agentMerge`, holding one watch per chat that turned Agent Merge on. `enable` reads the branch and pull request from the session's `_meta`, keeps the target and the folder's overrides, and arms a 60 s backstop. Each read asks `ctx.refreshPullRequests`, then `options.github.detail` through a lent token, and evaluates the pull request as VS Code's `agentMerge.ts` does: a failed or pending required check, unresolved review threads with a person's comments, changes-requested reviews and new conversation comments. `fixCI`, `addressReviews` and `resolveConflicts` start a turn through `ctx.beginWakeTurn` with VS Code's `<agent_merge_state>` prompt at 171e90619; the three action keys are read from `rootConfig` at each read, with the folder's overrides on top. A repeated unchanged prompt waits out ten minutes, the repeated, total and lifetime caps stop the watch, and a changed branch, a closed or merged pull request, or an unpublished review reply at a turn's end stops it. `mergePullRequest` is always `never`. The host calls `turnEnded` on every chat turn end, `forgetSession` from the lifecycle teardown, and `stop` when it closes.
- **Next action:** [task-03-the-four-agent-merge-tools.md](task-03-the-four-agent-merge-tools.md).
- **Open questions:** none for this task.
- **Watch out for:** the watch's state is in memory, so a restart stops watching; VS Code keeps it in the session's config. The first read of a folder happens at the end of the turn that turned Agent Merge on, since the tool call runs inside one. `agentMerge.enabled` is the client's switch and gates nothing here.

Files changed by this task: `packages/sdk/src/host/agentmerge.ts`, `packages/sdk/src/host/context.ts`, `packages/sdk/src/host.ts`, `packages/sdk/src/host/lifecycle.ts`, `packages/sdk/src/vscoderootconfig.ts`, `packages/sdk/test/agentmerge-watch.test.ts`, `docs/updates/v0_15.md`.
