---
title: A session row's diff stat is the session's own work, not the folder's
created: 2026-10-07
---

Raised by Softov on 2026-10-07, watching ahpapp's rows: the `+`/`-` counts are the uncommitted changes in the folder, not what the session did.

## Today

A row's `changes` is the folder's: `git status --porcelain` and `git diff --numstat HEAD`, new files counted in full ([`code://packages/sdk/src/changes.ts#L554-L648`](../../packages/sdk/src/changes.ts#L554-L648), `look`).
The catalogue reads it per folder through `summary(dir)` ([`code://packages/sdk/src/host/catalogue.ts#L175-L179`](../../packages/sdk/src/host/catalogue.ts#L175-L179), `changesOf`).
The protocol calls the field "file changes associated with this session" (`SessionSummary.changes`), so either reading fits it.

What that gives:

- Two sessions in one folder show the same counts.
- A commit takes the counts to zero, though the session did the work.
- An edit made by hand in a terminal counts as the session's.
- A build session in its own worktree that commits nothing is the one case where the folder's count is the session's.

The counts move only when the folder is read again: a turn that completes or is cancelled, a changeset operation, or a watched folder.
A failed turn does not read it again.

## What a session's own count could be

1. **The session scope.** ahpd already keeps every file a session touched, with the first `before` and the last `after` ([`code://packages/sdk/src/changes.ts#L468-L469`](../../packages/sdk/src/changes.ts#L468-L469), `across`). The row sums that changeset's diff. It survives a commit and ignores other sessions and hand edits. It knows only what the agent's tools wrote, so a file changed by a shell command the agent ran is not counted. It is held in memory, so a restart loses it unless it is stored.
2. **The branch since the session began.** The host records the commit the session started on, and the count is `git diff --numstat <start>` plus untracked files. It keeps committed work, and it counts a shell command's edits. Two sessions on one branch still share it, and a rebase moves the start.
3. **Both, side by side.** The row keeps the folder's count, and `_meta` carries the session's. A client chooses which to draw. This answers every case and costs a second number in every row.

## Open

- Which one ahpapp and ahpc draw, if both are sent.
- Whether a stored session scope is worth what it costs in the session file.
- Whether a failed turn should read the folder again, as a completed one does.
