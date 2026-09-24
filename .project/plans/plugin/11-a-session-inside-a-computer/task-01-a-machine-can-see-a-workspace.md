---
title: A machine can see a workspace
status: done
depends: []
layer: packages/computer
refs:
  - "[code://packages/computer/src/runtime.ts#L30-L45](../../../../packages/computer/src/runtime.ts#L30-L45) - `MachineSpec`"
  - "[code://packages/computer/src/runtime.ts#L173-L182](../../../../packages/computer/src/runtime.ts#L173-L182) - the `run` argument list"
  - "[code://packages/computer/src/provider.ts#L27-L38](../../../../packages/computer/src/provider.ts#L27-L38) - the manifest `provider.ts` parses, from plan 10 task 01"
  - "[code://packages/computer/src/provider.ts](../../../../packages/computer/src/provider.ts) - the create body this extends"
  - "[code://test/computer.test.ts](../../../../test/computer.test.ts) - the fixture runtime"
---

## Objective

A create manifest may name bind mounts and a working directory, `runtime.run` passes them to the runtime, and the port's descriptor for a machine can use that working directory.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `MachineSpec.mounts?: string[]` and `MachineSpec.workdir?: string`, and the `-v` and `-w` arguments `run` builds.
- `UPDATE: packages/computer/src/manifest.ts` - the two fields, validated as strings that look like a mount and a path.
- `UPDATE: packages/computer/src/provider.ts` - pass them through, and name them in `capabilities`.
- `UPDATE: test/computer.test.ts` - the arguments the fixture runtime is asked for.

## Steps

1. Add `mounts` and `workdir` to `MachineSpec`, with the comment that a mount is the host's filesystem made visible and not a boundary this host enforces.
2. Build `-v` per mount and `-w` once when the workdir is named, before the image argument.
3. Validate a mount as `source:target` or `source:target:ro`, and a workdir as an absolute path, in the manifest.
4. Report both in `capabilities`, so a client's create form can offer them.

## Validation

- `test/computer.test.ts` - a manifest with two mounts and a workdir asks the runtime for `-v a:b`, `-v c:d:ro` and `-w /w`; a malformed mount and a relative workdir are refused with a sentence.
- `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.

## Resume

Not started.
The working directory is also what `docker exec -w` uses, which task 02's descriptor reads.
