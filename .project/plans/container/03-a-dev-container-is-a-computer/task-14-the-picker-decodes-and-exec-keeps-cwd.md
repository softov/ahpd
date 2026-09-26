---
title: The picker decodes the session folder, and exec keeps the working directory
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L685](../../../../packages/computer/src/plugin.ts#L685) - the picker's `workingDirectory`, not URI-decoded"
  - "[code://packages/computer/src/runtime.ts#L683-L692](../../../../packages/computer/src/runtime.ts#L683-L692) - `exec`, which drops `asked.cwd`"
---

## Objective

A session folder with a space in it gets its `devcontainer://` row, and a command run through `exec` runs in the directory it asked for.

## Files

- `UPDATE: packages/computer/src/plugin.ts:685` - the folder is `fileURLToPath` of the URI, not a prefix strip.
- `UPDATE: packages/computer/src/runtime.ts` - `exec` with a `cwd` runs `sh -c 'cd "$1" && shift && exec "$@"' sh <cwd> <command...>`, since the CLI has no working-directory flag.
- `UPDATE: test/computer-devcontainer.test.ts` - the cases below.

## Validation

- A folder `/w/my app` with a definition is offered; today no row appears.
- `exec` with `cwd: /workspaces/x` runs `pwd` there; today it runs in the container's default.

## Resume
