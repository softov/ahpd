---
title: Git and GitHub facts, pull requests and artifacts are one file
status: done
depends: [task-01-changesets.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L3056-L3518](../../../../packages/sdk/src/host.ts#L3056-L3518) - `githubFacts`, `metaOf`, `captureBaseline`, `urlKey`, `promotePullRequest`, `setArtifacts`, `describes`, `inThere`, `metaMoved`, `toldIn`, `watchedIn`, `dirOfFile`, `wroteThrough`, `refreshing`, `waiting`, `refreshWatched`, `dirWatchers`, `stopWatchingDir`, `startWatchingDir`, `stopUnwatched`, `refreshPullRequests`, `recordPullRequest`, `readFacts`, `refreshFacts`"
  - "[code://packages/sdk/src/host.ts#L2601-L2606](../../../../packages/sdk/src/host.ts#L2601-L2606) - the construction-time refresh of every browsable directory, which calls `refreshPullRequests` and stays where it is"
---

## Objective

`host/facts.ts` exports `createFacts(ctx: HostContext): Facts` with the declarations above, and the construction-time loop in `host.ts` calls `refreshPullRequests` through it, in the same place.

## Files

- `CREATE: packages/sdk/src/host/facts.ts` - the offered interface and the declarations above; the area's fields are added to `host/context.ts`.
- `UPDATE: packages/sdk/src/host.ts:3056-3518` - removed; the factory built before the loop at `:2601`, which moves no line.

## Steps

1. Move each declaration with its comment, unchanged but for indentation; `githubFacts`, `refreshing`, `waiting` and `dirWatchers` move into the factory.
2. The factory is built before the browsable-directory loop, so the loop runs at the same point of construction with the same calls.
3. `summaryMoved` (p6) and `lent` (p4) are read as `ctx.summaryMoved` and `ctx.lent` when called.

## Validation

- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` pass with no test changed.
- `wc -l packages/sdk/src/host.ts` recorded.

## Resume
