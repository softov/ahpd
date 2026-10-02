---
title: The session store is a file per session, and it forgets what no longer exists - implemented
date: 2026-10-02
refs:
  - "[code://packages/sdk/src/sessions.ts](../../../../packages/sdk/src/sessions.ts)"
  - "[code://packages/sdk/src/types/sessions.ts](../../../../packages/sdk/src/types/sessions.ts)"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/server/src/config.ts](../../../../packages/server/src/config.ts)"
---

What the host keeps on top of a backend is one file per session under `sessions/`, a change writes only the sessions it touched, and a session whose transcript was deleted outside ahpd is forgotten at the next listing that could have seen it.

## What was built

- [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts) - `fileSessions({ dir })`: every `<id>.json` read at start, dirty ids written through a temporary file and a rename at `0600` in a `0700` folder, a file removed when its row empties; `prune(gone)` on both stores; `migrateSessions`, which splits `sessions.json` once and renames it `sessions.json.migrated`.
- [`code://packages/sdk/src/types/sessions.ts`](../../../../packages/sdk/src/types/sessions.ts) - `prune` on the port.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - a listing every backend answered prunes a stored row only when a backend that answered owns it and its directory is one that backend catalogues; a disposed chat's title is removed.
- [`code://packages/server/src/config.ts`](../../../../packages/server/src/config.ts) - `sessionsDir`; `run.ts` migrates then opens the folder.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 161 files and 2363 tests after the rebase onto main, `pnpm boundary` clean.
- `sessions.test.ts`: the file layout, modes and round trip; a session in a directory the listing read is pruned and one in a worktree it did not read is kept; a refused listing prunes nothing.
- `sessions-migrate.test.ts`: rows become files once, a second start does nothing, an unreadable file is left with a warning.
- A copy of the live `~/.config/ahpd/sessions.json` (365 rows) migrated with no problem: 365 files at `0600`, the old file kept as `.migrated`, and every sender and chat title read back the same.

## Departures from the plan

- The prune row in *Decisions locked in* was narrowed during review: a listing speaks only for the directories it read, because Claude lists only the configured `paths`.
- The baseline half of task 04 was already true; a test guards it.
- The migration lives in the sdk beside the file layout, and `run.ts` calls it.

## Left for later

- See [deferred.md](deferred.md).
