---
title: A computer can start a nested host
status: todo
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
