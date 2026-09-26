---
title: A dev container carries its agents label and the body's limits
status: todo
depends: [task-09-read-only-needs-through-an-override-config.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L570-L590](../../../../packages/computer/src/runtime.ts#L570-L590) - the devcontainer branch, which writes no `ahpd.agents` and drops `cpus`, `memory` and `workdir`"
---

## Objective

A dev container made for a session carries `ahpd.agents` like a Docker machine, and a body's `cpus`, `memory` and `workdir` reach it through the override config.
This applies [A dev container's cpus, memory and working directory reach it through the override config](../../../decisions/a-dev-containers-body-limits-reach-it-through-the-override.md).

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `--id-label ahpd.agents=...` when `for` names an agent; the override gains `runArgs: ["--cpus", ..., "--memory", ...]` and `workspaceFolder`.
- `UPDATE: test/computer-devcontainer.test.ts` - the cases below.

## Steps

1. The agents label is read back through plugin/15 task 08's by-name reader.

## Validation

- A `devcontainer://F` machine made for Claude is not offered to cofold's picker; today it is offered to every agent.
- A body with `cpus: 2` puts `--cpus 2` in the override's `runArgs`; today nothing is passed.

## Resume
