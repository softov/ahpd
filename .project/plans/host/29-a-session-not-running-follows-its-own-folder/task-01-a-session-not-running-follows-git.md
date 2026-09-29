---
title: A watched changeset of a session not running follows git
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host.ts#L2744-L2845](../../../../packages/sdk/src/host.ts#L2744-L2845) - `inThere`, `watchedIn`, `refreshWatched`"
  - "[code://packages/sdk/test/changes-refresh.test.ts](../../../../packages/sdk/test/changes-refresh.test.ts) - the real-repository cases to sit beside"
---

## Objective

When a connection watches a changeset of a catalogued session that is not running, a move in that session's folder re-reads it and sends the changeset actions and the row's summary, as for a running session. The git watch opens and closes on the same rule.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the sessions the changeset path tells, and `watchedIn`.
- `UPDATE: packages/sdk/test/changes-refresh.test.ts` - the case below.

## Steps

1. Test first: a fake backend whose `sessions()` lists one session in a real repository with a staged file; a client subscribes to that session and its uncommitted changeset without creating it; `git commit` must send `changeset/cleared`. It fails on current code with nothing sent.
2. Fix; check each other caller of `inThere` keeps its meaning.

## Validation

- The case fails first and passes after; the watch closes when that client unsubscribes.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

Implemented 2026-09-29, in the `fixes-0-8-1` worktree.
`toldIn(dir)` in `packages/sdk/src/host.ts` is the running sessions in a directory (`inThere`) plus each catalogued session that is not running whose changeset a connection watches, under the name that connection watches it by. `watchedIn` and `refreshWatched` read it; `metaMoved`, `refreshPullRequests` and `readFacts` still read `inThere`, unchanged.
Failing first: `tells a client watching a stored session's changeset that a commit cleared it` timed out with no `changeset/cleared`, and `keeps a stored session's git watch while its changeset is watched, and closes it after` saw the fired watch close instead of re-reading. Both pass after, in `packages/sdk/test/changes-refresh.test.ts`.
