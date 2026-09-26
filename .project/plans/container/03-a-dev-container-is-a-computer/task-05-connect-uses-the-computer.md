---
title: VS Code's connect finds or makes the same computer
status: implemented
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

Implemented 2026-09-26, with one departure from this task's file list.
`packages/computer/src/devcontainer.ts` runs `up` with `--id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=<folder>` and runs every `exec` with the same pair.
It skips `up` when the plugin's `existing(folder)` answers a computer and the launcher already learned that folder's remote workspace from its first `up`; a folder this daemon has not seen asks the CLI again, which finds the labelled container rather than making a second one.
`packages/sdk/src/host.ts` needed no change: the find lives in the launcher, which `plugin.ts` constructs with the runtime's own listing, and the host handler already relays, ends on `disconnect` and on a dropped socket, and leaves the container - which is what `plugin/16` predicted.
The relay's wire format and methods are untouched.
Validated by the connect-twice test in `test/computer-devcontainer.test.ts` and by the existing container and relay tests.
