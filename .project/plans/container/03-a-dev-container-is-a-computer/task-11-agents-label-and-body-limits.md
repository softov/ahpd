---
title: A dev container carries the agents it was made for and the body's limits
status: todo
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
