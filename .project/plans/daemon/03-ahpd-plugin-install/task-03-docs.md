---
title: The docs say one command
status: done
depends: [task-01-install-and-remove.md, task-02-the-container-installs-its-backends.md]
layer: "docs"
refs:
  - "[code://README.md](../../../../README.md) - the global install block"
  - "[code://docs/DAEMON.md](../../../../docs/DAEMON.md) - the install and backend sections"
  - "[code://packages/server/README.md](../../../../packages/server/README.md) - what npm shows for the server"
  - "[code://docs/CONTAINERS.md](../../../../docs/CONTAINERS.md) - the two workarounds for the container gap"
---

## Objective

Every install block shows `ahpd plugin install`, and the container gap is gone from the docs.

## Files

- `UPDATE: README.md`, `docs/DAEMON.md`, `packages/server/README.md` - replace `cd ~/.config/ahpd && npm i ...` plus the `plugins` edit with `ahpd plugin install ...`; keep one line saying where it installs and that `npm i -g` of a plugin is not seen.
- `UPDATE: docs/PLUGINS.md`, `packages/agent-claude/README.md`, `packages/agent-pi/README.md` - the same replacement for the other install blocks the validation `grep` covers.
- `UPDATE: docs/CONTAINERS.md` - drop the workarounds; say npm-named plugins are installed in the container.
- `UPDATE: .project/working/HANDOFF.md` - close open-work item 1.
- `CREATE: implemented.md` in this plan's folder.

## Steps

1. Edit the four docs, one paragraph per line, no rationale beyond what a reader needs.
2. Write `implemented.md`, set the plan to `built`, update the index row.

## Validation

- `grep -rn "cd ~/.config/ahpd && npm i" README.md docs packages/*/README.md` finds nothing.

## Resume

The four documents and `HANDOFF.md` are edited as of 2026-09-26, and the `grep` under *Validation* finds nothing.
`implemented.md` and `status: built` are deliberately not written: the plan's tasks are `implemented` and wait on the verifier, per the instruction that asked for that state, so closing the plan is that verifier's step 2.

