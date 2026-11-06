---
title: The servercheck case answers docker at once
status: todo
depends: []
layer: "tests"
refs:
  - "[code://packages/computer/test/computer-servercheck.test.ts#L115-L125](../../../../packages/computer/test/computer-servercheck.test.ts#L115-L125) - the case that runs the real script, and asserts `arch`, `cpus`, `memory` and `user`"
  - "[code://packages/computer/test/computer-servercheck.test.ts#L127-L137](../../../../packages/computer/test/computer-servercheck.test.ts#L127-L137) - the case beside it, which runs the script with its own `HOME` and `PATH`"
  - "[code://packages/computer/src/servercheck.ts#L72-L74](../../../../packages/computer/src/servercheck.ts#L72-L74) - `docker version` and `docker info`, which wait on the runner's Docker daemon"
---

## Objective

The case "runs its own script under sh" takes about 1 s on a CI runner.
No `docker` call in it waits on a daemon.

## Files

- `UPDATE: packages/computer/test/computer-servercheck.test.ts:115-125` - the script runs with a `docker` stub first on its `PATH`.

## Steps

1. Make a folder with `temp()` in the case, and write an executable `docker` there that runs `exit 1`.
2. Run the script with `env: { ...process.env, PATH: \`${stub}:${process.env.PATH}\` }`, where `stub` is that folder.
3. Keep the assertions on `arch`, `cpus`, `memory` and `user` as they are.
4. Run the file alone 24 times, and record the failures and the case's time.

## Validation

- `pnpm vitest run packages/computer/test/computer-servercheck.test.ts`, 24 times in a row: 0 failures.
- The case takes under 1 s on Softov's machine with Docker running.
- The PR's `processes` job passes with no rerun.

## Resume
