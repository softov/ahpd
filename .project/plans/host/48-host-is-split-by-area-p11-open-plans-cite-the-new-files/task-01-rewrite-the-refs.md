---
title: Every open plan's host.ts ref names the file that holds the code
status: implemented
depends: []
layer: "docs"
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - the entry, which keeps only what the parent's table says stays"
---

## Objective

Each `code://packages/sdk/src/host.ts#L<n>-L<m>` ref in an open plan, and each `UPDATE: packages/sdk/src/host.ts:<n>-<m>` in its tasks, names the file and lines that hold the cited code after p10.

## Files

- `UPDATE: .project/plans/` - the `plan.md` and task files of each open folder listed in this plan's *Searches performed*, the list re-run at the time.

## Steps

1. Re-run the search, and drop folders that have been built since.
2. For each ref, find its symbol (named in the ref's note) with `rg -n "<symbol>" packages/sdk/src/host packages/sdk/src/host.ts`, and rewrite the URI, the link text and the target together, keeping the note.
3. Leave a ref whose code stayed in `host.ts`, with its line numbers corrected.
4. Rewrite the `git.ts`, `github.ts` and `worktrees.ts` refs to `repo/`.
5. Set each touched plan's `revalidated` to the day.

## Validation

- The two checks in the plan's *Final verification checklist*.
- `git diff --stat .project/` touches only the folders listed.

## Resume

The search was re-run against the working tree, and since the plan was written host/47 and its p1 to p6, 49, 50 and 51 have been built, so they are dropped from the list. The `git.ts`, `github.ts` and `worktrees.ts` refs in container/05 p7 and p8 point at `repo/`, which p3 task 03 already made, and are left as they are.

32 open folders were rewritten, plus two this session found already needing the same fix and did by hand: plugin/20's `ownerFor` and plugin/33's `advertisedSchemes`. 143 built, 45 planned and 9 active folders were left alone, as were the 48 family's own refs, which describe the pre-split `host.ts` and are the record of what moved from where.

Each ref was found by the symbol its note names, never by its old line number. A ref whose code stayed in `host.ts` kept its file and had its numbers corrected: 12 such ranges, each read to confirm the cited lines still hold what the note says. The rest point at the file under `packages/sdk/src/host/` that holds the symbol now, at its current lines, with the URI, the link text and the target rewritten together and the note kept verbatim.

A ref whose note names a function while its line range sits inside that function's body, such as `createTerminal`'s `return {}`, keeps the range the note means: the note's symbol is the enclosing declaration, not the line. That is how the ranges in host/43 p2 task 01, host/44 p3 task 01, host/45, host/46 and host/47 p1 read.

`.project/plans/daemon/00-daemon.md` is a research note with no `plan.md`, cites `host.ts`, and is left alone: the plan's scope is plan and task files.
