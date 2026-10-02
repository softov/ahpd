---
title: The session store is a file per session, and it forgets what no longer exists
domain: host
status: built
priority: medium
created: 2026-09-30
revalidated: 2026-09-30
requires:
  - plans/host/31-a-sessions-config-outlives-a-restart/plan.md
decisions:
  - decisions/the-session-store-is-one-file-per-session.md
refs:
  - "[code://packages/sdk/src/sessions.ts#L27-L207](../../../../packages/sdk/src/sessions.ts#L27-L207) - `memorySessions` and `fileSessions`: load, coalesced save, temp and rename"
  - "[code://packages/sdk/src/types/sessions.ts#L41-L95](../../../../packages/sdk/src/types/sessions.ts#L41-L95) - `SessionStore`, with no list or prune"
  - "[code://packages/sdk/src/host.ts#L2936-L2950](../../../../packages/sdk/src/host.ts#L2936-L2950) - a GitHub answer writes a baseline for every session in the directory"
  - "[code://packages/sdk/src/host.ts#L7403-L7427](../../../../packages/sdk/src/host.ts#L7403-L7427) - `disposeChat`, which leaves the chat's title"
  - "[code://packages/sdk/src/host.ts#L4003-L4123](../../../../packages/sdk/src/host.ts#L4003-L4123) - `removeSession` and `kept.forget`"
  - "[code://packages/server/src/config.ts#L185](../../../../packages/server/src/config.ts#L185) - where `sessions.json` lives"
---

## Goal

The daemon's session records stop growing with every session ever seen: each session is its own small file, a change writes only that file, and records for sessions no backend lists any more are removed.

## Reconnaissance

The files read are the `refs` above.

### Searches performed

- `~/.config/ahpd/sessions.json` on 2026-09-30: 324 rows, 55,779 bytes; 234 with flags, 268 with a pull request baseline, 89 with nothing but one; median row 132 bytes.

### Gaps

- One file for every session, rewritten whole on each change.
- No pruning: a row goes only when its live session is disposed.
- A GitHub answer writes a baseline for every session in the directory, opened or not.
- A disposed chat's title stays.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [The session store is one file per session, and rows whose session is gone are pruned](../../../decisions/the-session-store-is-one-file-per-session.md) | 01, 02, 03 |

| What | Source | Task |
| --- | --- | --- |
| A pull request baseline is written only for a session that is live in this daemon, created, resumed or opened, not for every catalogue row | Softov, 2026-09-30, asked about the baseline-only rows: "Only when opened" | 04 |
| A disposed chat's title is removed from the store | (defaulted: the research found it left behind; nothing reads it after) | 04 |
| Pruning runs only after a listing that every backend answered, and only for a row that listing covered: a backend that answered owns it, and the directory it ran in is one that backend catalogues. A row whose directory or provider no listing named is kept | (defaulted: a failed listing must not erase records, and a listing speaks only for the directories it read) | 02 |
| All files are read at start, synchronously, as today | (defaulted: catalogue readers call `flags(id)` per row) | 01 |

## Proposed architecture

- **State flow** - `fileSessions(dir)` reads `dir/*.json` at start; each setter marks its id dirty and the coalesced save writes each dirty id's file; `forget` and `prune` unlink.
- **Layer responsibilities** - sdk: the store, the port, the prune call and the two host fixes · server: the path, `sessions/` instead of `sessions.json`, and the migration.
- **Source-of-truth files** - [`code://packages/sdk/src/sessions.ts`](../../../../packages/sdk/src/sessions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A file per session](task-01-a-file-per-session.md) | done | host/31 |
| [02 - Rows for gone sessions are pruned](task-02-rows-for-gone-sessions-are-pruned.md) | done | 01 |
| [03 - sessions.json migrates once](task-03-sessions-json-migrates-once.md) | done | 01 |
| [04 - No baseline for an unopened session, no title for a closed chat](task-04-no-baseline-or-title-left-behind.md) | done | - |

## Risks and tradeoffs

- One file per session is one inode each; a few thousand small files read at start is still fast.
- A crash loses at most the files not yet written in that tick, as today.

## Resume state

- **Done so far:** built 2026-10-02, see [implemented.md](implemented.md) and [deferred.md](deferred.md).

## Final verification checklist

- [x] A daemon started over today's `sessions.json` ends with `sessions/` holding one file per row and `sessions.json.migrated`.
- [x] Deleting a transcript outside ahpd and listing again removes its file.
- [x] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [x] `plans/index.md` updated.
