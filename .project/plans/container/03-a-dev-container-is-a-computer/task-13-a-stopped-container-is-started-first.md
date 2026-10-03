---
title: The relay starts a stopped container before reaching it
status: todo
depends: [task-07-the-fake-cli-behaves-like-the-real-one.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/devcontainer.ts#L358-L367](../../../../packages/computer/src/devcontainer.ts#L358-L367) - `connect` skips `up` when `existing` answers and the remote folder is remembered, whatever the container's status"
  - "[code://packages/computer/src/plugin.ts#L839-L840](../../../../packages/computer/src/plugin.ts#L839-L840) - `machineFor`, the `existing` the plugin hands in, which ignores the status the listing carries"
---

## Objective

`connect` for a folder whose container is stopped runs `up` (which starts it) before the first `docker exec`, instead of reaching a stopped container.

## Files

- `UPDATE: packages/computer/src/plugin.ts:839-840` - `machineFor` answers the status with the id.
- `UPDATE: packages/computer/src/devcontainer.ts:358-367` - only a running container skips `up`.
- `UPDATE: packages/computer/test/devcontainer.test.ts` - the case below.

## Steps

1. A container `up` starts again keeps its id, so the probe kept for it (task 18) is still its own and is not run again.

## Validation

- A folder whose labelled container is stopped: `connect` runs `up` and then reaches it; today it skips `up` and the fake Docker refuses the `docker exec` on a stopped container (task 07).

## Resume
