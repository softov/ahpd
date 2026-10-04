---
title: A vault-named value reaches a dev container on each docker exec, by name
status: todo
depends: [task-01-docker-takes-every-value-by-name.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/runtime.ts#L674](../../../../packages/computer/src/runtime.ts#L674) - `devcontainer up --remote-env`, which `container/03` task 09 replaces with `containerEnv` in an override config"
  - "[code://packages/computer/src/runtime.ts#L656-L697](../../../../packages/computer/src/runtime.ts#L656-L697) - the `up` call it sits in"
  - "[code://.project/decisions/a-dev-container-is-reached-by-docker-exec.md](../../../decisions/a-dev-container-is-reached-by-docker-exec.md) - the CLI is used for `up` only; every later command is `docker exec`"
  - npm://@devcontainers/cli - the CLI whose flag is checked
  - "[code://packages/computer/test/fixtures/devcontainer.mjs](../../../../packages/computer/test/fixtures/devcontainer.mjs) - the fake CLI"
  - "[code://packages/computer/src/secrets.ts#L53-L78](../../../../packages/computer/src/secrets.ts#L53-L78) - `revealed`, which answers plain strings and loses which values came from a `$secret`"
  - "[code://packages/sdk/src/types/machine.ts#L81-L94](../../../../packages/sdk/src/types/machine.ts#L81-L94) - `ResolvedNeed`, which has no marker for a vault-named value"
  - "[code://packages/computer/src/plugin.ts#L403-L412](../../../../packages/computer/src/plugin.ts#L403-L412) - `claimOf`, a machine's owner and team from its labels or, for a dev container, the record beside the config"
  - "[code://packages/computer/src/plugin.ts#L787-L803](../../../../packages/computer/src/plugin.ts#L787-L803) - the `SecretWork` and the two `revealed` calls at create"
---

## Objective

A value named from the vault reaches a dev container on every `docker exec` as `-e NAME`, with the value in the spawned `docker` process's environment, so it is never in an argv, the CLI's log, the override config or `docker inspect`.
A plain value goes into `containerEnv` in the override config `container/03` task 09 writes, for now.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `overrideOf` (`container/03` task 09) leaves a need with `ResolvedNeed.named` (task 01) out of `containerEnv`; the dev container's exec builder (`container/03` task 18) passes the machine's held vault-named values by name through task 01's `byName`.
- `UPDATE: packages/computer/test/fixtures/devcontainer.mjs` - the fake follows what the real CLI does with an override config: it replaces the folder's configuration rather than merging into it.
- `UPDATE: packages/computer/test/devcontainer.test.ts` - the cases below.

## Steps

1. Split a machine's resolved env in two by `ResolvedNeed.named`: vault-named values, and the rest.
2. The rest goes into the override's `containerEnv` as written.
3. The vault-named values are held with the machine as task 01 holds them for a Docker machine, and every `docker exec` into it passes them as `-e NAME` with the value in the spawned environment.
4. After a daemon restart, task 01's re-read and its `secretUnreadable` handling apply unchanged; for a dev container, `claimOf(id)` (`plugin.ts:403`) answers from the record beside the config.

## Validation

Write each case first and see it fail against today's code, then build until it passes.

- `devcontainer.test.ts`: a need from a `{ "$secret" }` reference is absent from the override file the fake CLI read and from every argv the fake `docker` saw, and the command in the container sees it.
- The same file: a plain need is in the override's `containerEnv`.
- The same file: after the plugin is loaded again with the same fake vault, the next exec into the machine passes the vault-named value by name, read for the owner in the record beside the config.
- The same file: after the plugin is loaded again with the secret removed from the fake vault, the exec fails naming the need with no `secretUnreadable`, and runs without the variable and logs one line with `secretUnreadable: "drop"`.
- `pnpm --filter @ahpd/computer test` green.

## Resume

- Checked against the real `@devcontainers/cli@0.89.0` and Docker 29.6.2 on 2026-10-03 (`container/03` task 17): `${localEnv:NAME}` in an override's `containerEnv` is resolved from the CLI's environment and stays out of the CLI's argv and the file, but the CLI then runs `docker run -e NAME=<value>`, logs that line at the default level, and `docker inspect` keeps the value in `Config.Env`.
- So a vault-named value does not go through `up` at all; Softov, 2026-10-03, asked how a secret reaches a dev container: "Per docker exec, by name".
