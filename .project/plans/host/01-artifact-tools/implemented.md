---
title: Artifact tools promote in place and record a pull request - implemented
date: 2026-09-20
refs:
  - code://packages/sdk/src/artifacttools.ts
  - code://packages/sdk/src/changes.ts
  - code://packages/sdk/src/host.ts
  - code://packages/sdk/src/github.ts
  - code://packages/sdk/src/types/changes.ts
  - code://packages/sdk/src/types/github.ts
  - code://test/artifacttools.test.ts
  - code://test/pullrequest.test.ts
  - code://test/host.test.ts
  - code://test/github.test.ts
---

A value a session already holds as a reference is now promoted to an artifact in place when the same value arrives as an artifact, under the id it already had, and the three artifact tools answer `<status>: <id>` the way the reference host does.
A `create-pr` invocation now reports the pull request it opened or found again, and the host records it as a `pullRequest` artifact and associates its URL with the branch under `_meta.github` before it asks GitHub about the branch.

## What was built

- `code://packages/sdk/src/artifacttools.ts` - holds `recordArtifact(held, one, mintId)`, the reference's `addOrPromoteArtifact`; the ADD run answers `Added artifact`, `Added reference`, `Promoted artifact` or `Already recorded` with the entry's id; the REMOVE run answers `Removed artifact: <id>` or `Removed reference: <id>`; the LIST run still describes its entries.
- `code://packages/sdk/src/types/changes.ts` - `ChangesetOperationResult` carries an optional `pullRequest: { url, title, branch }`, which is what an operation that produced something the session should hold says for itself.
- `code://packages/sdk/src/changes.ts` - `create-pr` computes the words before the reused check and returns the pull request on both the opened and the reused path.
- `code://packages/sdk/src/host.ts` - `recordPullRequest` records the artifact through the same `recordArtifact`, then writes the URL first into the directory's `pullRequestUrls` with `pullRequestBranchName`, keeping any state that names that URL, and calls `metaMoved`; `invokeChangesetOperation` calls it after the idle dispatch and before `refreshFacts`.
- `code://packages/sdk/src/types/github.ts` - `PullRequest` gains an optional `title`.
- `code://packages/sdk/src/github.ts` - `byApi` maps a string `title` and `byGh` asks for `title` in its `--json` list and maps it.

## Verified

- `test/artifacttools.test.ts` - 7 tests, including the new promotion case and the no-downgrade case.
- `test/pullrequest.test.ts` - 7 tests, both `create-pr` cases asserting the returned `pullRequest`.
- `test/host.test.ts` - 271 tests, including two new cases that drive `create-pr` through `invokeChangesetOperation` on a real repository and assert the artifact and `_meta.github`, and the promotion of a reference the session already held.
- `test/github.test.ts` - 4 tests, both ports asserting the title mapping and the `gh` argument list.
- `pnpm test` green: 33 files, 616 tests.
- `pnpm typecheck` and `pnpm boundary` green.

## Departures from the plan

- `test/github.test.ts` was adjusted even though the task did not name it: adding `title` to `byGh`'s `--json` list makes the old argument-list assertion stale, and both fake answers now carry a title so the mapping is asserted.
- `host.ts` imports `artifactsIn` beside `recordArtifact`, because the store answers the wire `Bag` shape and `recordArtifact` takes `Artifact`; the plan named only `recordArtifact` and `isGitHubLink`.
- The form's title fallback is written as `typeof asked?.title === 'string' ? asked.title : undefined`, because `asked` is a `Record<string, unknown>` and the plan's shorthand would not typecheck.

## Left for later

- Nothing; every step in both task files is done.
