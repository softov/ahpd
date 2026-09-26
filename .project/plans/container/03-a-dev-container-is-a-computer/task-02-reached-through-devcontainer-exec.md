---
title: A session reaches it through devcontainer exec
status: implemented
depends: [task-01-made-from-a-folder.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts) - `how`, the port answer"
  - "[code://packages/sdk/src/types/computers.ts#L16-L45](../../../../packages/sdk/src/types/computers.ts#L16-L45) - `Spawn`"
---

## Objective

`how()` for a dev container computer answers `devcontainer exec --workspace-folder <folder> --id-label ... <command>`, with the same id labels as its `up`, so a backend that moves (Claude, ACP) runs inside it as the config's user.

## Files

- `UPDATE: packages/computer/src/plugin.ts` or `runtime.ts` - the exec form per source.

## Steps

1. The folder comes from the container's `ahpd.devcontainer.folder` label, not from the session.

## Validation

- The fake CLI records the exec line; a scripted Claude spawn goes through it.

## Resume

Implemented 2026-09-26.
`how()` in `packages/computer/src/plugin.ts` answers `devcontainer exec --workspace-folder <folder> --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=<folder> <command>` for a machine whose `ahpd.devcontainer.folder` label is set, with a caller's `env` as `--remote-env` and the CLI's own environment on the descriptor.
The folder comes from the container's label, never from the session.
`dockerRuntime.exec` in `runtime.ts` takes the same route, so the `computer_exec` tool runs through the CLI too.
Validated by the exec test in `test/computer-devcontainer.test.ts`, which asserts the exact arguments and spawns the descriptor through the fake CLI.
