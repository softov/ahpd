---
title: Docs and the domain text
status: todo
depends: [task-03-the-form-offers-a-folder.md, task-04-the-picker-offers-the-folder.md, task-05-connect-uses-the-computer.md]
layer: "docs"
refs:
  - "[code://docs/CONTAINERS.md](../../../../docs/CONTAINERS.md) - the dev container page"
  - "[code://.project/plans/container/00-container.md](../../../../.project/plans/container/00-container.md) - \"The two mechanisms, kept apart\""
---

## Objective

`docs/CONTAINERS.md` and `docs/COMPUTER.md` describe one computer with two recipes, and `00-container.md` says so instead of "kept apart".

## Files

- `UPDATE: docs/CONTAINERS.md`
- `UPDATE: docs/COMPUTER.md`
- `UPDATE: .project/plans/container/00-container.md`

## Steps

1. Say that a container made by hand without the label is not listed.

## Validation

- Read through; no em dash, no hard wrap.

## Resume

Implemented 2026-09-26.
`docs/CONTAINERS.md` now says one computer with two recipes, the `devcontainer` create body, the `devcontainer://<folder>` picker row, the `devcontainer exec` reach, and that destroying the computer removes the container and never the folder or its `devcontainer.json`; it says a container made by hand without the labels is not listed, and it is written one sentence per line.
`docs/COMPUTER.md` adds the folder recipe, the picker row and the `--mount`/`--remote-env` delivery, and notes that a `devcontainer` body is not gated by `bodyMounts` and is not covered by the image allowlist.
`.project/plans/container/00-container.md`'s "two mechanisms, kept apart" is replaced by "one computer, two recipes", and its stale "no dev container surface" is corrected.
Task 03 is blocked, so both docs say the create form does not offer the source and a body written by hand is the route.

Reopened on 2026-09-26 by the review. What the first version wrote that is now wrong: the form does not offer a folder (task 03 changes that); `docs/CONTAINERS.md:55` says the option "can switch the whole thing off", which task 08 makes true of every route; `00-container.md:23` says the CLI is not installed, and `/usr/local/bin/devcontainer` 0.89.0 is.
The first version reflowed `docs/CONTAINERS.md` from its 80-column wrap to one sentence per line; Softov's rule is not to reformat text he wrote, so this pass corrects only what is wrong and reflows nothing further.

