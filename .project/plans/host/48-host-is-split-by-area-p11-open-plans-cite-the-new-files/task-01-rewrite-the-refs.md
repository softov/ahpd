---
title: Every open plan's host.ts ref names the file that holds the code
status: todo
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
