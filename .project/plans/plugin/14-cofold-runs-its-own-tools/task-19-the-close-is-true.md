---
title: The close is true - checklist, docs, comments, Resumes and plan text
status: todo
depends: [task-16-the-close-says-what-is-true.md, task-18-the-tool-tests-wait-on-time.md]
layer: "docs, agent-cofold"
refs:
  - "[code://docs/PLUGINS.md#L409-L417](../../../../docs/PLUGINS.md#L409-L417) - the tool section, one sentence per line in a hard-wrapped file"
  - "[code://packages/agent-cofold/src/session.ts#L38-L46](../../../../packages/agent-cofold/src/session.ts#L38-L46) - \"what this host calls outside is what cofold also refuses\""
  - "[code://packages/agent-cofold/src/capabilities.ts#L94](../../../../packages/agent-cofold/src/capabilities.ts#L94) - \"in papo's fixed order\""
---

## Objective

Everything task 16 said it closed is closed: the checklist ticks only what was checked, the docs claim no more than the code, no comment cites another project or overstates what cofold does, and each task's Resume records what was verified.

## Files

- `UPDATE: plan.md` - checklist, Risks, the decision row task 14 replaced, Resume state.
- `UPDATE: deferred.md` - the `shell_exec` row check, and where each item goes.
- `UPDATE: docs/PLUGINS.md:409-417`, `packages/agent-cofold/README.md` - the claims and the line style.
- `UPDATE: packages/agent-cofold/src/session.ts:38-46`, `packages/agent-cofold/src/capabilities.ts:94` - the comments.
- `UPDATE: task-01` to `task-04`, `task-07`, `task-08`, `task-10` to `task-12`, `task-16` - Resumes and ref notes.

## Steps

1. `plan.md`: untick "VS Code: a `shell_exec` row shows the bare command" and add it to `deferred.md`; drop the Risks line that says ahpd waits for the releases; mark the "nearest existing ancestor" row as replaced by the task 14 row.
2. `deferred.md`: name where each item goes (the VS Code checks to the next time a person drives a cofold session in VS Code, cofold's own `pnpm test` to cofold's release).
3. `docs/PLUGINS.md`: drop "so a page cannot be used to reach the daemon's own machine", since the machine's public address is not refused; the symlink sentence says a link that leaves the workspace asks, and names the `..`-after-a-symlink shape as waiting for task 17; the section is one paragraph per line, as task 10 step 2 and Softov's writing rule say, and the README the same.
4. `session.ts`: `resolveWithin` is the resolver cofold's own policies read; cofold's tools refuse nothing by it. `capabilities.ts`: the fixed order is this package's, with no other project named.
5. Resumes: tasks 01 to 04 record the re-run of their Validation (the second review re-ran them green on 2026-09-26); task 04's `@cofold/tools` range is `^0.1`; tasks 07, 08, 10, 11 and 12 record what was verified (the second review's mutation of each fix made its test fail); task 16's ref notes describe the state after it.
6. Close again only when task 17 has landed or is moved to `deferred.md`: `status: built`, `implemented.md` with tasks 14 to 19, the index row.

## Validation

- Each named sentence re-read against the code.
- Every relative link in the touched files resolves; no em dash added.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume
