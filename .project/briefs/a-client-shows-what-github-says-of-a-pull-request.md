---
title: A client shows what GitHub says of a pull request
created: 2026-11-09
refs:
  - git://2c9bb2717 - the commit of ahpd the facts were checked at
  - "[code://packages/sdk/src/host/facts.ts#L178-L179](../../packages/sdk/src/host/facts.ts#L178-L179) - `_meta.github` and `_meta.githubData`, the GitHub facts of the session's folder"
  - "[code://packages/sdk/src/host/facts.ts#L598](../../packages/sdk/src/host/facts.ts#L598) - `refreshPullRequests`, which asks GitHub about the folder's branch"
  - "[code://packages/sdk/src/host/facts.ts#L614](../../packages/sdk/src/host/facts.ts#L614) - with `autoAttachPullRequests` off, GitHub is not asked; the lists are only trimmed"
  - "[code://packages/sdk/src/host/facts.ts#L650-L660](../../packages/sdk/src/host/facts.ts#L650-L660) - a known pull request's state is read again with `byUrl`, and only its state is kept"
  - "[code://packages/sdk/src/types/github.ts#L6-L15](../../packages/sdk/src/types/github.ts#L6-L15) - `PullRequest`: `url`, `state`, and an optional `title` and `createdAt`"
  - "[code://packages/sdk/src/types/github.ts#L44-L52](../../packages/sdk/src/types/github.ts#L44-L52) - the port's `forBranch` and `byUrl`"
  - "[code://packages/sdk/src/repo/github.ts#L53](../../packages/sdk/src/repo/github.ts#L53) - the REST list reads `html_url`, `state`, `merged_at`, `title`, `created_at`"
  - "[code://packages/sdk/src/repo/github.ts#L67-L68](../../packages/sdk/src/repo/github.ts#L67-L68) - `gh pr list` asks for `url,state,title,updatedAt,createdAt`"
  - "[code://packages/sdk/src/repo/github.ts#L97-L108](../../packages/sdk/src/repo/github.ts#L97-L108) - the REST read of one pull request, `pulls/<number>`"
  - "[code://packages/sdk/src/repo/github.ts#L119](../../packages/sdk/src/repo/github.ts#L119) - `gh pr view` asks for `url,state,title`"
  - "[code://packages/sdk/src/vscoderootconfig.ts#L256-L261](../../packages/sdk/src/vscoderootconfig.ts#L256-L261) - `autoAttachPullRequests`, on by default"
  - https://github.com/microsoft/vscode/blob/53dca6e68b336634d16ef109583c6078f31a87f6/src/vs/platform/agentHost/common/state/sessionState.ts#L1401-L1423 - `ISessionGitHubState`, what VS Code's host publishes: URLs, one state, the branch name
  - https://github.com/microsoft/vscode/blob/53dca6e68b336634d16ef109583c6078f31a87f6/src/vs/workbench/contrib/sessions/common/github/types.ts#L81-L97 - `IGitHubPullRequest`, what VS Code's window reads from GitHub itself
  - https://github.com/microsoft/vscode/blob/53dca6e68b336634d16ef109583c6078f31a87f6/src/vs/workbench/contrib/sessions/browser/chat/sessionArchiveNudge.ts#L424 - the window makes a pull request model with its own GitHub service
  - https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostPullRequestAssociationResolver.ts#L249-L258 - VS Code's restricted mode keeps the artifact and associated pull requests, with their status gone
---

# A client shows what GitHub says of a pull request

Softov wants a client to show a session's pull request as VS Code does: its state, author, description and date.
VS Code's window reads these from GitHub with the person's own account.
A client of ahpd has no GitHub account, and ahpd has one: a token a client lent, or `gh`.
So ahpd says what GitHub says, and a client draws it.
He asked on 2026-11-09, with a screenshot of VS Code's pull request card beside his client's.

## What others do

**VS Code's host** publishes `ISessionGitHubState` ([`sessionState.ts`](https://github.com/microsoft/vscode/blob/53dca6e68b336634d16ef109583c6078f31a87f6/src/vs/platform/agentHost/common/state/sessionState.ts#L1401-L1423)):

- `owner`, `repo`, `pullRequestUrls`, `initialPullRequestUrls`, `associatedPullRequestUrls`, `pullRequestBranchName`.
- `pullRequestState`, with the `pullRequestStateUrl` it is the state of. One state, of one URL.
- No title, author, description or date.

