---
title: A failed pack is tried again and leaves nothing
status: done
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/parts.ts#L328-L338](../../../../packages/computer/src/parts.ts#L328-L338) - the tarball read by the absolute path `pnpm pack` printed"
  - "[code://packages/computer/src/parts.ts#L342-L358](../../../../packages/computer/src/parts.ts#L342-L358) - `packedOf`, whose scratch directory is removed in a `finally`"
  - "[code://packages/computer/src/parts.ts#L373-L396](../../../../packages/computer/src/parts.ts#L373-L396) - `ahpdSourceOf`, whose rejected answer is dropped"
  - "[code://packages/computer/test/computer-parts-build.test.ts#L307-L400](../../../../packages/computer/test/computer-parts-build.test.ts#L307-L400) - the three cases, over a `pnpm` of their own"
---

## Objective

A pack that fails is asked again by the next build rather than until the daemon restarts, the scratch directory a pack uses is gone once its bytes are read, and the tarball it wrote is read by the path it printed.

## Files

- `UPDATE: packages/computer/src/parts.ts:328-338` - `file` resolved rather than joined onto the pack directory; today the read is `ENOENT` whatever the pack did, so `ahpdSourceOf()` never resolves in a checkout.
- `UPDATE: packages/computer/src/parts.ts:373-396` - a rejected `answered` is cleared; today `answered ??=` keeps the rejected promise, so one `pnpm pack` failure (a build not run yet) fails every ahpd part build until restart.
- `UPDATE: packages/computer/src/parts.ts:342-358` - remove `into` after the tarballs are read, in a `finally`; today every pack leaves an `ahpd-pack-*` directory in the temp directory.
- `UPDATE: packages/computer/test/computer-parts-build.test.ts` - the cases below.

## Steps

1. Failing case first: a `pnpm` of the test's own that writes a tarball and prints its absolute path - what the real one prints. Today the read names the pack directory twice over and is `ENOENT`; after, the source resolves and no `ahpd-pack-*` it made is left.
2. Failing case: the first `ahpdSourceOf()` rejects (a pack that refuses once) and the second resolves. Today the second is handed the same refusal.
3. Failing case: the pack directory is gone after a pack that failed, as well as after one that worked.

## Validation

- All three cases fail on `e1c4ccc` and pass after.
- `pnpm exec vitest run packages/computer/test/computer-parts-build.test.ts`.

## Resume

Unblocked and implemented 2026-10-06. Softov answered the question this task was blocked on - does it take the `packOf` read too - with yes, and the read is the first of the three cases here.

The three changes in `parts.ts`. `packOf` reads the tarball at `resolve(file)`: the last line of `pnpm pack`'s output is its absolute path, and `join(into, file)` read a second absolute path as a relative one, naming the scratch directory twice over. `packedOf` removes `into` in a `finally`, so the directory goes whether the pack worked or failed. `ahpdSourceOf` no longer remembers a rejection: the answer is kept in `answered` and a catch clears it when it is still that same promise, so the caller that met the failure still gets it and the next build asks again.

All three were seen failing first against the scripted `pnpm`. The read: `ENOENT: no such file or directory, open '<tmp>/ahpd-pack-GC8IkK/<tmp>/ahpd-pack-GC8IkK/packed-2705759.tgz'` - the scratch directory twice over, exactly the line this task was blocked with. The retry: the second `ahpdSourceOf()` rejecting with `pnpm pack could not pack @ahpd/server, which the release workflow runs after pnpm build`. And the leftovers: `expected [ 'ahpd-pack-EfB7hd' ] to deeply equal []`.

What makes them reachable at all is a `pnpm` of the test's own, first on `PATH`: a shell script that writes a tarball into the `--pack-destination` it is given and prints its absolute path as its last line, which is what the real one prints and which a real pack here cannot be - `pnpm build` is what makes `prepack`'s `tsc -p .` resolve, and CI runs the tests before it. Each case imports `../src/parts.js` again after `vi.resetModules()`, because the answer is remembered once per process; the file's `afterEach` now tolerates a case that made no docker state file.

Gates: `npx tsc -b` clean, `npx vitest run packages/computer/test/computer-parts-build.test.ts packages/computer/test/computer-parts.test.ts` 36 passed, `npx vitest run packages/computer/test` 20 files and 338 tests passed.
