---
title: An agent reads and writes comments on a session's files
domain: host
status: planned
priority: medium
created: 2026-11-10
revalidated: 2026-11-10
requires: []
changes: []
creates: []
refs:
  - git://7d76d5895 - the commit of ahpd this plan was checked at
  - git://e388d12f5:.project/briefs/tools-comments.md - the brief this plan covers
  - "[code://packages/sdk/src/host/snapshots.ts#L413-L420](../../../../packages/sdk/src/host/snapshots.ts#L413-L420) - the `annotations` channel, served and held, with no tool that writes to it"
  - "[code://packages/sdk/src/host/gate.ts#L190-L191](../../../../packages/sdk/src/host/gate.ts#L190-L191) - each `annotations/*` action needs `session:review`"
  - "[code://packages/sdk/src/tools/artifacts.ts#L184](../../../../packages/sdk/src/tools/artifacts.ts#L184) - `artifactTools`, VS Code's sibling group that ahpd serves, the pattern for a tool group"
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/agentFeedbackServerTools.ts - VS Code's six comment tools at 171e90619
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/common/meta/vscode/agentFeedbackAnnotations.ts - the `vscode.agentFeedback` meta of a comment
  - https://github.com/microsoft/agent-host-protocol/tree/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-annotations - the annotations channel
---

## Goal

With VS Code's six comment tools, an agent reads the comments on a session's files, answers them and resolves them.
A comment made through ahpd shows in VS Code, and one made in VS Code reaches the agent.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `git grep -n addComment -- packages` - only the comment in `snapshots.ts` that says no backend advertises it.

### Runtime path

```
addComment / replyToComment / resolveComments / deleteComments -> annotations/* on <session>/annotations
listComments / viewUnreviewedComments -> the channel's annotations with vscode.agentFeedback meta -> the model
```

### Gaps

- ahpw and ahpc draw no annotations; a later ahpw plan draws them.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The tools come first, tested with VS Code; ahpw drawing comments is a later ahpw plan | Softov, 2026-11-10, chose "Tools first" | 01 |
| The six tools are served under VS Code's names and text | the brief; Softov, 2026-11-10, chose "VS Code's words" | 01, 02 |
| VS Code's main at 171e90619 is the reference | Softov, 2026-11-10, chose "VS Code's newer main" | 01, 02 |
| A pull request's review comments are not read from GitHub here; they go with Agent Merge | Softov, 2026-11-10, chose "Not in this plan" | - |
| `viewUnreviewedComments` asks the person first, and shows every waiting comment until a client can let the person pick | (defaulted: no client draws annotations yet) | 02 |
| A tool that writes needs `session:review`, as the actions do | the brief | 01 |

## Proposed architecture

- **Data flow** - the tools read and write the session's annotations channel through the host's own action path.
- **Event flow** - each write sends the `annotations/*` action every client of the session sees.
- **State flow** - the channel holds the comments, as it holds a client's today.
- **Layer responsibilities** - sdk: a new tool group beside `artifactTools`. docs: `TOOLS.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Five comment tools on the channel](task-01-five-comment-tools.md) | todo | - |
| [02 - viewUnreviewedComments asks first](task-02-view-unreviewed-comments.md) | todo | 01 |

## Risks and tradeoffs

- `listComments` keeps VS Code's rule that only `user` text is the person's instruction; a review's text is not.

## Resume state

- **Done so far:** planned 2026-11-10.
- **Next action:** [task-01-five-comment-tools.md](task-01-five-comment-tools.md).
- **Open questions:** none.
- **Watch out for:** an annotation with no `vscode.agentFeedback` meta is not a comment; the tools leave it alone.

## Final verification checklist

- [ ] An agent's `addComment` shows in VS Code on the file and range.
- [ ] A comment made in VS Code is in `listComments`, and a reply and a resolve reach VS Code.
- [ ] `viewUnreviewedComments` asks the person first.
- [ ] A caller without `session:review` cannot write a comment.
- [ ] `pnpm typecheck` and the sdk suite pass, and Windows CI is green.
