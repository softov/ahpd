---
title: The session folder reaches a machine only where its profile says sessionFolder
status: done
depends: []
layer: "computer | docs"
refs:
  - "[code://packages/computer/src/plugin.ts#L734-L740](../../../../packages/computer/src/plugin.ts#L734-L740) - `chosen`, which writes the session's folder into the profile unconditionally, past the `bodyMounts` gate"
  - "[code://packages/computer/src/plugin.ts#L109-L141](../../../../packages/computer/src/plugin.ts#L109-L141) - `profilesOf`, where a profile's fields are read from the plugin options"
  - "[code://packages/computer/src/manifest.ts#L34-L94](../../../../packages/computer/src/manifest.ts#L34-L94) - `Profile`"
  - "[code://packages/computer/src/runtime.ts#L728-L730](../../../../packages/computer/src/runtime.ts#L728-L730) - the folder mounted read-write at the same path"
  - "[code://docs/COMPUTER.md#L246-L250](../../../../docs/COMPUTER.md#L246-L250) - the disposable fields table"
---

## Objective

A machine made for a session from a disposable profile mounts the session's folder only when its profile says `sessionFolder: true`.
This applies [A session's folder reaches a machine only where its profile allows it](../../../decisions/a-session-folder-reaches-a-machine-only-where-its-profile-allows.md).
A `devcontainer://<folder>` source is the folder itself, chosen by the person, and the CLI mounts it as its workspace, so it is not this flag's.

## Files

- `UPDATE: packages/computer/src/manifest.ts:34-94` - `Profile.sessionFolder?: boolean`, documented.
- `UPDATE: packages/computer/src/plugin.ts:109-141` - `profilesOf` reads `sessionFolder: true`.
- `UPDATE: packages/computer/src/plugin.ts:734-740` - the session's folder is written into `chosen` only when the profile has the flag; the comment says so.
- `UPDATE: docs/COMPUTER.md:246-250` - a `sessionFolder` row in the table: what it mounts, read-write at the same path, and that without it Claude's history in the machine is not this host's.
- `UPDATE: docs/COMPUTER.md:226-245` - the `scratch` example sets `sessionFolder: true`, so it keeps doing what the section describes.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - the cases below.

## Steps

1. Without the flag, the machine carries no folder of the session's, and the session starts in the profile's `workdir` or the image's.
2. A profile's own `folder` is the operator's and is unchanged by this flag.

## Validation

- A disposable profile without `sessionFolder` makes a machine with no `-v <session folder>`; today it has one, so the case fails.
- With `sessionFolder: true` the mount is there, same path, read-write.
- The docs example test still loads and makes its machine.

## Resume
