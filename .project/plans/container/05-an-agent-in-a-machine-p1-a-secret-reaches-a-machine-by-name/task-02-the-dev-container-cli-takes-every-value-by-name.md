---
title: The Dev Container CLI takes every value by name
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/plugin.ts#L367](../../../../packages/computer/src/plugin.ts#L367) - `devcontainer exec --remote-env`"
  - "[code://packages/computer/src/runtime.ts#L585](../../../../packages/computer/src/runtime.ts#L585) - `devcontainer up --remote-env`"
  - npm://@devcontainers/cli - the CLI whose flag is checked
  - "[code://packages/computer/test/fixtures/devcontainer.mjs](../../../../packages/computer/test/fixtures/devcontainer.mjs) - the fake CLI"
---

## Objective

A dev container machine gets its values without them in the CLI's argv, the same as a Docker one.

## Files

- `UPDATE: packages/computer/src/plugin.ts:367` - the remote env flags.
- `UPDATE: packages/computer/src/runtime.ts:585` - the same at `up`.
- `UPDATE: packages/computer/test/fixtures/devcontainer.mjs` - the fake follows what the real CLI does.

## Steps

1. Read the CLI's source for `--remote-env` and find whether `NAME` alone, or `NAME=${localEnv:NAME}`, is taken from its environment. Write what was found in this task's Resume.
2. If one of them is, use it with the values in the spawned env, as task 01 does.
3. If neither is, stop and ask Softov, with what the CLI accepts.

## Validation

- `devcontainer.test.ts`: no asked value in the fake CLI's argv, and the value reaches the command.
- `pnpm --filter @ahpd/computer test` green.

## Resume
