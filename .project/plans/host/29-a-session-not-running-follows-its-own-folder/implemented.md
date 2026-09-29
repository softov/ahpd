---
title: "A session that is not running shows its own folder, and its changes follow git - implemented"
date: 2026-09-29
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `toldIn`, and the transcript snapshot's `workingDirectories`"
---

A session served from its transcript, with no agent running, names the folder it ran in, and a client watching its changeset is told when git moves there, as for a running session.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `toldIn(dir)`: the running sessions in a folder plus each catalogued session not running whose changeset a connection watches, read by `watchedIn` and `refreshWatched`; `inThere` keeps its meaning for its other callers. The transcript snapshot reads `wheres` under `nameOf(id)`.

## Verified

- [`code://packages/sdk/test/changes-refresh.test.ts`](../../../../packages/sdk/test/changes-refresh.test.ts) - a stored session's commit clears its watched changeset, and its watch stays open while watched and closes after; both failed first.
- [`code://packages/sdk/test/host.test.ts`](../../../../packages/sdk/test/host.test.ts) - the snapshot names the row's folder; it failed first with the host's.
- Softov on 2026-09-29, in ahpapp against the source daemon: a commit, a stage and an unstage made in the IDE show without a reload, on a Claude session in `/github/s2cmd` that was not running.
- `pnpm typecheck`, `pnpm boundary` clean; full `pnpm test` 1726 of 1726 three times, each exit 0.

## Departures from the plan

- none.

## Left for later

- `dirOfFile`, which a write through the host uses, still looks only at running sessions; a write into a not-running session's folder is picked up by the git watch instead.
