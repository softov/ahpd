---
title: The relay starts a stopped container before reaching it
status: todo
depends: [task-07-the-fake-cli-behaves-like-the-real-one.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/devcontainer.ts#L350-L375](../../../../packages/computer/src/devcontainer.ts#L350-L375) - `existing`, which ignores the container's status and skips `up`"
---

## Objective

`connect` for a folder whose container is stopped runs `up` (which starts it) before `exec`, instead of reaching a stopped container.

## Files

- `UPDATE: packages/computer/src/devcontainer.ts:350-375` - `existing` answers the status, and only a running container skips `up`.
- `UPDATE: test/devcontainer.test.ts` - the case below.

## Validation

- A folder whose labelled container is stopped: `connect` runs `up` and then reaches it; today it skips `up` and `exec` fails (the fake now refuses `exec` on a stopped container).

## Resume
