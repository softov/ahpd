---
title: create-pr records the opened or reused pull request and associates its URL with the branch
status: done
depends: [task-01-promote-and-answers.md]
layer: packages/sdk
refs:
  - code://packages/sdk/src/changes.ts#L560-L584 - the two returns of `create-pr`, which gain the pull request
  - code://packages/sdk/src/types/changes.ts#L205-L220 - `ChangesetOperationResult`, which gains `pullRequest`
  - code://packages/sdk/src/types/github.ts#L6-L11 - `PullRequest`, the port's answer, which gains an optional title
  - code://packages/sdk/src/github.ts#L38-L71 - `byApi` and `byGh`, which read the title from GitHub's answer
  - code://packages/sdk/src/host.ts#L5004-L5018 - the `invokeChangesetOperation` success path, where the record happens
  - code://packages/sdk/src/host.ts#L1964-L1994 - `githubFacts` and `metaOf`, where the association lands
  - code://packages/sdk/src/host.ts#L2002-L2007 - `setArtifacts`, the write the artifact uses
  - code://packages/sdk/src/host.ts#L2065-L2098 - `refreshPullRequests`, whose field names the association keeps
  - code://test/pullrequest.test.ts#L125-L167 - both `create-pr` cases
  - code://test/host.test.ts#L6143-L6327 - the GitHub and recorded-artifact suites
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostPullRequestOperationProvider.ts#L260-L276 - one finalize records the artifact and promotes the URL
---

## Objective

A pull request that `create-pr` opened or reused is recorded once as a `pullRequest` artifact with `isArtifact: true`, its URL is associated with the branch in `_meta.github`, and a value already held as a reference is promoted rather than duplicated.

## Files

- `UPDATE: packages/sdk/src/types/changes.ts:205-220` - add `pullRequest?: { url: string; title: string; branch: string }` to `ChangesetOperationResult`, commented as what the host records.
- `UPDATE: packages/sdk/src/types/github.ts:6-11` - `PullRequest` gains `title?: string`.
- `UPDATE: packages/sdk/src/github.ts:38-71` - `byApi` maps `item.title` and `byGh` asks for `title` in its `--json` list.
- `UPDATE: packages/sdk/src/changes.ts:560-584` - compute `said` before the reused check and add `pullRequest` to both returns.
- `UPDATE: packages/sdk/src/host.ts:5004-5018` - record `result.pullRequest` before `refreshFacts(at.dir)`.
- `UPDATE: packages/sdk/src/host.ts:1964-1994` - add `recordPullRequest(uri, dir, pullRequest)` beside `refreshPullRequests` and `metaOf`.
- `UPDATE: test/pullrequest.test.ts:125-167` - both cases assert the returned `pullRequest`.
- `UPDATE: test/host.test.ts:6143-6327` - one case invokes `create-pr` through the host and asserts the artifact and `_meta.github`.

## Steps

1. `ChangesetOperationResult.pullRequest` in `types/changes.ts`, with a comment that a changeset operation which produced something the session should hold says so here.
2. `PullRequest.title` in `types/github.ts`; `byApi` maps `typeof item.title === 'string' ? item.title : undefined` and `byGh` adds `title` to the `--json` list and maps it.
3. In `create-pr`, move `const said = await words(dir, subject, { branch, base: at.base })` above the `existing` check.
4. The reused return adds `pullRequest: { url: existing.url, title: existing.title ?? asked?.title ?? said.title, branch: head }`; the opened return adds `pullRequest: { url: opened.url, title: opened.title ?? asked?.title ?? said.title, branch: head }`.
5. In `invokeChangesetOperation`, immediately after `inFlight.delete(key)` and the idle `changeset/operationStatusChanged` dispatch, call `recordPullRequest(at.owner, at.dir, result.pullRequest)` when `result.pullRequest !== undefined`, before `refreshFacts(at.dir)`.
6. `recordPullRequest`: build `{ type: 'pullRequest', label: title, isArtifact: true, link: url, isGitHub: isGitHubLink(url) }`, call `recordArtifact(kept.artifacts(idOf(uri)) ?? [], input, () => crypto.randomUUID())`, and `setArtifacts(uri, recorded.held)` (task 01 and decision 2).
7. `recordPullRequest` then writes `githubFacts` for `dir`: the URL first, deduplicated against the URLs already there, `pullRequestBranchName: branch`, and any `pullRequestState` and `pullRequestStateUrl` kept when they name the same URL; then `metaMoved(dir)`.
8. Import `isGitHubLink` and `recordArtifact` from `artifacttools.js` in `host.ts`.

## Validation

- `test/pullrequest.test.ts`: the opened case asserts `said?.pullRequest` is the new URL, the form's title and the branch; the reused case asserts the existing URL, the branch, and the fallback title.
- `test/host.test.ts`: a host with the fake GitHub port and `gitChanges()` invokes `create-pr` through `invokeChangesetOperation` and asserts the last `session/metaChanged` holds one `agentHost/sessionArtifacts` entry of `type: pullRequest` with `isArtifact: true` and the URL, and that `_meta.github.pullRequestUrls` holds the URL first.
- Add a promotion case: a session that recorded the pull request URL as a reference first ends with one artifact under the reference's id, through the same `recordArtifact`.
- `pnpm vitest run test/pullrequest.test.ts` and `pnpm vitest run test/host.test.ts` green.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

