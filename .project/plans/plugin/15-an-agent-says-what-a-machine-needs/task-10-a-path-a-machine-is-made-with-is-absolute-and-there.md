---
title: A path a machine is made with is absolute and there
status: todo
depends: []
layer: "sdk | computer"
refs:
  - "[code://packages/sdk/src/machine.ts#L80-L95](../../../../packages/sdk/src/machine.ts#L80-L95) - `resolveNeeds`, whose `existsSync` checks a relative value against the daemon's cwd"
  - "[code://packages/computer/src/manifest.ts#L600](../../../../packages/computer/src/manifest.ts#L600) - the profile's and the plugin's `mounts`, whose host paths are never checked"
---

## Objective

A need value that is not an absolute path is refused, and so is a profile or plugin mount whose host path is missing.
Today a relative need value is checked against the daemon's cwd and then passed as `-v name:/x`, which Docker reads as a named volume; and the plan's goal, "a mount whose host path is missing is refused", holds only for need mounts.

## Files

- `UPDATE: packages/sdk/src/machine.ts:80-95` - after `expandHome`, a value that is not absolute is refused with the need's name and where it came from.
- `UPDATE: packages/computer/src/manifest.ts` - each plugin and profile mount source is checked with the same sentence shape.
- `UPDATE: test/machine-needs.test.ts`, `test/computer-needs.test.ts` - the cases below.

## Steps

1. Refuse a relative value in `resolveNeeds` before `existsSync`.
2. Check each plugin and profile mount's host path at create, not at load, so a folder made later is accepted.

## Validation

- `resolveNeeds` with `profile: { claudeHome: 'rel/dir' }` throws; today it resolves (or reads the daemon's cwd) and the case fails.
- A profile whose own `mounts` names a missing host path is refused at create; today the machine is made with an empty directory.

## Resume
