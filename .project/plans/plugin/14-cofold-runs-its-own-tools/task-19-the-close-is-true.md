---
title: The close is true - checklist, docs, comments, Resumes and plan text
status: implemented
depends: [task-16-the-close-says-what-is-true.md, task-18-the-tool-tests-wait-on-time.md]
layer: "docs, agent-cofold"
refs:
  - "[code://docs/PLUGINS.md#L407-L439](../../../../docs/PLUGINS.md#L407-L439) - the tool section, one paragraph per line in a hard-wrapped file"
  - "[code://packages/agent-cofold/src/session.ts#L36-L49](../../../../packages/agent-cofold/src/session.ts#L36-L49) - `insideDirectory` and its comment on `resolveWithin`"
  - "[code://packages/agent-cofold/src/capabilities.ts#L94](../../../../packages/agent-cofold/src/capabilities.ts#L94) - the order the capabilities are built in"
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

- 2026-09-26: steps 1 to 5 done; step 6 is not, since task 17 waits for Softov's release of `@cofold/tools`, so the plan stays `active`.
- `plan.md`: the `shell_exec` row check is unticked and in `deferred.md`, the Risks line about waiting for the releases is gone and one names the `..`-after-a-symlink shape until task 17 lands, the checklist has an open item for it, and the "nearest existing ancestor" row says the `resolveWithin` row replaced it for ahpd's check. `deferred.md` names where each item goes.
- `docs/PLUGINS.md`: the tool section, the memory paragraph and the providers paragraph are one paragraph per line; "so a page cannot be used to reach the daemon's own machine" is gone, and the section says the machine's public address is not refused and names the dangling `dir/../name` shape that can still pass as inside. `packages/agent-cofold/README.md` says the same, one paragraph per line. Both re-read against `resolveWithin` in `@cofold/tools` 0.1.0 and its `isInternal` in `web.js`.
- `session.ts`: the comment on `insideDirectory` says `resolveWithin` is the resolver `@cofold/tools`' file tools resolve every path with and refuse nothing by, kept at four lines so no ref to a later line moves. `capabilities.ts:94` says the order files, shell, web, memory. Task 01's Resume no longer names another project.
- Resumes of tasks 01 to 04, 07, 08, 10, 11 and 12 record the re-run and what was verified; task 04 names `^0.1`; the ref notes of tasks 16, 17 and 19 and the `docs/PLUGINS.md` lines of task 10 name the current lines.
- Departure: joining the tool section's lines moves every later line of `docs/PLUGINS.md` up by four, so refs past line 439 in files another session holds uncommitted (`container/05...-p2.../task-04-docs.md` and `plan.md`, `plugin/18.../task-04-docs.md`, `acp/05-presets/plan.md`) now point four lines late; they were left for that session.
- Validation: every relative link in this folder, `docs/PLUGINS.md` and the README resolves; no em dash added; `pnpm typecheck` and `pnpm boundary` green; `pnpm test` has 1330 of 1333 passing, the three failures all in `packages/server/test/server-cli.test.ts`, which another session is changing in the same tree and this task does not touch.
