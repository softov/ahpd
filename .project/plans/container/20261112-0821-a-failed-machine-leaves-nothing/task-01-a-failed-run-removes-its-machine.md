---
title: A failed run removes its machine
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L3326-L3335](../../../../packages/computer/src/runtime.ts#L3326-L3335) - the steps to guard"
  - "[code://packages/computer/src/runtime.ts#L3391](../../../../packages/computer/src/runtime.ts#L3391) - the volume removal to reuse"
---

## Objective

A failure in `docker run`, `create`, `cp`, `start` or `seedGit` removes the container and its `ahpd-git-<name>` volume, then throws the first error.

## Files

- `UPDATE: packages/computer/src/runtime.ts:3326-3335` - one catch around the run and the seed.
- `UPDATE: packages/computer/src/runtime.ts:2364-2366` - the seed's own catch goes, since the outer one covers it.
- `UPDATE: packages/computer/test/` - cases for a failed run and a failed seed.

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
