---
title: The handles are counted on a running daemon
status: doing
depends:
  - task-01-one-handle-per-folder.md
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/README.md#L246](../../../../packages/agent-claude/README.md#L246) - the sentence on the watch, which gets one more"
---

## Objective

The daemon's handle count is measured before and after task 01, with several sessions open in one project, and the numbers are in `implemented.md`.

## Files

- `UPDATE: packages/agent-claude/README.md:246` - add one sentence after the one on the watch: "Sessions and presets that watch the same folder share one watch of it."
- `CREATE: .project/plans/claude/20261109-2012-a-claude-folder-is-watched-once/implemented.md` - what was built, the counts, and any departure.

## Steps

1. Start a dev daemon from `main` before task 01, with two Claude presets and no session.
   On Windows, read its handle count with `(Get-Process -Id <pid>).HandleCount`.
   On Linux, count its inotify watches with `grep -c inotify /proc/<pid>/fdinfo/*`.
2. Open three sessions in one project folder and read the count again.
3. Do steps 1 and 2 again on the branch with task 01.
4. With a session open, remove its project folder by hand on Windows, and write down whether the removal fails with `EBUSY`.
   This is a finding for `implemented.md`, not a change in this plan.
5. Write `implemented.md` with the four counts and the finding of step 4, and update the README sentence.

## Validation

- The count on the branch grows by less with each new session than on `main`.
- Softov checks the counts by hand.

## Resume

On 2026-11-09 the README sentence was added, and the watcher's own handles were counted, not yet a daemon's.
The count ran the real `watch.ts` under `scripts/dev.mjs` on Windows with Node 22, with `fs.watch` wrapped to count each handle opened and closed.
The tree was a personal scope and a project `.claude`, each with `agents`, `skills`, `commands`, `rules` and `plugins` of ten subfolders each.
Two probes watched the personal folder, and then three sessions the personal folder and one project:

| | `main` | task 01 |
| --- | --- | --- |
| 2 probes | 12 | 6 |
| 2 probes and 1 session | 25 | 13 |
| 2 probes and 2 sessions | 38 | 13 |
| 2 probes and 3 sessions | 51 | 13 |
| all closed | 0 | 0 |

Left: steps 1 to 4 on a running dev daemon, which Softov runs by hand, and `implemented.md` after them.

