---
title: prepare-pull-request offers Agent Merge
status: implemented
depends:
  - task-03-the-four-agent-merge-tools.md
layer: "sdk"
refs:
  - "[code://packages/sdk/src/sessions/changes.ts#L1254-L1261](../../../../packages/sdk/src/sessions/changes.ts#L1254-L1261) - `agentMergeAvailable: false` and the refusal"
---

## Objective

`prepare-pull-request` answers `agentMergeAvailable: true` where the folder has a GitHub remote and a way to read it.
A create that asks for Agent Merge turns it on.

## Files

- `UPDATE: packages/sdk/src/sessions/changes.ts:1254-1261` - the answer and the create.
- `UPDATE: packages/sdk/test` - the cases.

## Steps

1. Answer `agentMergeAvailable: true` where task 01 can read the pull request.
2. Turn Agent Merge on for the folder when a create asks for it.
3. Keep the refusal, in its words, where it cannot run.

## Validation

- A folder with a GitHub remote offers it, and one without refuses it.
- `pnpm typecheck`, then the sdk suite.

## Resume

- **Done so far:** `prepare-pull-request` answers `agentMergeAvailable: true` where the GitHub port can also read a pull request (`ask.detail` is defined), and `agentMergeAvailable: false` where it cannot. A create that asks for Agent Merge adds `agentMerge: true` to what the operation answers, and the refusal `'Agent Merge is not available on this host.'` stays for a host whose port cannot read one. The source does not turn the watch on itself: `host/resourcemethods.ts` reads the flag after `recordPullRequest` and calls `ctx.agentMerge.enableFor(lead.chatUri, { branchName, pullRequestUrl })` with the operation's own branch and page, before `refreshFacts`, so a create that branched off the base arms the watch on the branch it opened rather than the one it left. `host/agentmerge.ts` factors `begin` out of `enable` and adds `enableFor`, which takes the caller's target and carries over a running watch's counters.
- **Next action:** none; the plan's four tasks are implemented and wait for review.
- **Open questions:** none for this task.
- **Watch out for:** `enableFor` keeps an existing watch's target if one is already running, as `enable` does, so a create in a folder already watching an older page does not re-point it. The watch's first read still compares the session's branch facts with its target and stops when they differ, so the facts refresh that follows the operation is what keeps a create's watch alive.

Files changed by this task: `packages/sdk/src/types/changes.ts`, `packages/sdk/src/sessions/changes.ts`, `packages/sdk/src/host/agentmerge.ts`, `packages/sdk/src/host/resourcemethods.ts`, `packages/sdk/test/pullrequest.test.ts`, `packages/sdk/test/agentmerge-watch.test.ts`, `docs/updates/v0_15.md`.

