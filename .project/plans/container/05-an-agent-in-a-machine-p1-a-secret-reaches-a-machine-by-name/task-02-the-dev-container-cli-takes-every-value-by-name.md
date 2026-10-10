---
title: A vault-named value reaches a dev container on each docker exec, by name
status: done
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

Implemented on 2026-10-05.

Files changed:

- `packages/computer/src/runtime.ts` - `overrideOf` writes `madeWith(spec)` into `containerEnv`, so a vault-named variable is never in the override file, the CLI's `docker run` or `Config.Env`; it also writes `--label ahpd.profile=<profile>` into `runArgs`, so a dev container made from a profile is read again with that profile's needs and `secretUnreadable` after a restart.
- `packages/computer/src/plugin.ts` - a dev container's `how` and `computer_exec` take the held values exactly as a Docker machine's do; `claimOf` answers from the record beside the config.
- `packages/computer/src/devcontainer.ts` - `DevContainerOptions.named`, which the plugin fills with `namedFor`; a relay `connect` asks it once and gives every `docker exec` it runs (the probe for the host, the installs, the config write and the host itself) the values by name. `execArgv` answers `{ argv, env }`: the probe and `remoteEnv` values that differ from `Config.Env`, and the asked ones, go through `byName`, so a `${localEnv:NAME}` value is in no argv; `inside`, the relay's host, `reach` (`how`) and `runtime.exec` (`computer_exec`) spawn docker with that env. The probe kept in `computers.json` is unchanged.

Tests: "keeps a vault-named need out of the override and every argv, and gives it on each docker exec" and "reads a dev container's vault-named need again after a restart, for the owner in its record" in `computer-devcontainer.test.ts`, "passes a remoteEnv value by name to every command, and keeps it out of the stored probe" and the updated "reaches it by docker exec"; "gives a remoteEnv value pulled from this host by name, on every command", "gives every command a connect runs the computer's vault-named variables, by name" and "refuses a connect whose computer cannot be given its vault-named variables" in `devcontainer.test.ts`. Each failed against `HEAD`. `claimOf` takes the record a caller already read, so a connect inspects the container once less; "finds an adopted container again" took 4.2 s on `HEAD` and timed out at its 5 s limit with one more `inspect` per connect.

Differences from the plan:

- The create cases are in `computer-devcontainer.test.ts`, where the plugin is loaded with both fakes; `devcontainer.test.ts` tests the relay alone and has the relay's two cases.
- The fake CLI already replaced the folder's configuration with the override rather than merging it (container/03), so it is unchanged.
- The relay was not in the plan's files; it is a `docker exec` into the machine like the others, and before this its host inherited the value from `containerEnv`, so leaving it out would have dropped the value from a relayed host.
- The `secretUnreadable: "drop"` case uses a dev container made from the form with a profile, since a `devcontainer://` session has no profile and so always fails.
