---
title: The listing looks up recorded sessions
status: done
depends: []
layer: sdk
refs:
  - "[code://packages/sdk/src/host/catalogue.ts#L812-L829](../../../../packages/sdk/src/host/catalogue.ts#L812-L829) - the nested block, the pattern to copy"
  - "[code://packages/sdk/src/host/history.ts#L275-L290](../../../../packages/sdk/src/host/history.ts#L275-L290) - `findOf`, the provider order and the folder for `find`"
  - "[code://packages/sdk/src/types/sessions.ts#L314](../../../../packages/sdk/src/types/sessions.ts#L314) - `nestedSessions`, the shape for a new list"
---

## Objective

`listing` adds a row for each recorded session in a folder that no answering backend read.
It finds the row with `agent.find(id, { workingDirectory })`, asking the recorded provider first.

## Files

- `UPDATE: packages/sdk/src/types/sessions.ts` - an optional store method that lists every recorded session id with its folder.
- `UPDATE: packages/sdk/src/sessions/sessions.ts` - the file store and its wrapper implement the new method.
- `UPDATE: packages/sdk/src/host/catalogue.ts` - the lookup block in `listing`, after the nested block.
- `UPDATE: packages/sdk/test` - the restart, refresh and worktree cases.

## Steps

1. Read how the file store keeps `workingDirectory` and `provider` for a session.
2. Add an optional `recordedFolders()` to the store type that returns each id with its folder.
3. Implement it in the file store and in the wrapper in `sessions.ts`.
4. In `listing`, collect each recorded id whose folder is not in `read`.
5. Skip an id in `claimed`, `offered` or `found`, and a nested id.
6. Ask the recorded provider's `find` first, then the other agents, as `findOf` does.
7. Run the lookups with `Promise.all`, and fold the answers in the order of the ids.
8. Pass each row that a lookup finds to `adopt`, and push it to `found`.
9. Ignore a lookup that throws or finds nothing.
10. Write the tests.
11. Set this task and the plan row to `implemented`.

## Validation

- A test: after a restart, a session recorded in a folder outside `paths` is in the first listing.
- A test: two refreshes keep the row and send no `root/sessionRemoved`.
- A test: the listing shows a session in a worktree folder in the same way.
- A test: a session already listed by a backend is not looked up.
- A test: a lookup that throws adds no row and leaves the record.
- `pnpm -s build`, `pnpm -s typecheck`, `pnpm -s boundary`, `node tools/schema.mjs` and the vitest gate pass.

## Resume

- **Done so far:** Built 2026-10-18.
  The store type has an optional `recordedFolders()` that lists each recorded session id with the folder it ran in.
  The memory store and the file store answer it.
  A session whose record names no folder is not one the method returns.
  `listing` asks each backend's `find` about every recorded session whose folder no answered backend read.
  The recorded provider is asked first, then the other agents, as `findOf` does.
  The lookups run at once with `Promise.all` and are folded in the order of the ids.
  A session this host runs, one a backend offered, one already in `found` and a nested one are not looked up.
  A lookup that throws or finds nothing adds no row, and the record stays.
  The review added two things that the listed rows already do.
  `recordedChats` reads each looked-up id first, so a chat's backend id is never listed as a session.
  A row whose recorded agent is not loaded keeps that provider and waits for it.
  Six tests are in `packages/sdk/test/host-catalogue-recorded.test.ts`: the restart, the two refreshes, the worktree, the listed session, the chat's backend id and the lookup that throws.
  The gates pass: build, typecheck, boundary, schema and the sdk suite at 3096 passed, 1 skipped.
- **Next action:** none.
  Task 01 is the plan's only task, and nothing is set to `done`.
- **Open questions:** none.
- **Watch out for:** Each pass makes one `find` per recorded session outside the paths, as the plan's risks say.
  `read` does not name a subfolder of a served path, but a backend lists that session, so it is skipped.
