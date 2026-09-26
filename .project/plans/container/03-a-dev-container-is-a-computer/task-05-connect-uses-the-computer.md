---
title: VS Code's connect finds or makes the same computer
status: todo
depends: [task-02-reached-through-devcontainer-exec.md]
layer: "sdk | computer"
refs:
  - "[code://packages/sdk/src/host.ts#L6645](../../../../packages/sdk/src/host.ts#L6645) - the `vscode/devContainers/connect` handler"
---

## Objective

`vscode/devContainers/connect` looks for a computer labelled with the folder, makes one the task-01 way when there is none, starts the nested host in it through `devcontainer exec`, and relays as today; `disconnect` and a dropped socket end the relay and leave the computer.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the handler.
- `UPDATE: packages/computer/src/devcontainer.ts` - up only when no computer exists.

## Steps

1. The relay's wire format and methods do not change.

## Validation

- The existing container tests pass; a new one: connect twice for one folder makes one container.

## Resume
