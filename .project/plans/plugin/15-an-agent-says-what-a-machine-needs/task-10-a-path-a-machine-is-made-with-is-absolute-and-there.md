---
title: A path a machine is made with is absolute and there
status: done
depends: []
layer: "sdk | computer"
refs:
  - "[code://packages/sdk/src/machine.ts#L80-L95](../../../../packages/sdk/src/machine.ts#L80-L95) - `resolveNeeds`, whose `existsSync` checks a relative value against the daemon's cwd"
  - "[code://packages/computer/src/manifest.ts#L520-L535](../../../../packages/computer/src/manifest.ts#L520-L535) - the body's and the profile's mounts, checked only against the `source:target` pattern"
  - "[code://packages/computer/src/manifest.ts#L342](../../../../packages/computer/src/manifest.ts#L342) - `MOUNT`, which takes a relative source"
  - "[code://packages/computer/src/manifest.ts#L553-L559](../../../../packages/computer/src/manifest.ts#L553-L559) - the `folder` check, the sentence shape to reuse"
  - "[code://packages/computer/src/plugin.ts#L262](../../../../packages/computer/src/plugin.ts#L262) - the plugin's own `mounts`, never checked at all"
---

## Objective

A need value for a mount or a copy-in that is not an absolute path is refused, and so is a plugin, profile or body mount whose host path is relative or missing.
Today a relative need value is checked against the daemon's cwd and then passed as `-v name:/x`, which Docker reads as a named volume; and the plan's goal, "a mount whose host path is missing is refused", holds only for need mounts.
A body mount is covered too: it is a mount the machine is made with, and the goal names every one.

## Files

- `UPDATE: packages/sdk/src/machine.ts:80-95` - after `expandHome`, a mount or copy-in value that is not absolute is refused with the need's name, the value and where it came from; an env need is not a path and is not checked.
- `UPDATE: packages/computer/src/manifest.ts:520-535` - each plugin, profile and body mount source is refused when it is not absolute, or not there, with the folder check's sentence shape and the mount's origin.
- `UPDATE: packages/sdk/test/machine-needs.test.ts`, `packages/computer/test/computer-needs.test.ts` - the cases below, and every existing case that mounts a path this host does not have (`/srv/...`) moved to a temporary directory.

## Steps

1. Refuse a relative value in `resolveNeeds` before `existsSync`.
2. Check each mount's host path in `manifestOf`, which runs at create, not at load, so a folder made after the daemon started is accepted.
3. A refusal names a need by its name and a mount by what the operator wrote; it never prints an env need's value, because that value may be a credential.

## Validation

- `resolveNeeds` with `profile: { claudeConfigDirectory: 'rel/dir' }` throws; today it resolves against the daemon's cwd and the case fails.
- An env need whose value is `rel` resolves unchanged, and a required env need with no value is refused without a value in the sentence.
- A profile whose own `mounts` names a missing host path is refused at create; today the machine is made with an empty directory.
- A plugin `mounts` entry `cache:/cache` is refused as not absolute.
- With `bodyMounts: true`, a body mount of a missing path is refused.

## Resume
