---
title: A container made by an older connect is adopted by its folder
status: todo
depends: [task-10-the-name-given-is-a-label.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/devcontainer.ts#L369-L388](../../../../packages/computer/src/devcontainer.ts#L369-L388) - `connect`, which passes `--id-label` on every `up`"
---

## Objective

A container made by container/01's `connect`, labelled only with the CLI's `devcontainer.local_folder`, is found for its folder and adopted instead of a second one being made.


## Files

- `UPDATE: packages/computer/src/devcontainer.ts`, `packages/computer/src/runtime.ts` - when no container carries ahpd's labels for a folder, look for `devcontainer.local_folder=<folder>`, and adopt it; an adopted container is probed once like any other (task 18).
- `UPDATE: packages/computer/test/fixtures/devcontainer.mjs`, `packages/computer/test/devcontainer.test.ts` - the case below.

## Steps

1. Read what the real CLI does when `--id-label` is passed and a container with only `devcontainer.local_folder` exists, and choose adoption (record the id against the folder, or recreate through `up`) from that; write the choice in Resume.

## Validation

- A fake container labelled only `devcontainer.local_folder=/w`: `connect` for `/w` reaches it and makes no second one; today a second is made.

## Resume
