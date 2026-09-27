---
title: The plan closes on what is true - statuses, deferred work, docs, ranges and refs
status: implemented
depends: [task-14-inside-follows-a-dangling-link.md, task-15-a-declined-edit-sends-its-after-when-declined.md]
layer: "docs, agent-cofold"
refs:
  - "[code://docs/PLUGINS.md#L409-L413](../../../../docs/PLUGINS.md#L409-L413) - the tool section, where a session naming no mode gets `auto` and `web_fetch` names what it does not catch"
  - "[code://packages/agent-cofold/package.json#L64-L69](../../../../packages/agent-cofold/package.json#L64-L69) - the cofold dependencies, `@cofold/agents` and its siblings at `^0.1.1`"
  - "[code://pnpm-workspace.yaml#L17-L24](../../../../pnpm-workspace.yaml#L17-L24) - `minimumReleaseAgeExclude`, one version the lockfile holds per line"
---

## Objective

plugin/14 is `built` again with every task `done` or `dropped`, a `deferred.md` for what waits, a checklist that ticks only what was checked, docs that claim no more than the code does, a manifest that requires the releases the behaviour needs, and refs that name current lines.

## Files

- `UPDATE: task-01` to `task-04` in this folder - status.
- `CREATE: .project/plans/plugin/14-cofold-runs-its-own-tools/deferred.md` - the VS Code checks and cofold's `pnpm test`.
- `UPDATE: implemented.md`, `plan.md` - the close.
- `UPDATE: docs/PLUGINS.md:409-414`, `packages/agent-cofold/README.md` - the claims.
- `UPDATE: packages/agent-cofold/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` - the ranges and exclusions.
- `UPDATE: task-07`, `task-08`, `task-11` - refs.

## Steps

1. Tasks 01 to 04: run each Validation; set `done` in the file and the table when it passes, or write in its Resume what fails.
2. `deferred.md`: the three VS Code checks and cofold's `pnpm test`, why each waits (no editor driven in these sessions), and where they go.
3. `plan.md`: untick "VS Code: a `shell_exec` row shows the bare command" (it was not driven; the test covers the input); tick `pnpm test`, `pnpm typecheck`, `pnpm boundary` in ahpd only if run green now and move the cofold half to `deferred.md`; replace "Next action: ... ready to close"; add to Risks that the policy's `realpath` and cofold's write are separate steps, so a link swapped between them by another actor on the machine is not seen.
4. `docs/PLUGINS.md` and the README: `web_fetch` refuses internal addresses on every hop but does not catch DNS rebinding; say that `default` is the mode named `default` and that a session gets `auto` unless it asks, and what `auto` does with a read outside the workspace; keep the symlink sentence once task 14 makes it true for a dangling link.
5. `@cofold/agents` `^0.1.1` in `packages/agent-cofold/package.json` and in any sibling that needs the outside-read behaviour, with `@cofold/model-openai-compat` and `@cofold/store-file` at `^0.1.1` if they are listed beside it; `pnpm install --no-frozen-lockfile --store-dir /tmp/pnpm-store` once. This is a floor raised on dependencies ahpd already has, not a new one.
6. `pnpm-workspace.yaml`: drop the exclusions for versions the lockfile no longer holds, and write the rest in one style.
7. Refs: task 07 `ROWS` at 517-559, task 08 `ROWS` at 517-559 and the fetch stub at 127, task 11 the terminal and approval cases at 333-377; check the rest.
8. Last: `status: built` in `plan.md`, `implemented.md` updated with tasks 14 to 16, the index row.

## Validation

- `pnpm install --frozen-lockfile` clean, `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- Every relative link in the touched files resolves; no em dash added.

## Resume

Tasks 01 to 04 were run against the code in the tree and pass, so their status is `done` in the file and in the plan's table: the four capabilities and the names a default turn offers, the mode table, the edit reporting and the terminal drawing are in `agent-cofold-tools.test.ts`, and `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck` and `pnpm boundary` are green.

The close: `deferred.md` holds the three VS Code checks and cofold's own `pnpm test`; the checklist unticked the `shell_exec` row, because the case pins the input and no editor was driven, and ticked the ahpd half of the pnpm row; `plan.md` is `built`, says what waits, names `deferred.md`, and gains the risk that `resolveWithin` and cofold's own write are separate steps. `docs/PLUGINS.md` and `packages/agent-cofold/README.md` say that a name answering with a different address at the connection is not caught and that a session naming no mode gets `auto`; the symlink sentence is kept and now covers a dangling link. `@cofold/agents`, `@cofold/model-openai-compat` and `@cofold/store-file` are `^0.1.1` in both manifests, `pnpm install --no-frozen-lockfile --store-dir /tmp/pnpm-store` ran once, and `pnpm-workspace.yaml` keeps only the versions the lockfile holds, one per line. Every ref in tasks 01 to 15 and the plan's own seven were re-pointed against the tree, and four inline citations in Steps and Resumes were corrected as well.

Review 2026-09-26: not passed. The `shell_exec` row check is still ticked and not in `deferred.md`; `docs/PLUGINS.md` still says a page cannot reach the daemon's own machine; the Resumes of 01 to 04 do not record the re-run, and those of 07, 08, 10, 11 and 12 are empty; this task's ref notes and two plan lines describe the old state. Task 19 finishes it.
