---
title: The session folder reaches a machine only where its profile says sessionFolder
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L522](../../../../packages/computer/src/plugin.ts#L522) - the chosen profile, which mounts the session's folder read-write with no `bodyMounts` check"
  - "[code://packages/computer/src/manifest.ts](../../../../packages/computer/src/manifest.ts) - `Profile` and `MANIFEST_SCHEMA`"
---

## Objective

A machine made for a session mounts the session's folder only when its profile says `sessionFolder: true`.
This applies [A session folder reaches a machine only where its profile allows](../../../decisions/a-session-folder-reaches-a-machine-only-where-its-profile-allows.md).

## Files

- `UPDATE: packages/computer/src/manifest.ts` - `Profile.sessionFolder?: boolean`, documented and read from the plugin options.
- `UPDATE: packages/computer/src/plugin.ts:522` - `folder` is added only when the profile has the flag.
- `UPDATE: docs/COMPUTER.md` - the flag, in the profile table.
- `UPDATE: test/computer-disposable.test.ts` - the cases below.

## Steps

1. Without the flag, the machine carries no folder of the session's, and the session starts in the image's working directory.

## Validation

- A disposable profile without `sessionFolder` makes a machine with no `-v <session folder>`; today it has one, so the case fails.
- With `sessionFolder: true` the mount is there, same path, read-write.

## Resume
