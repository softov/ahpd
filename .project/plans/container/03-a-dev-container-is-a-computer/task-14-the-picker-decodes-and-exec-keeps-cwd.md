---
title: The picker decodes the session folder, and a dev container keeps the working directory asked for
status: todo
depends: [task-18-every-command-reaches-it-by-docker-exec.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L942](../../../../packages/computer/src/plugin.ts#L942) - the picker's `workingDirectory`, a `file://` prefix strip rather than a decode"
  - "[code://packages/computer/src/plugin.ts#L576-L593](../../../../packages/computer/src/plugin.ts#L576-L593) - `reach` for a dev container, which drops `asked.cwd`"
  - "[code://packages/computer/src/plugin.ts#L594-L612](../../../../packages/computer/src/plugin.ts#L594-L612) - `reach` for a `docker` machine, which maps `asked.cwd` through `within` into `-w`"
  - "[code://packages/computer/src/plugin.ts#L210-L224](../../../../packages/computer/src/plugin.ts#L210-L224) - `within`"
---

## Objective

A session folder with a space in it gets its `devcontainer://` row, and a backend reached in a dev container starts in the directory its `cwd` names, as it does in a `docker` machine.

## Files

- `UPDATE: packages/computer/src/plugin.ts:942` - the folder is `fileURLToPath` of the URI, not a prefix strip.
- `UPDATE: packages/computer/src/plugin.ts:562-620` - after task 18 a dev container takes the `docker exec` branch; its `-w` is `within(held, asked.cwd)` when a mount covers it, and the workspace folder inside otherwise, the same rule a `docker` machine follows with its own working directory.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts` - the cases below.

## Steps

1. `within` stays the one mapping, and no `sh -c cd` wrapper is added.

## Validation

- A folder `/w/my app` with a definition is offered; today no row appears.
- `how()` for a dev container with `cwd: <folder>/sub` answers `-w <folder inside>/sub`; today the `cwd` is dropped.
- `how()` with a `cwd` no mount covers answers the workspace folder inside.

## Resume
