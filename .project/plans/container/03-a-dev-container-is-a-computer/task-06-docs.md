---
title: Docs and the domain text
status: todo
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

