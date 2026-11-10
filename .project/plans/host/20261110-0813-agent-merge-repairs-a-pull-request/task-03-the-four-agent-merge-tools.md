---
title: The four Agent Merge tools
status: todo
depends:
  - task-02-the-watch-starts-a-repair-turn.md
layer: "sdk, docs"
refs:
  - "[code://packages/sdk/src/tools/artifacts.ts#L184](../../../../packages/sdk/src/tools/artifacts.ts#L184) - `artifactTools`, the pattern"
---

## Objective

ahpd serves `setAgentMergeEnabled`, `readAgentMergeCI`, `replyToAgentMergeReviewThread` and `rerunAgentMergeWorkflow`, under VS Code's names, text and restrictions.

## Files

- `CREATE: packages/sdk/src/tools/agentmerge.ts` - the tool group.
- `UPDATE: packages/sdk/test` - the cases of each tool.
- `UPDATE: docs/sdk/TOOLS.md` - the tools.

## Steps

1. Copy each schema and text from VS Code's `agentMergeServerTools.ts` at 171e90619.
2. Limit the last three to a turn that Agent Merge started, and to what that turn may touch.
3. Publish a review reply before you resolve its thread, and never submit or discard the person's pending review.
4. Ask for a deferred rerun only once.
5. Register the group beside `artifactTools`.

## Validation

- Each tool in a repair turn, and a refusal outside one.
- `pnpm typecheck`, then the sdk suite.

## Resume

