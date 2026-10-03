---
title: A vault-named value reaches a dev container without being written in clear
status: todo
depends: []
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L674](../../../../packages/computer/src/runtime.ts#L674) - `devcontainer up --remote-env`, which `container/03` task 09 replaces with `containerEnv` in an override config"
  - "[code://packages/computer/src/runtime.ts#L656-L697](../../../../packages/computer/src/runtime.ts#L656-L697) - the `up` call it sits in"
  - "[code://.project/decisions/a-dev-container-is-reached-by-docker-exec.md](../../../decisions/a-dev-container-is-reached-by-docker-exec.md) - the CLI is used for `up` only; every later command is `docker exec`"
  - npm://@devcontainers/cli - the CLI whose flag is checked
  - "[code://packages/computer/test/fixtures/devcontainer.mjs](../../../../packages/computer/test/fixtures/devcontainer.mjs) - the fake CLI"
---

## Objective

A dev container machine gets its values at `up` without them in the CLI's argv, the same as a Docker one, and a value named from the vault is not written in clear in the override config `container/03` task 09 writes.
For now a vault-named value goes into `containerEnv` as `${localEnv:NAME}`, with the value in the CLI's spawned environment; a plain value is written as itself in the 0600 file.
Per-command values are not here: once container/03 switches dev containers to `docker exec`, they take task 01's route.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `overrideOf` (`container/03` task 09) writes a vault-named value as `${localEnv:NAME}`, and the `up` call spawns the CLI with the value in its env; which values are vault-named is read from the resolved need, one function deciding it.
- `UPDATE: packages/computer/test/fixtures/devcontainer.mjs` - the fake follows what the real CLI does.
- `UPDATE: packages/computer/test/devcontainer.test.ts` - the case below.

## Steps

1. Read the CLI's source for `containerEnv` and find whether `${localEnv:NAME}` in an override config is resolved from the CLI's own environment, and what argv the CLI's own `docker run` gets for it. Write what was found in this task's Resume.
2. If it is resolved and the value stays out of argv, use it with the values in the spawned env, as task 01 does.
3. If not, stop and ask Softov, with what the CLI accepts (the plan's open question 1).
4. Check that `container/03` task 09 writes the file 0600 and removes it after `up`; a plain value in the file is accepted for now.
5. Leave the `devcontainer exec` writer in `plugin.ts` alone; container/03's switch removes it.

## Validation

- `devcontainer.test.ts`: no asked value in the fake CLI's `up` argv, and the value reaches the container.
- The same file: a need whose value came from a `{ "$secret" }` reference is in the override config the fake CLI read as `${localEnv:NAME}`, and not as its value.
- `pnpm --filter @ahpd/computer test` green.

## Resume
