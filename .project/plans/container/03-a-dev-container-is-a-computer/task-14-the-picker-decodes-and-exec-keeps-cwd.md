---
title: The picker decodes the session folder, and a dev container keeps the working directory asked for
status: implemented
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

Implemented on 2026-10-03.

Files changed:

- `packages/computer/src/plugin.ts` - the picker decodes the URI with `fileURLToPath` rather than stripping a `file://` prefix. A `workingDirectory` that is not a `file:` URI is left as it is, since the SDK types it as "a URI" and says nothing else about what a client sends.
- `packages/computer/test/computer-devcontainer.test.ts` - the two cases below.

What the tests cover: a folder `/my app` sent as `pathToFileURL(folder).href` gets its `devcontainer://` row, which with the prefix strip it does not, because the strip leaves `my%20app` in the path and no such folder has a definition. And `how()` for a dev container answers `-w /workspaces/Box/sub` for `cwd: <folder>/sub`, `-w /workspaces/Box` for a `cwd` no mount covers, and `-w /workspaces/Box` for none; dropping the `within(held, asked.cwd)` makes the first answer `/workspaces/Box`.

Notes and open questions:

- The `cwd` half was already in place when this task ran, and no code changed for it. Task 18 built `reach`'s dev container branch on `execArgv`, which takes the same `start` a `docker` machine does: `within(held, asked.cwd)` when a mount covers the path, else the machine's own. What a dev container's own is, `workdirOf` already answered, by reading the `ahpd.devcontainer.folder` label and finding the bind mount it names - which is the workspace folder inside. So the rule the task spells out is the rule the code follows, and what was missing was only a case that says so. A version of the fallback computed inside `reach` from `within(held, devcontainerFolder(held))` was tried first and dropped: it is the same answer as a second place for it.
- Step 1 holds as the task says: `within` is still the one mapping, `execArgv` still emits `-w`, and no `sh -c cd` was added anywhere. The case asserts `-w` on the argv rather than on the argv's effect, which is what proves there is no wrapper.
- A path a mount covers but whose inside does not exist is left to Docker, which makes the directory on `exec -w` if it can and refuses if it cannot. Nothing here creates directories, and no task asks for it.

### The fix turn of 2026-10-05

Added `computer-devcontainer.test.ts` "omits the dev container row for a URI it cannot read a folder from, and keeps the others": for `file://elsewhere/w/app` and `file:///w/a%2Fb`, which `fileURLToPath` refuses, the picker answers the host row and the existing computer and no `devcontainer://` row, rather than failing. It covers the `decoded` guard that was already in the picker, and passed when written. No code changed for this task.
