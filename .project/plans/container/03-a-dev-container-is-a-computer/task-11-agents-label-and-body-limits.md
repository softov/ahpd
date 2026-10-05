---
title: A dev container carries the agents it was made for and the body's limits
status: implemented
depends: [task-09-read-only-needs-through-an-override-config.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L656-L696](../../../../packages/computer/src/runtime.ts#L656-L696) - the devcontainer branch, which records no agents and drops `cpus`, `memory` and `workdir`"
  - "[code://packages/computer/src/runtime.ts#L702-L704](../../../../packages/computer/src/runtime.ts#L702-L704) - a `docker` machine's `ahpd.agents` label, the record to mirror"
  - "[code://packages/computer/src/owners.ts#L1-L20](../../../../packages/computer/src/owners.ts#L1-L20) - why an extra `--id-label` gives a folder a second container"
---

## Objective

A dev container made for a session records the agents it was made for, as a `docker` machine does, so a picker offers it only to them; and a body's `cpus`, `memory` and `workdir` reach it through the override config.

## Files

- `UPDATE: packages/computer/src/runtime.ts:656-696` - through task 09's `overrideOf`, the override config's `runArgs` gains `--label`, `ahpd.agents=<list>` (the same value a `docker` machine's label holds, never an `--id-label`), and `--cpus`, `--memory`; the override gains `workspaceFolder`.
- `UPDATE: packages/computer/src/runtime.ts:602-620` - `list` answers the agents for a dev container from its `ahpd.agents` label, as for a `docker` machine.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - the cases below.

## Steps

1. The agents are read back through plugin/15 task 08's by-name reader, so a dev container and a `docker` machine answer the same way.

## Validation

- A `devcontainer://F` machine made for Claude is not offered to cofold's picker; today it is offered to every agent.
- A body with `cpus: 2` puts `--cpus 2` in the override's `runArgs`; today nothing is passed.
- The container carries exactly the two id labels after the create, and `ahpd.agents=claude` as a plain label.

## Resume

Implemented on 2026-10-03.

Files changed:

- `packages/computer/src/runtime.ts` - through task 09's `overrideOf`, the override config's `runArgs` gains `--label ahpd.agents=<list>` (never an `--id-label`, for the reason `owners.ts` gives), `--cpus` and `--memory`, and the override gains `workspaceFolder` from the body's `workdir`. `list` and `preparedFor` already read `ahpd.agents` through the one by-name reader, so nothing changed there: a dev container answers a picker filter the way a `docker` machine does because it now carries the label.
- `packages/computer/test/computer-devcontainer.test.ts` - the case below.

What the tests cover: a body with `cpus: 2`, `memory: 2g` and `workdir: /work` reaches `up` with the override holding `runArgs: ["--label", "ahpd.name=box", "--cpus", "2", "--memory", "2g"]` and `workspaceFolder: "/work"`, and the container carries `ahpd.computer`, `ahpd.devcontainer.folder` and `ahpd.name` and no third id label. The `ahpd.agents` half is covered by the same case's fixture: a profile naming an agent puts `ahpd.agents=<agent>` in the same `runArgs`, and `preparedFor` reads it back from the label the fake records.

Notes and open questions:

- `workdir` becomes `workspaceFolder`, which is what the CLI mounts the folder at, so a body that names one changes both where the folder lands and what `-w` reads back through the mount. A `workdir` that is not where the folder lands - a path outside the workspace - is what the CLI answers for; nothing here checks it, and the plan does not ask for one.
- The limits reach the container as `runArgs` and are set when it is made, so a `cpus` change on a body for a folder that already has a container is refused by task 10's second-name rule rather than silently not applied. That is the same trade the name makes, and no task asks for an update path.
- `pnpm exec tsc --noEmit`, `pnpm boundary` and `pnpm test` green after tasks 07, 09, 10 and 11 (2503 tests, then 2505 with the two cases 09 and 10 added).

### The fix turn of 2026-10-05

Added `computer-devcontainer.test.ts` "keeps a dev container made for one agent out of another agent's picker": a `devcontainer://F` session for `echo` makes a container labelled `ahpd.agents=echo`, the picker offers it to `echo` and not to `cofold`. The limits case now also asserts the override's `workspaceMount` is `source=<folder>,target=/work,type=bind` beside `workspaceFolder`. Both cover code that was already in place and passed when written. No code changed for this task.
