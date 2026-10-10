---
title: Open plans cite the new test files
status: done
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

Built 2026-10-04.

Each ref, `UPDATE:` line, validation line and `pnpm exec vitest run` line that named `host.test.ts` now names the area file that holds the block, at its current lines. The folders rewritten: claude/10, container/05 p7, host/30, host/44 p3, host/44, host/45, host/47 p1, host/47 p3, host/49, host/50, plus `host/00-host.md`.

Three folders the grep in step 1 missed, because they write the bare `host.test.ts` and not the full path, were rewritten too: host/31 (three `## Resume` lines naming `a session's config across a restart`, now `host-sessionconfig.test.ts`), host/48 (a search record naming `host.test.ts:3739` and `:3806`, the two filesystem cases now at `host-files.test.ts:120` and `:172`) and host/43 task-02 (a `*.test.ts` glob line, now naming the area files). All three plans are `active` or `planned`.

`claude/00-claude.md`, `daemon/00-daemon.md` and `plugin/00-plugin.md` also wrote `code://test/host.test.ts`; they are overview files like `00-host.md` and would have been left naming a file that no longer exists, so they were given the `code://test/host-*.test.ts` spelling as well. None of the three carries a `revalidated` field, so no date moved; host/48's did, to 2026-10-04.

Which area file a task that adds a test now names, where the plan's table does not say outright:

| Case | File | Why |
| --- | --- | --- |
| host/47 p1 tasks 02-04, chat reorder, move and `movable` | `host-chats.test.ts`, `more than one chat in a session` | the table gives that file the areas `chatactions.ts` and `sessionmethods.ts`, which is where all three actions land |
| host/49 task-03, a session's client plugins | `host-tools.test.ts`, `the MCP servers a session is offered` | that block already holds the case where a server set is read at session start, which is what this case checks |
| host/50 tasks 01 and 03, `createChat`'s backend id and a restart rebuilding every chat | `host-chats.test.ts`, `more than one chat in a session` | same reasoning as host/47 p1 |

Every remaining `host.test.ts` in `.project/plans` is in a folder whose `plan.md` reads `built` or `dropped`, in this plan's own folder, or in `plans/index.md`, which the build was told not to edit.

Gates: `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` pass (198 files, 2,839 tests). `pnpm exec vitest list packages/sdk | wc -l` is 1,334 and the sorted name list still fingerprints to `532860aa4c087b69e30d8a47dcead5f4`, the value taken before task 01.
