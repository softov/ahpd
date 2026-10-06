---
title: A repository root is mounted only where the profile allows it
status: done
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L2086-L2088](../../../../packages/computer/src/runtime.ts#L2086-L2088) - `repository` replaces the folder in the `-v` mount"
  - "[code://packages/computer/src/runtime.ts#L1114-L1115](../../../../packages/computer/src/runtime.ts#L1114-L1115) - and the dev container's workspace mount"
  - "[code://packages/computer/src/plugin.ts#L1300-L1302](../../../../packages/computer/src/plugin.ts#L1300-L1302) - behind `sessionFolder` alone"
---

## Objective

A session in a folder below a repository's root gets the root mounted only where its profile says `sessionRepository: true`, beside `sessionFolder`, as decision [a-session-folder-reaches-a-machine-only-where-its-profile-allows](../../../decisions/a-session-folder-reaches-a-machine-only-where-its-profile-allows.md) gates the folder.
Without it the folder alone is mounted, with no git directory, and the log says the profile does not allow the repository.

## Files

- `UPDATE: packages/computer/src/plugin.ts:195-226` - read `sessionRepository: true` as `sessionFolder` is read, and add it to the profile schema beside it.
- `UPDATE: packages/computer/src/plugin.ts:1300-1302` - `withGit` passes `repository` and a git directory outside the folder only where `sessionRepository` is true; today `sessionFolder: true` lets the folder in and the root comes with it, so a session folder `~/scratch` inside a dotfiles repository at `$HOME` mounts all of `$HOME` read-write.
- `UPDATE: packages/computer/src/runtime.ts:1114-1115,2086-2088` - unchanged if `repository` only arrives where allowed.
- `UPDATE: docs/COMPUTER.md:433-435` - a `sessionRepository` row beside `sessionFolder`'s, and the sentence on a folder below the root.
- `UPDATE: packages/computer/test/computer-disposable.test.ts` - the case below.

## Steps

1. Failing case first: a repository at `<tmp>/home` and a session folder `<tmp>/home/scratch` on a profile with `sessionFolder: true` and nothing else. Today the machine mounts `<tmp>/home`; after, it mounts `<tmp>/home/scratch` alone, and no git directory.
2. The same profile with `sessionRepository: true` mounts `<tmp>/home` (passes before and after).

## Validation

- The case in step 1 fails on `e1c4ccc` and passes after.
- `pnpm exec vitest run packages/computer/test/computer-disposable.test.ts`.

## Resume
