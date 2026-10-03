---
title: A profile names the OCI runtime its machines run under
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/manifest.ts#L34-L106](../../../../packages/computer/src/manifest.ts#L34-L106) - `Profile`"
  - "[code://packages/computer/src/manifest.ts#L508-L745](../../../../packages/computer/src/manifest.ts#L508-L745) - `manifestOf`"
  - "[code://packages/computer/src/plugin.ts#L142-L175](../../../../packages/computer/src/plugin.ts#L142-L175) - `profilesOf`, which keeps only usable profile fields"
  - "[code://packages/computer/src/runtime.ts#L67-L178](../../../../packages/computer/src/runtime.ts#L67-L178) - `MachineSpec`"
  - "[code://packages/computer/src/runtime.ts#L778-L830](../../../../packages/computer/src/runtime.ts#L778-L830) - the `docker run` flags"
  - "[code://packages/computer/test/computer.test.ts](../../../../packages/computer/test/computer.test.ts) - the fake `docker` the flags are asserted against"
---

## Objective

A machine made from a profile with `ociRuntime` is started with `docker run --runtime=<value>`, and nothing else changes.

## Files

- `UPDATE: packages/computer/src/manifest.ts:34-106` - `Profile.ociRuntime`, documented.
- `UPDATE: packages/computer/src/plugin.ts:142-175` - `profilesOf` keeps a non-empty string `ociRuntime`.
- `UPDATE: packages/computer/src/manifest.ts:508-745` - `manifestOf` copies it from the profile, and refuses a body that names it.
- `UPDATE: packages/computer/src/runtime.ts:67-178` - `MachineSpec.ociRuntime`, documented.
- `UPDATE: packages/computer/src/runtime.ts:778-830` - `--runtime` pushed when it is set.
- `UPDATE: packages/computer/test/computer.test.ts` - the cases below.

## Steps

1. Add the field to `Profile` and `MachineSpec` with a comment saying what it is: the OCI runtime Docker starts the container under, `runsc` for gVisor.
2. Read it in `profilesOf` like the other string fields.
3. In `manifestOf`, take it from the profile only; a body with `ociRuntime` is refused `-32602` with a sentence saying it is the operator's.
4. In `manifestOf`, a machine made from a `devcontainer.json` (`devcontainerOf` answers a folder) with a profile that names `ociRuntime` is refused `-32602` with a sentence saying the option is for a machine `docker run` makes.
5. In the docker runtime, push one argument, `--runtime=<value>`, before the image.
6. Leave the dev container runtime itself untouched.

## Validation

- `packages/computer/test/computer.test.ts`: a profile with `ociRuntime: 'runsc'` makes a `docker run` carrying `--runtime=runsc`; a profile without it carries no `--runtime`; a body with `ociRuntime` is refused; a `devcontainer` machine from a profile with `ociRuntime` is refused.
- `pnpm test`, `pnpm typecheck` green.

## Resume

