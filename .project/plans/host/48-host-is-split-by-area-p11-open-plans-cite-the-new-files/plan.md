---
title: Open plans cite the new files
domain: host
status: built
priority: medium
created: 2026-10-03
revalidated: 2026-10-03
requires:
  - plans/host/48-host-is-split-by-area-p10-action-dispatch/plan.md
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - the file the refs below name today"
---

## Goal

Every plan not yet built that cites `code://packages/sdk/src/host.ts#L..` cites the file under `packages/sdk/src/host/` that holds that code now, at its current lines, so the plans after this one start from refs that resolve.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -l "code://packages/sdk/src/host.ts" .project/plans`, keeping folders whose `plan.md` is not `built` or `dropped` - at `1eb8c8f`: claude/09; container/02, 03, 04, 05, and 05's p2, p5, p7, p9, p10, p12; host/30, 31, 33, 43 p2, 43 p3, 43 p4, 44, 44 p2, 44 p3, 45, 46; plugin/20, plugin/29 and its p1, plugin/33; and host/47, written after this survey. About 200 refs.
- Many of these refs already point at old line numbers (host/30 cites `spelledFor` at 1484, which is at 1826 on `1eb8c8f`); each is found again by the symbol its note names, not by its number.
- The same search finds `code://packages/sdk/src/git.ts`, `github.ts` and `worktrees.ts` in container/05 p7 and p8, which p3 task 03 moved to `repo/`.

### Gaps

- Built plans, decisions, research and ideas keep their refs: a built plan records what was true when it was built, and a path is an identity.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Refs in open plans are rewritten; built plans, decisions, research and ideas are not | the request, 2026-10-03: "rewrites those refs in open (not built) plans" | 01 |
| A `UPDATE: packages/sdk/src/host.ts:<n>-<m>` line in an open task's *Files* is rewritten with its ref | (defaulted: it names the same code and would send the builder to the wrong file) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Every open plan's host.ts ref names the file that holds the code](task-01-rewrite-the-refs.md) | implemented | - |

## Resume state

- **Done so far:** built 2026-10-04 in `ca6adcb`; see [implemented.md](implemented.md).
- **Next action:** Softov's review, which moves the tasks from `implemented` to `done`.
- **Open questions:** none.

## Final verification checklist

- [x] `rg -n "code://packages/sdk/src/host.ts#L" .project/plans` matches only built or dropped plans, or code still in `host.ts`.
- [x] Every rewritten link's target exists.
- [ ] `plans/index.md` updated.
