---
title: An agent reads and writes comments on a session's files
created: 2026-11-06
refs:
  - git://f48055f0 - the commit of ahpd the facts were checked at
  - "[code://packages/sdk/src/host/snapshots.ts#L367-L380](../../packages/sdk/src/host/snapshots.ts#L367-L380) - the `annotations` channel, served and held, with no tool that makes a mark"
  - "[code://packages/sdk/src/host/channels.ts#L31](../../packages/sdk/src/host/channels.ts#L31) - `MARKS`, the `/annotations` suffix of a session's channel"
  - "[code://packages/sdk/src/host/gate.ts#L187-L191](../../packages/sdk/src/host/gate.ts#L187-L191) - each `annotations/*` action needs `session:review`"
  - "[code://packages/sdk/src/tools/artifacts.ts#L184](../../packages/sdk/src/tools/artifacts.ts#L184) - `artifactTools`, a sibling tool group of VS Code's that ahpd already serves"
  - https://github.com/microsoft/vscode/blob/1.143.1/src/vs/platform/agentHost/node/shared/agentFeedbackServerTools.ts - VS Code's comment tools, at 1.143.1
  - https://github.com/microsoft/vscode/blob/1.143.1/src/vs/platform/agentHost/common/meta/vscode/agentFeedbackAnnotations.ts - the `vscode.agentFeedback` meta a comment carries
  - https://github.com/microsoft/agent-host-protocol/tree/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-annotations - the annotations channel of the protocol
---

# An agent reads and writes comments on a session's files

Softov wants ahpd to serve VS Code's comment tools.
With them, an agent reads the comments a person or a review left on a session's files, answers them and resolves them.
Softov also reviews the tools' text before it is copied.

## What others do

VS Code 1.143.1 serves six comment tools in its feedback group:

| Tool | Does | Description | Inputs |
| --- | --- | --- | --- |
| `addComment` | Add a comment to a file range | 30 | 7, 189 |
| `listComments` | List the session's comments; resolved ones only when asked | 477 | 1, 64 |
| `replyToComment` | Reply to a comment | 46 | 2, 48 |
| `deleteComments` | Delete comments | 33 | 1, 22 |
| `resolveComments` | Mark comments resolved or unresolved | 57 | 2, 90 |
| `viewUnreviewedComments` | Show the pull request or code review comments the person has not reviewed | 241 | 0 |

- Each comment is an annotation on the session's `annotations` channel. Its comment fields are in `_meta`, under `vscode.agentFeedback`.
- A comment has a `kind`: `user`, `codeReview` (an agent raised it) or `prReview` (from a pull request review). Its `state` is `created`, `accepted`, `submitted` or `resolved`.
- Each reply has an `author`: `user`, `agent`, `prReviewer` or `unknown`. `listComments` tells the model to treat only `user` text as the person's instructions.
- Only `viewUnreviewedComments` asks the person first, and only when a comment waits to be shown. The person may pick which comments the agent sees.
- An annotation with no `vscode.agentFeedback` meta is not a comment, and the tools leave it alone.
- Each tool is deferred: the model finds it by tool search, and its definition is not sent on every request.

## What ahpd has today

- ahpd serves each session's `<session>/annotations` channel. It holds what clients write, so every client of the session sees one client's mark.
- Nothing in ahpd makes a mark. The code's own comment says marks "arrive through the `addComment` server tool, which no backend here advertises".
- Each `annotations/*` action needs the `session:review` grant.
- ahpd serves VS Code's artifact tools, a sibling group, under the same names.
- Neither ahpw nor ahpc draws annotations.

## The text of the tools

Five of the six descriptions are short, 30 to 241 characters.
`listComments` is 477 characters, because it explains `kind`, `author` and that only `user` text is an instruction.
That rule is a safety rule: a review's text is not the person's word.

## Who writes

- No branch on `origin` or `maycxc` ahead of `f48055f0` changes `packages/sdk/src/tools/` or `packages/sdk/src/host/snapshots.ts` after 2026-11-02. `maycxc/union` has no commit ahead of main.
- Neither ahpw nor ahpc subscribes to the `annotations` channel at their current main.

## The change

- ahpd serves the six comment tools, under VS Code's names, on the session's `annotations` channel.
- A comment carries VS Code's `vscode.agentFeedback` meta, so VS Code draws a comment made through ahpd, and ahpd reads one made in VS Code.
- `viewUnreviewedComments` asks the person first, as VS Code's does.
- A tool that writes needs `session:review`, as the actions do.
- `docs/sdk/TOOLS.md` names the tools.

## Open points

- Where `prReview` comments come from. Not checked: the VS Code files read do not say which side reads them from GitHub. ahpd's `repo/github.ts` reads pull requests and no review comments.
- How the person picks the comments for `viewUnreviewedComments` in ahpw and ahpc, which draw no annotations yet.
- Whether the tools come in one plan with ahpw drawing the comments, or the tools first.
- For the text review: keep VS Code's words, or write shorter text of ahpd's own. `listComments` keeps its rule on `user` text either way.
