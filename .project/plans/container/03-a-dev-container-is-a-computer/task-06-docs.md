---
title: Docs and the domain text
status: implemented
depends: [task-03-the-form-offers-a-folder.md, task-08-only-allowed-folders-and-an-off-switch-for-every-route.md, task-18-every-command-reaches-it-by-docker-exec.md]
layer: "docs"
refs:
  - "[code://docs/CONTAINERS.md](../../../../docs/CONTAINERS.md) - the dev container page"
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - the computer page and its folder recipe"
  - "[code://.project/plans/container/00-container.md](../00-container.md) - the domain text"
---

## Objective

`docs/CONTAINERS.md` and `docs/COMPUTER.md` describe one computer with two recipes, a dev container reached by `docker exec` with the user and environment its definition sets, the form's folder source, and an off switch that covers every route.

## Files

- `UPDATE: docs/CONTAINERS.md:13`, `:17`, `:140` - `devcontainer exec` becomes `docker exec` with the user, folder and environment from the `devcontainer.metadata` label and the probe; `:17` says the folder label is how a listing and the picker know a folder's computer, not how it is reached.
- `UPDATE: docs/CONTAINERS.md:46`, `:61`, `:130`, `:136` - the needs as task 09 delivers them, the CLI as the program for `up` only, the id labels on `up` only, and the nested host started by `docker exec`.
- `UPDATE: docs/CONTAINERS.md:55` - the option switches every route off, which task 08 makes true.
- `UPDATE: docs/COMPUTER.md:63`, `:66-73`, `:124-125` - the decision link points at `a-dev-container-is-reached-by-docker-exec`; the exec block shows the `docker exec` line; the backend table says `docker exec` for both kinds of machine.
- `UPDATE: docs/COMPUTER.md:66` - the form offers the folder as a source, once task 03 lands.
- `UPDATE: .project/plans/container/00-container.md` - the known gap about `devcontainer exec` goes, and the form's source and the allowlist are added where it describes the recipes.

## Steps

1. Say that the probed environment is what the user's login shell set when the container was made, so a dotfile changed afterwards is seen only when the container is made again.
2. Say that a container made by hand without the labels is not listed until it is adopted by its folder (task 15).
3. Correct only what is wrong; `docs/CONTAINERS.md` keeps its own wrapping and is not reflowed.

## Validation

- `rg -n "devcontainer exec" docs .project/plans/container/00-container.md` finds nothing.
- Read through; no em dash, no hard wrap in a line this task writes, every link resolves.

## Resume

Implemented 2026-09-26.
`docs/CONTAINERS.md` now says one computer with two recipes, the `devcontainer` create body, the `devcontainer://<folder>` picker row, the `devcontainer exec` reach, and that destroying the computer removes the container and never the folder or its `devcontainer.json`; it says a container made by hand without the labels is not listed, and it is written one sentence per line.
`docs/COMPUTER.md` adds the folder recipe, the picker row and the `--mount`/`--remote-env` delivery, and notes that a `devcontainer` body is not gated by `bodyMounts` and is not covered by the image allowlist.
`.project/plans/container/00-container.md`'s "two mechanisms, kept apart" is replaced by "one computer, two recipes", and its stale "no dev container surface" is corrected.
Task 03 is blocked, so both docs say the create form does not offer the source and a body written by hand is the route.

Reopened on 2026-09-26 by the review. What the first version wrote that is now wrong: the form does not offer a folder (task 03 changes that); `docs/CONTAINERS.md:55` says the option "can switch the whole thing off", which task 08 makes true of every route; `00-container.md:23` says the CLI is not installed, and `/usr/local/bin/devcontainer` 0.89.0 is.
The first version reflowed `docs/CONTAINERS.md` from its 80-column wrap to one sentence per line; Softov's rule is not to reformat text he wrote, so this pass corrects only what is wrong and reflows nothing further.

Reopened again on 2026-10-03 and left until task 18 was in. Two of its three dependencies existed by then - tasks 03 and 08 landed that day - and most of this task's edits are about the `docker exec` reach task 18 builds, so the pass waited for that reach rather than being half-written against one that was not there yet.

What that left for the pass after task 18:

