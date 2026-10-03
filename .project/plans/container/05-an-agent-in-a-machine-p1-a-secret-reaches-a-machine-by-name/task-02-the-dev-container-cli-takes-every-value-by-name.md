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
---

## Objective

A value named from the vault reaches a dev container on every `docker exec` as `-e NAME`, with the value in the spawned `docker` process's environment, so it is never in an argv, the CLI's log, the override config or `docker inspect`.
A plain value goes into `containerEnv` in the override config `container/03` task 09 writes, for now.

## Files

- `UPDATE: packages/computer/src/runtime.ts` - `overrideOf` (`container/03` task 09) leaves vault-named values out of `containerEnv`; the dev container's exec builder (`container/03` task 18) passes them by name through task 01's `byName`; one function decides which values are vault-named, read from the resolved need.
- `UPDATE: packages/computer/test/fixtures/devcontainer.mjs` - the fake follows what the real CLI does with an override config: it replaces the folder's configuration rather than merging into it.
- `UPDATE: packages/computer/test/devcontainer.test.ts` - the cases below.

## Steps

1. Split a machine's resolved env in two: vault-named values, and the rest.
2. The rest goes into the override's `containerEnv` as written.
3. The vault-named values are kept in memory with the machine for its life in this daemon, never in `computers.json`, and every `docker exec` into it passes them as `-e NAME` with the value in the spawned environment, as task 01 does for `docker run`.
4. After a daemon restart, a vault-named value is read again from the vault when the machine is next reached.

## Validation

- `devcontainer.test.ts`: a need from a `{ "$secret" }` reference is absent from the override file the fake CLI read and from every argv the fake `docker` saw, and the command in the container sees it.
- The same file: a plain need is in the override's `containerEnv`.
- `pnpm --filter @ahpd/computer test` green.

## Resume

- Checked against the real `@devcontainers/cli@0.89.0` and Docker 29.6.2 on 2026-10-03 (`container/03` task 17): `${localEnv:NAME}` in an override's `containerEnv` is resolved from the CLI's environment and stays out of the CLI's argv and the file, but the CLI then runs `docker run -e NAME=<value>`, logs that line at the default level, and `docker inspect` keeps the value in `Config.Env`.
- So a vault-named value does not go through `up` at all; Softov, 2026-10-03, asked how a secret reaches a dev container: "Per docker exec, by name".
