---
title: A profile names the OCI runtime its machines run under
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L25-L63](../../../../packages/computer/src/manifest.ts#L25-L63) - `Profile`"
  - "[code://packages/computer/src/manifest.ts#L406-L610](../../../../packages/computer/src/manifest.ts#L406-L610) - `manifestOf`"
  - "[code://packages/computer/src/plugin.ts#L57-L100](../../../../packages/computer/src/plugin.ts#L57-L100) - `profilesOf`, which keeps only usable profile fields"
  - "[code://packages/computer/src/runtime.ts#L56-L150](../../../../packages/computer/src/runtime.ts#L56-L150) - `MachineSpec`"
  - "[code://packages/computer/src/runtime.ts#L600-L630](../../../../packages/computer/src/runtime.ts#L600-L630) - the `docker run` flags"
  - "[code://test/computer.test.ts](../../../../test/computer.test.ts) - the fake `docker` the flags are asserted against"
---

## Objective

A machine made from a profile with `ociRuntime` is started with `docker run --runtime=<value>`, and nothing else changes.

## Files

- `UPDATE: packages/computer/src/manifest.ts:25-63` - `Profile.ociRuntime`, documented.
- `UPDATE: packages/computer/src/plugin.ts:57-100` - `profilesOf` keeps a non-empty string `ociRuntime`.
- `UPDATE: packages/computer/src/manifest.ts:406-610` - `manifestOf` copies it from the profile, and refuses a body that names it.
- `UPDATE: packages/computer/src/runtime.ts:56-150` - `MachineSpec.ociRuntime`, documented.
- `UPDATE: packages/computer/src/runtime.ts:600-630` - `--runtime` pushed when it is set.
- `UPDATE: test/computer.test.ts` - the cases below.

## Steps

1. Add the field to `Profile` and `MachineSpec` with a comment saying what it is: the OCI runtime Docker starts the container under, `runsc` for gVisor.
2. Read it in `profilesOf` like the other string fields.
3. In `manifestOf`, take it from the profile only; a body with `ociRuntime` is refused `-32602` with a sentence saying it is the operator's.
4. In the docker runtime, push `--runtime`, then the value, before the image.
5. Leave the dev container path untouched.

## Validation

- `test/computer.test.ts`: a profile with `ociRuntime: 'runsc'` makes a `docker run` carrying `--runtime runsc`; a profile without it carries no `--runtime`; a body with `ociRuntime` is refused.
- `pnpm test`, `pnpm typecheck` green.

## Resume