**VS Code's window** reads the rest from GitHub itself, with its own GitHub service ([`sessionArchiveNudge.ts`](https://github.com/microsoft/vscode/blob/53dca6e68b336634d16ef109583c6078f31a87f6/src/vs/workbench/contrib/sessions/browser/chat/sessionArchiveNudge.ts#L424)).
Its model, `IGitHubPullRequest`, holds `number`, `title`, `body`, `state`, `author`, `headRef`, `baseRef`, `isDraft`, `createdAt`, `updatedAt`, `mergedAt` and `closedAt` ([`types.ts`](https://github.com/microsoft/vscode/blob/53dca6e68b336634d16ef109583c6078f31a87f6/src/vs/workbench/contrib/sessions/common/github/types.ts#L81-L97)).
Its pull request card shows the repository, the date, the title and number, the state, the description, `base ← head` and the author.

With `autoAttachPullRequests` off, VS Code's host keeps the artifact and associated pull requests, with their status gone ([`agentHostPullRequestAssociationResolver.ts`](https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostPullRequestAssociationResolver.ts#L249-L258)).
The window still shows the state, because it reads it from GitHub itself.

## What ahpd has today

- `_meta.github` holds VS Code's fields and no more, beside the same facts by folder in `_meta.githubData` ([`code://packages/sdk/src/host/facts.ts`](../../packages/sdk/src/host/facts.ts#L178-L179)).
- `refreshPullRequests` asks GitHub about the folder's branch ([`code://packages/sdk/src/host/facts.ts`](../../packages/sdk/src/host/facts.ts#L598)).
- With `autoAttachPullRequests` off, it asks nothing and only trims the lists ([`code://packages/sdk/src/host/facts.ts`](../../packages/sdk/src/host/facts.ts#L614)). A recorded or associated pull request then has no state.
- With the setting on, a known pull request's state is read again with `byUrl`, and only the state is kept ([`code://packages/sdk/src/host/facts.ts`](../../packages/sdk/src/host/facts.ts#L650-L660)).
- The port's `PullRequest` has `url`, `state`, and an optional `title` and `createdAt` ([`code://packages/sdk/src/types/github.ts`](../../packages/sdk/src/types/github.ts#L6-L15)). Neither optional field reaches `_meta`.
- `githubPullRequests()` asks for no author, body or merge date:
  - The REST list reads `html_url`, `state`, `merged_at`, `title` and `created_at` ([`code://packages/sdk/src/repo/github.ts`](../../packages/sdk/src/repo/github.ts#L53)).
  - `gh pr list` asks for `url,state,title,updatedAt,createdAt` ([`code://packages/sdk/src/repo/github.ts`](../../packages/sdk/src/repo/github.ts#L67-L68)).
  - The REST read of one pull request reads `html_url`, `state`, `merged_at` and `title` ([`code://packages/sdk/src/repo/github.ts`](../../packages/sdk/src/repo/github.ts#L97-L108)).
  - `gh pr view` asks for `url,state,title` ([`code://packages/sdk/src/repo/github.ts`](../../packages/sdk/src/repo/github.ts#L119)).
- `autoAttachPullRequests` is on by default ([`code://packages/sdk/src/vscoderootconfig.ts`](../../packages/sdk/src/vscoderootconfig.ts#L256-L261)). Softov's dev daemon has it off.
- On that daemon, a session on `agents/dca00e70` records `ahpio/ahp-review#1` as an artifact and an associated pull request. Its `_meta.github` holds `owner`, `repo`, `initialPullRequestUrls: []` and `associatedPullRequestUrls: [pull/1]`, and no state. GitHub says #1 is merged.

## Who writes

- No branch of `origin` other than `main` changes `facts.ts`, `repo/github.ts` or `types/github.ts`.
- The one open pull request, #267, adds a plan and no code.

## The change

- ahpd reads each pull request a session recorded or associated by its URL, with `byUrl`, also with `autoAttachPullRequests` off. Reading a known pull request associates nothing new.
- It reads it when the folder's facts are read, as it reads the branch's pull request today.
- For each pull request it read, ahpd publishes what GitHub said:
  - the state, the title and the author's login;
  - the description, and the base and head branches;
  - when it was opened, merged and closed.
- `PullRequest` and both ways of `githubPullRequests()` carry these fields. The REST answer has them all; `gh` asks for them by name.
- VS Code's fields in `_meta.github` stay as they are.
- A read that fails keeps what was held, as today.

## Open points

- Where the details go. VS Code has no field for them, so the key is ahpd's own.
  It can be a map by URL beside `_meta.github`, under an `ahpd.` key, or a field of `_meta.github`.
- Whether reading a recorded pull request's state with `autoAttachPullRequests` off departs from VS Code's host on purpose. Its host drops the status, and its window reads it itself.
- How long a description may be in `_meta`, which every summary carries.