- `docs/CONTAINERS.md:42` and `:178`, `docs/COMPUTER.md` and `00-container.md` still say the create form does not offer the source, which task 03 made untrue. `docs/CONTAINERS.md:33` still shows `{"devcontainer": {"folder": "/path"}}` as the only form a body may take; a form now sends `{"source": "devcontainer", "devcontainer": "/path", "image": "<default>"}`, and the object form still works.
- `docs/CONTAINERS.md:55` says the option "can switch the whole thing off", which task 08 made true of every route; it still has to say that `devcontainer: false` turns off the create body, the session-time create, the picker row and the relay's `connect`, not only the launcher, and that `devcontainer.folders` is a list of absolute folders compared resolved, with no list meaning any folder. The README's options table has no row for `folders`; `computer-options.test.ts` only checks that the README lists what the schema declares, not the reverse, so nothing fails until the README is written.
- Everything this task says about `docker exec` waits on task 18.

Closed on 2026-10-03, with tasks 03, 08 and 18 all in.

Files changed:

- `docs/CONTAINERS.md` - the recipe table says `docker exec`; the two labels are described as what the picker reads and what the derivation reads, not as what decides how a machine is reached; a hand-made container is described as adopted by its folder rather than unreachable; the create body is the form's flat `source` choice, with the object form still named as working; a session-time create's needs are described as they are delivered, a read-only need through the override config's `mounts` and an environment need as `containerEnv` in it; the `devcontainer` option says `false` switches all four routes off and names `folders` as the resolved allowlist; the option says the CLI is run for `up` only; `install` no longer says it skips the probe, which it does not, and the probe is described where it happens; the relay steps gained the stopped-container and adoption branches and a step for the derivation, and the `how()` line at the end is the `docker exec` argv with the decision link.
- `docs/COMPUTER.md` - the folder recipe uses the `source` form and says what each `source` value means; the reach is the `docker exec` line with the `devcontainer.metadata` label, the probe and the `a-dev-container-is-reached-by-docker-exec` decision; it says a dotfile changed afterwards is not seen until the container is made again, and that a hand-made container is adopted rather than duplicated; the backend table says `docker exec` for both kinds of machine; the session's working directory says what a dev container falls back to; Security gained "Allowed folders" with the four routes and the off switch.
- `.project/plans/container/00-container.md` - the two-recipes section gained the `source` field, the hand-made container's adoption, the allowlist and the off switch; the known gap about `devcontainer exec` is gone and one about an adopted container not being listed replaced it.
- `packages/computer/README.md` - the options table gained a `devcontainer` row. This file is not in the task's Files list; the earlier pass noted that `folders` had no row and that `computer-options.test.ts` only checks the README against the schema, so nothing failed. `devcontainer` itself had no row either, so the row is for the key rather than for the one sub-field.

Validation: `rg -n "devcontainer exec" docs .project/plans/container/00-container.md` finds nothing. No em dash in either doc, no line this pass wrote is wrapped, every decision link resolves, and `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` are green (2509 tests).

Notes and open questions:

- Step 3 held: only what was wrong was changed. `docs/CONTAINERS.md` keeps its one-sentence-per-line shape and the 3-space indent under its numbered list, and neither doc was reflowed.
- The `ahpd.devcontainer.folder` label no longer says anything about how a command reaches the container, which is what this pass changed. What it now says is what it is for: the picker's way of knowing a folder already has a computer. The label that answers how the container is reached is `devcontainer.metadata`, and the two are named apart so that neither is read for the other's job.
- A container made by hand is documented as adopted, which is task 15's behaviour, and as not listed until one is.
- Nothing in either doc was written about the probed environment's file beyond what it does: `computers.json` beside the daemon's config, keyed by container id, written once per container.

### The fix turn of 2026-10-05

Task 15's adoption now records the container in `computers.json`, and it is listed, metered and found again from there, so the sentences that said an adopted container is not listed were wrong. `docs/CONTAINERS.md` (the hand-made container paragraph and step 2 of the relay), `docs/COMPUTER.md` (the hand-made container sentence) and `00-container.md` (the two-recipes paragraph) now say it is recorded and listed once adopted; the known gap in `00-container.md` is replaced by the one that holds, that an adopted container gets nothing the override config carries. `docs/COMPUTER.md`'s decision link pointed at the superseded `a-dev-container-is-made-by-the-dev-container-cli` and now points at `a-dev-container-is-reached-by-docker-exec`. Only those sentences changed, and nothing was reflowed.
