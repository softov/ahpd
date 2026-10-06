---
title: A secret reaches a machine in its environment, never in its argv - implemented
date: 2026-10-05
refs:
  - git://aa1ae6c
  - "[code://packages/computer/src/byname.ts](../../../../packages/computer/src/byname.ts)"
  - "[code://packages/computer/src/runtime.ts](../../../../packages/computer/src/runtime.ts)"
  - "[code://packages/computer/src/devcontainer.ts](../../../../packages/computer/src/devcontainer.ts)"
  - "[code://packages/computer/src/plugin.ts](../../../../packages/computer/src/plugin.ts)"
  - "[code://packages/computer/src/secrets.ts](../../../../packages/computer/src/secrets.ts)"
  - "[code://packages/computer/src/owners.ts](../../../../packages/computer/src/owners.ts)"
  - "[code://packages/computer/src/manifest.ts](../../../../packages/computer/src/manifest.ts)"
---

A value given to a machine reaches `docker run` and `docker exec` as `-e NAME` with the value in the `docker` process's own environment, so `ps` on the host shows the name and not the value; only `PATH`, `HOME` and `DOCKER_*` names, which docker reads itself, stay `-e NAME=VALUE`. A value read from the vault is never given when a machine is made, on Docker or a dev container, so `docker inspect` never holds it: the daemon holds it per machine and passes it by name on every command, records only the secret names in `computers.json`, and reads them again after a restart, failing or dropping per the profile's `secretUnreadable`. A need value in the plugin's options answers `<set>`.

## What was built

- [`code://packages/computer/src/byname.ts`](../../../../packages/computer/src/byname.ts) - `byName`, which splits an env into `-e` flags and the env docker is spawned with, and `dockerOwn` (`PATH`, `HOME`, `DOCKER_*`).
- [`code://packages/computer/src/runtime.ts`](../../../../packages/computer/src/runtime.ts) - `run`, `create` and `exec` pass values by name; `madeWith` leaves vault-named variables off what a machine is made with, on both recipes; `MachineSpec.named` carries each one's need, variable and secret name.
- [`code://packages/computer/src/devcontainer.ts`](../../../../packages/computer/src/devcontainer.ts) - `execArgv` answers `{ argv, env }`, so a dev container's probe and `remoteEnv` values go by name; the relay's `connect` gives every `docker exec` it runs the machine's vault-named values.
- [`code://packages/computer/src/plugin.ts`](../../../../packages/computer/src/plugin.ts) - the held values per machine, `namedFor` for `how`, `computer_exec` and the relay, `secretUnreadable`, and need values `writeOnly`.
- [`code://packages/computer/src/secrets.ts`](../../../../packages/computer/src/secrets.ts) - `revealed` answers which needs came from the vault and from which secret; `madeAgain` reads recorded needs again; `namedAgain` reads from the agents' needs for a machine with none recorded.
- [`code://packages/computer/src/owners.ts`](../../../../packages/computer/src/owners.ts) - an entry's `needs`, written at create as need, variable and secret name.
- [`code://packages/computer/src/manifest.ts`](../../../../packages/computer/src/manifest.ts) - `Profile.secretUnreadable` and the vault-named needs on the spec.
- `docs/COMPUTER.md` Profiles and Security, `docs/CONTAINERS.md`.

## Verified

- `computer-plugin.test.ts`, `computer-needs.test.ts`, `computer-devcontainer.test.ts`, `devcontainer.test.ts`, `computer-options.test.ts` and `packages/server/test/plugin-mask.test.ts`: values by name on every argv the fake Docker and CLI saw, no `DOCKER_*` need in docker's spawn env, no vault-named value in `Config.Env`, the override, `computers.json`, an argv or a log line, `remoteEnv` by name with the stored probe unchanged, re-reads after a restart from the record and from the agents' needs, `fail` and `drop`, and `<set>`. Each new case failed against `HEAD` first.
- Docker 29.6.2 with the built runtime: `Config.Env` held only the plain variable, `exec` by name printed the vault-named one, and `ps -ww` showed only the name.
- `pnpm exec tsc --noEmit` clean; `pnpm boundary` clean; `pnpm test` 211 files, 2921 tests passed; `pnpm build` clean.

## Departures from the plan

- `byName` lives in its own `byname.ts`, re-exported by `runtime.ts`, because `devcontainer.ts` needs it and `runtime.ts` imports `devcontainer.ts`.
- The relay's `connect` was not among the plan's files; its commands are `docker exec` into the machine like the others, so it gives them the vault-named values too.
- A dev container made from a profile carries an `ahpd.profile` label, so its `secretUnreadable` and needs are found after a restart.
- A missing `computers.json` reads as empty without a log line, since every first reach after a restart now reads it.
- `claimOf` takes the record a caller already read, so a connect inspects once less.

## Left for later

- A need under a `DOCKER_*`, `PATH` or `HOME` name is docker's own and goes `-e NAME=VALUE`, so `ps` shows its value even when the vault gave it.
- The tasks stay `implemented` until Softov reviews them.
- Whether Claude's `CLAUDE_*` and `ANTHROPIC_*` variables should cross into a machine at all is p5's.
