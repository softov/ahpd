---
title: Open plans cite the new test files
status: todo
depends: [task-07-names-snapshots-and-github.md]
layer: "docs"
refs:
  - "[code://packages/sdk/test/host.test.ts](../../../../packages/sdk/test/host.test.ts) - the file the refs below name today, gone after task 07"
  - "[code://.project/plans/host/00-host.md](../../../../.project/plans/host/00-host.md) - its *Tests* section names `test/host.test.ts` as the main suite"
---

## Objective

Every plan not yet built that cites `code://packages/sdk/test/host.test.ts`, and each `UPDATE: packages/sdk/test/host.test.ts` line in its tasks, names the `host-<area>.test.ts` file that holds the cited block now, at its current lines, and `00-host.md` names the new files as the main suite.

## Files

- `UPDATE: .project/plans/` - the `plan.md` and task files of each open folder that cites `host.test.ts`; at `b4f1a4b` these are claude/10, container/05 p7, host/30, host/44, host/44 p3, host/45, host/47 p1, host/47 p3, host/49 and host/50.
- `UPDATE: .project/plans/host/00-host.md` - the `code://test/host.test.ts` line under *Tests* names `test/host-*.test.ts` and `test/support/host.ts`, in the section's own wording.

## Steps

1. Re-run `rg -l "packages/sdk/test/host.test.ts" .project/plans`, and keep the folders whose `plan.md` is not `built` or `dropped`, leaving out this plan.
2. For each ref, find the block it cites by the `describe` or test name its note gives, or by reading the cited lines at the commit the plan was written, then find that name with `rg -n "<name>" packages/sdk/test/host-*.test.ts`.
3. Rewrite the URI, the link text and the target together, keeping the note; a ref to the helpers at the top of `host.test.ts` points at `packages/sdk/test/support/host.ts` or `support/claude-sdk.ts`.
4. A task that would add a test to `host.test.ts` names the area file its test belongs in, by the table in this plan's *Proposed architecture*.
5. Set each touched plan's `revalidated` to the day.

## Validation

- `pnpm exec tsc --noEmit` passes.
- `pnpm boundary` passes.
- `pnpm exec vitest run packages/sdk` passes.
- `pnpm exec vitest list packages/sdk | wc -l` equals the count recorded before task 01 (1,316 at `b4f1a4b`); this task changes no code, so it is a check that nothing else moved.
- `rg -n "test/host\.test\.ts" .project/plans` matches only built or dropped plans and this plan's own folder.
- Every rewritten link's target exists.
- `git diff --stat .project/` touches only the folders from step 1 and `00-host.md`.

## Resume
