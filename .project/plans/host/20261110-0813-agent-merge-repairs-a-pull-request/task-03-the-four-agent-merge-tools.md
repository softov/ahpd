---
title: The four Agent Merge tools
status: implemented
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

- **Done so far:** `tools/agentmerge.ts` serves the four tools under VS Code's names, titles, descriptions, schemas and `deferLoading`, copied from `agentMergeServerTools.ts` at 171e90619, with `parseAgentMergeCIRequest` limiting each mode to its own fields. `tools/index.ts` registers the group beside `artifactTools`, and `host/tooling.ts` binds `at.agentMerge` to the calling chat and the sender of the turn. The accessor is `host/agentmerge.ts`'s: `setAgentMergeEnabled` turns the folder's watch on or off and answers the configuration, which always says `never` for merging; the other three throw outside a repair turn Agent Merge started, and inside one only accept the turn's failed checks, workflow runs and unresolved review threads. `readFailedCI` pages the failed jobs' logs, with a TTL of five minutes and a 48,000-character cap. `replyToReviewThread` publishes before it resolves, answers `pending` without writing when the person's draft review is open, and the watch stops at the turn's end. `rerunFailedWorkflow` defers while the attempt runs and is asked once. The GitHub writes are on the `PullRequests` port: `pendingReview`, `replyToReviewThread`, `resolveReviewThread` and `rerunWorkflow`, through the GraphQL API with a lent token or `gh api graphql`. `docs/sdk/TOOLS.md` names the group, its grants and its deferred loading.
- **Next action:** [task-04-prepare-pull-request-offers-it.md](task-04-prepare-pull-request-offers-it.md).
- **Open questions:** none for this task.
- **Watch out for:** `PullRequestReviewComment.state` is assumed to say `PENDING` for a comment in a draft review; a token without GraphQL access leaves the reply `indeterminate`, which also stops monitoring. The evidence id is the job id, so a second summary recomputes the job list. The tool-list assertions in `host-tools.test.ts` and `host-github.test.ts` name the four tools now. `packages/sdk/src/tools/agentmerge.ts` is new, and `git add` is denied here, so it is untracked and the commit does not carry it.

Files changed by this task: `packages/sdk/src/tools/agentmerge.ts` (new), `packages/sdk/src/tools/index.ts`, `packages/sdk/src/types/host.ts`, `packages/sdk/src/types/github.ts`, `packages/sdk/src/repo/github.ts`, `packages/sdk/src/host/agentmerge.ts`, `packages/sdk/src/host/tooling.ts`, `packages/sdk/test/agentmerge-watch.test.ts`, `packages/sdk/test/host-tools.test.ts`, `packages/sdk/test/host-github.test.ts`, `docs/sdk/TOOLS.md`, `docs/updates/v0_15.md`.
