---
title: The daemon log rotates at start
domain: daemon
status: planned
priority: low
created: 2026-09-30
revalidated: 2026-09-30
requires: []
refs:
  - "[code://packages/server/src/daemon.ts#L142](../../../../packages/server/src/daemon.ts#L142) - `daemon.log` opened for append on every start"
  - "[code://packages/server/src/config.ts#L165](../../../../packages/server/src/config.ts#L165) - `daemonLog()`"
---

## Goal

`daemon.log` never grows without bound: a start that finds it over 5 MB moves it to `daemon.log.1`, replacing the previous one, and starts a new log.

## Reconnaissance

The files read are the `refs` above.

### Gaps

- The log is appended on every start and never rotated or truncated.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Rotation at start, one previous file kept, over 5 MB | Softov, 2026-09-30, asked about `daemon.log`: "Rotate at start"; (defaulted: the size and one kept file) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The log rotates at start](task-01-the-log-rotates-at-start.md) | todo | - |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-log-rotates-at-start.md](task-01-the-log-rotates-at-start.md).
- **Open questions:** none.
- **Watch out for:** `start` polls the log for the `ws://` line; rotate before the child opens it.

## Final verification checklist

- [ ] A 6 MB `daemon.log` becomes `daemon.log.1` at the next `ahpd start`, and the new log has the start line.
- [ ] `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- [ ] `plans/index.md` updated.
