---
title: An agent keeps a pull request green until it merges
created: 2026-11-06
refs:
  - git://f48055f0 - the commit of ahpd the facts were checked at
  - "[code://packages/sdk/src/vscoderootconfig.ts#L378-L427](../../packages/sdk/src/vscoderootconfig.ts#L378-L427) - the seven `agentMerge.*` root config keys, advertised and read by nothing"
  - "[code://packages/sdk/src/sessions/changes.ts#L1246-L1263](../../packages/sdk/src/sessions/changes.ts#L1246-L1263) - `prepare-pull-request` answers `agentMergeAvailable: false`, and a create that asks for Agent Merge is refused"
  - "[code://packages/sdk/src/repo/github.ts#L34](../../packages/sdk/src/repo/github.ts#L34) - `githubPullRequests`, a branch's pull requests through a lent token or `gh`"
  - "[code://packages/sdk/src/host/merged.ts#L1-L19](../../packages/sdk/src/host/merged.ts#L1-L19) - the host archives and deletes sessions whose pull requests merged"
  - https://github.com/microsoft/vscode/blob/1.143.1/src/vs/platform/agentHost/node/shared/agentMergeServerTools.ts - VS Code's four Agent Merge tools, at 1.143.1
  - https://github.com/microsoft/vscode/blob/1.143.1/src/vs/platform/agentHost/common/agentMerge.ts - the configuration, the actions and the state
  - https://github.com/microsoft/vscode/blob/1.143.1/src/vs/platform/agentHost/node/agentMergeController.ts - the controller that watches a pull request and starts the turns
---

# An agent keeps a pull request green until it merges

Softov wants ahpd to serve VS Code's Agent Merge tools.
With Agent Merge on, the host watches a chat's pull request and starts a turn when the pull request needs work.
The turn fixes CI, answers reviews or resolves conflicts, and the pull request merges when it is ready, if the person allows it.
Softov also reviews the tools' text before it is copied.

## What others do

VS Code 1.143.1 has Agent Merge, with four tools in its own group:

| Tool | Does | Description | Inputs |
| --- | --- | --- | --- |
| `setAgentMergeEnabled` | Turn Agent Merge on or off for the chat's folder, and set its options | 1040 | 5, 529 |
| `readAgentMergeCI` | Read the failed required checks of the active Agent Merge turn | 974 | 10, 657 |
| `replyToAgentMergeReviewThread` | Reply to a review thread, and resolve it once the reply is published | 497 | 3, 202 |
| `rerunAgentMergeWorkflow` | Rerun the GitHub Actions workflow of a failed required check | 341 | 2, 83 |

- Agent Merge is on per folder within a session. Other folders do not change.
- Three repair actions start turns: `addressReviews`, `fixCI` and `resolveConflicts`.
- `mergePullRequest` is `always`, `ifUnchanged` or `never`, and `never` is the default. `ifUnchanged` becomes `never` as soon as a repair turn makes a commit.
- `mergeMethod` is `auto`, `squash`, `merge` or `rebase`.
- The last three tools act only in a turn that Agent Merge started, and only on what that turn may touch.
- A pending review reply stops the folder's monitoring when the turn ends, and the person turns it on again.
- The work is large: `agentMergeController.ts`, `agentMerge.ts`, `agentMergeServerTools.ts` and `agentMergeTools.ts` are about 200 KB together, and six other files take part.

## What ahpd has today

- The seven `agentMerge.*` root config keys are advertised, with VS Code's defaults, and nothing reads them.
- `prepare-pull-request` answers `agentMergeAvailable: false`. A create that asks for Agent Merge is refused: "Agent Merge is not available on this host."
- `githubPullRequests` reads a branch's pull requests, through a token a client lent or through `gh`. It reads no checks, jobs or review threads.
- The host archives a session whose pull requests merged, and deletes it later, by two other root config keys.
- No Agent Merge tool.

## The text of the tools

These are the longest texts of any VS Code host tool: 1040 and 974 characters, with 529 and 657 more in their inputs.
They carry limits the agent must keep: a CI read is capped at 48 KB, and a deferred rerun is not asked again.
`replyToAgentMergeReviewThread` tells the agent never to submit or discard the person's pending review.

## Who writes

- No branch on `origin` or `maycxc` ahead of `f48055f0` changes `packages/sdk/src/tools/`, `packages/sdk/src/repo/` or `packages/sdk/src/vscoderootconfig.ts` after 2026-11-02. `maycxc/union` has no commit ahead of main.
- Plan plugin/20261106-1058, CI fails only for a real fault, is `planned` and touches the CI of ahpd's own repository, not this code.

## The change

- ahpd serves the four Agent Merge tools, under VS Code's names.
- The host reads the seven `agentMerge.*` keys, and a session's folder can have Agent Merge on.
- The host watches the pull request of each such folder.
- A failed required check, a review thread or a conflict starts a repair turn.
- The host merges only as `mergePullRequest` allows, and the default stays `never`.
- `prepare-pull-request` answers `agentMergeAvailable: true` where Agent Merge can run.
- `docs/sdk/TOOLS.md` names the tools.

## Open points

- The size: one plan, or a plan for the watch and the repair turns, then one for the merge.
- What ahpd reads from GitHub: checks, jobs, logs and review threads. `githubPullRequests` reads none of them, and `gh` or the REST API with a lent token can.
- For ahpd's own repository, Softov merges by hand. Agent Merge with `mergePullRequest: never` fixes and answers, and leaves the merge to him.
- For the text review: keep VS Code's words, or write shorter text of ahpd's own. The limits in the texts stay either way.
