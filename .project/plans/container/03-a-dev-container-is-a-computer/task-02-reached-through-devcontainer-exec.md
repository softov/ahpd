---
title: A session reaches it through devcontainer exec
status: todo
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
