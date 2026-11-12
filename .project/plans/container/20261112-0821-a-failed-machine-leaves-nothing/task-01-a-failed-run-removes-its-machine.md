---
title: A failed run removes its machine
status: implemented
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L3326-L3335](../../../../packages/computer/src/runtime.ts#L3326-L3335) - the steps to guard"
  - "[code://packages/computer/src/runtime.ts#L3391](../../../../packages/computer/src/runtime.ts#L3391) - the volume removal to reuse"
---

## Objective

A failure in `docker run`, `create`, `cp`, `start` or `seedGit` removes the container and its `ahpd-git-<name>` volume, then throws the first error.

## Files

- `UPDATE: packages/computer/src/runtime.ts:3365-3388` - one catch around the run steps and the seed, with `cleanUpFailed`.
- `UPDATE: packages/computer/src/runtime.ts:2275-2285` - `cleanUpFailed`, which removes the container and the git volume and logs a removal that fails.
- `UPDATE: packages/computer/src/runtime.ts:2312` - the seed's own `rm -f` catch is gone.
- `UPDATE: packages/computer/src/runtime.ts:3176-3183` - the dev container's `seedGit` call gets the same cleanup, since it is the seed's second caller.
- `CREATE: packages/computer/test/computer-cleanup.test.ts` - a failed run and a failed seed, each with no container and no git volume left.

## Steps

1. Put one `try` around the run steps and `seedGit` in `run`.
2. In the `catch`, run `rm -f <name>` and, for a `fetch` git label, `volume rm` of `gitVolumeOf(name)`.
3. Log a cleanup that fails, and throw the first error.
4. Remove the seed's own `rm -f` catch.
5. Write the cases with a fake docker that fails at `run` and at the seed.

## Validation

- The new cases: no container and no volume after each failure, and the first error thrown.
- `pnpm typecheck` and the computer suite pass.

## Resume

Done: the `run` steps and the seed are under one `try`. Its `catch` calls `cleanUpFailed` with the container's name and, for a `fetch` git label, `gitVolumeOf(name)`. The seed no longer removes the container itself. `cleanUpFailed` logs a removal that fails and never throws, so the first error is the one the caller gets.

The dev container's `seedGit` call is the seed's second caller, and the `run` guard covers only its own. It now has the same `try`/`catch`, so a failed seed there removes the CLI's container and the git volume too. That is a departure from the Files list, which named only the `run` path. Without it, step 4 would take away the cleanup the dev container path had.

The cases are in `packages/computer/test/computer-cleanup.test.ts`: `failRun` for a refused run, and `failCommands: ['git init']` for a failed seed. Both assert an empty machine list, no `ahpd-git-one` volume, the `rm -f` and `volume rm` calls, and the first error thrown. A refused run never made the volume, so its `volume rm` fails and the warning is asserted.

Left: no vitest was run, by the build instruction. `pnpm exec tsc -p tsconfig.json --noEmit` prints nothing.
