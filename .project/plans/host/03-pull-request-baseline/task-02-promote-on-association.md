---
title: A pull request that becomes the session's is promoted out of the baseline
status: todo
depends: [task-01-baseline-at-session-start.md]
layer: packages/sdk
refs:
  - code://packages/sdk/src/host.ts#L1964-L1994 - `metaOf`, where the promoted baseline is composed onto `_meta.github`
  - code://packages/sdk/src/host.ts#L5004-L5018 - the `invokeChangesetOperation` success path where `recordPullRequest` runs
  - code://packages/sdk/src/types/sessions.ts#L27-L57 - the store methods the promotion writes with
  - code://test/host.test.ts#L6143-L6327 - the GitHub and recorded-artifact suites
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/state/sessionState.ts#L1726-L1729 - `getSessionPullRequestUrlKey`, the normalized comparison
  - file:///github/externals/vscode/src/vs/platform/agentHost/common/state/sessionState.ts#L1761-L1776 - `withMostRecentRelatedSessionPullRequest`, the promotion to copy
  - file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostPullRequestOperationProvider.ts#L276 - the reference promotes at the moment the pull request is recorded
  - plans/host/01-artifact-tools/task-02-pull-request-artifact.md - the `recordPullRequest` this task calls into
---

## Objective

When a pull request becomes the session's, its URL moves out of `initialPullRequestUrls` into `associatedPullRequestUrls` while `pullRequestUrls` keeps the whole set, so a client can tell the session's own pull request from one it inherited.

## Files

- `UPDATE: packages/sdk/src/host.ts:1964-1994` - add `promotePullRequest(uri, url)` beside `metaOf`.
- `UPDATE: packages/sdk/src/host.ts:5004-5018` - plan 01's `recordPullRequest` calls `promotePullRequest(uri, url)` after the artifact write and before `metaMoved(dir)`.
- `UPDATE: test/host.test.ts:6143-6327` - the promotion cases.

## Steps

1. `const urlKey = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();` in `host.ts`, the comparison the reference makes in `getSessionPullRequestUrlKey`.
2. `promotePullRequest(uri, url)`: read `kept.pullRequests(idOf(uri))`; build `associatedPullRequestUrls` as the URL first followed by the existing ones, deduplicated by `urlKey`; filter `initialPullRequestUrls` of any entry whose `urlKey` matches, keeping the original spelling of the rest.
3. When the slot does not exist, write `{ initialPullRequestUrls: [], associatedPullRequestUrls: [url] }`, which is what the reference's optional initial list comes to.
4. Call `promotePullRequest(at.owner, url)` from plan 01's `recordPullRequest`, after `setArtifacts` and before `metaMoved(dir)`, so one `_meta` move carries the artifact and the baseline (decision 1).
5. Leave `pullRequestUrls` alone here, because it is the directory's whole set and `refreshPullRequests` is its writer.

## Validation

- `test/host.test.ts`: with a baseline captured, invoke `create-pr` for a URL that is in `initialPullRequestUrls`, and assert the last `session/metaChanged` has it gone from `initialPullRequestUrls`, present first in `associatedPullRequestUrls`, and still present in `pullRequestUrls`; a second case for a URL that was not in the baseline asserts it is associated and the initial list is unchanged.
- The same case asserts the artifact and the baseline moved in one `session/metaChanged`, so a client never sees a promoted pull request and an unmoved baseline.
- `pnpm vitest run test/host.test.ts` green.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

