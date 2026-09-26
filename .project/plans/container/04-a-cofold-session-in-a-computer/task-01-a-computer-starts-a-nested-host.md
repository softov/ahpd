---
title: A computer can start a nested host
status: implemented
depends: []
layer: "computer | sdk"
refs:
  - "[code://packages/sdk/src/types/computers.ts#L16-L49](../../../../packages/sdk/src/types/computers.ts#L16-L49) - `how` and `SpawnOptions`"
  - "[code://packages/computer/src/manifest.ts](../../../../packages/computer/src/manifest.ts) - the profile"
---

## Objective

A profile may set `host` (argv, default `["ahpd"]`), and the port answers `nested(id, { plugins, cwd })` with a spawn of `<host> --stdio --plugin <each>` in the machine, its stdio open.

## Files

- `UPDATE: packages/sdk/src/types/computers.ts` - `nested`.
- `UPDATE: packages/computer/src/plugin.ts` - its answer through `how`.
- `UPDATE: packages/computer/src/manifest.ts` - `host`.

## Steps

1. Reuse the dev container launcher's argv shape for the nested host.

## Validation

- A test against the fake Docker: the exec line for the default and for a profile `host`.

## Resume

Implemented 2026-09-26.
`packages/sdk/src/types/computers.ts` adds `NestedStart` (`plugins`, `cwd`) and the optional `ComputerPort.nested(id, asked)`, which answers the same `Spawn` descriptor `how` does - the caller owns the process and its stdio.
`packages/computer/src/manifest.ts` reads `host?: string[]` on a profile and records the profile's key on the machine, so the recipe survives the daemon that made it.
`packages/computer/src/runtime.ts` (a departure from the listed files) carries that as the `ahpd.profile` label and exports `profileOf`, which falls back to `ahpd.disposable` for a machine made by an older daemon.
`packages/computer/src/plugin.ts` defaults `host` to `["ahpd"]`, extracts the old inline `how` into `reach`, and answers `nested` with `reach(id, { command: host[0], args: [...host.slice(1), '--stdio', ...plugins.flatMap((p) => ['--plugin', p])], cwd })` - so a dev container is reached through its CLI and an image through Docker without either being spelled twice.
Validated by `test/nested-start.test.ts` against the fake Docker: the default exec line, a profile's `host`, two `--plugin`s in order, a machine that is not there answering `undefined`, and the `ahpd.profile` label on the create.
