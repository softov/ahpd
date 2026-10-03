---
title: Every command reaches a dev container by docker exec
status: todo
depends: [task-17-docker-exec-matches-devcontainer-exec.md]
layer: "computer"
refs:
  - "[code://packages/computer/src/devcontainer.ts#L49-L62](../../../../packages/computer/src/devcontainer.ts#L49-L62) - `idLabels`, shared today by `up` and `exec`"
  - "[code://packages/computer/src/devcontainer.ts#L310-L312](../../../../packages/computer/src/devcontainer.ts#L310-L312) - `inside()`, used by the probe :409, the install :424, the plugin install :445 and the config write :469"
  - "[code://packages/computer/src/devcontainer.ts#L481-L486](../../../../packages/computer/src/devcontainer.ts#L481-L486) - the relay's nested host, spawned through `devcontainer exec` with no id labels"
  - "[code://packages/computer/src/runtime.ts#L645-L696](../../../../packages/computer/src/runtime.ts#L645-L696) - `run` for a dev container, where the probe runs after `up`"
  - "[code://packages/computer/src/runtime.ts#L761-L792](../../../../packages/computer/src/runtime.ts#L761-L792) - `exec` for `computer_exec`, through the CLI for a dev container"
  - "[code://packages/computer/src/plugin.ts#L562-L620](../../../../packages/computer/src/plugin.ts#L562-L620) - `reach`: the `devcontainer exec` branch at :576-593 and the `docker exec` branch it falls through to"
  - "[code://packages/computer/src/plugin.ts#L634-L646](../../../../packages/computer/src/plugin.ts#L634-L646) - `nestedHost`, which goes through `reach`"
  - "[code://packages/computer/src/plugin.ts#L829-L854](../../../../packages/computer/src/plugin.ts#L829-L854) - where the relay launcher is built"
  - "[code://packages/computer/test/computer-devcontainer.test.ts#L245-L292](../../../../packages/computer/test/computer-devcontainer.test.ts#L245-L292) - the test that asserts the `devcontainer exec` argv"
  - "[code://packages/computer/test/fixtures/devcontainer.mjs#L92-L120](../../../../packages/computer/test/fixtures/devcontainer.mjs#L92-L120) - the fake CLI's `exec` verb"
  - "[code://packages/computer/test/fixtures/docker.mjs#L255-L259](../../../../packages/computer/test/fixtures/docker.mjs#L255-L259) - the fake Docker's `exec` verb, which answers one scripted line"
---

## Objective

The Dev Container CLI runs only `up` and `--version`; every command in a dev container, the relay's probe, installs, config write and nested host included, runs as `docker exec -u <user> -w <folder> -e ... <id>` with the user and environment derived as task 17 recorded, per [A dev container is made by the Dev Container CLI and reached by docker exec](../../../decisions/a-dev-container-is-reached-by-docker-exec.md).

## Files

- `UPDATE: packages/computer/src/devcontainer.ts` - one exported function that reads the `devcontainer.metadata` label and the kept probe into `{ user, env }`; one that runs the probe once with `docker exec`; `inside()` (:310-312) and the nested host spawn (:481-486) through `docker exec` against the container id; `idLabels` (:49-62) used by `up` only, and its comment says so.
- `UPDATE: packages/computer/src/runtime.ts:645-696` - after `up`, run the probe and keep it in the machine's `computers.json` entry, keyed by machine id, with the container id it was probed for.
- `UPDATE: packages/computer/src/owners.ts` - `probeOf(id)` and `keepProbe(id, container, env)` beside the owner's reader and writer, in the same 0600 file; they are the one place the probe is stored, so the store can change.
- `UPDATE: packages/computer/src/runtime.ts:761-792` - `exec` is `docker exec` for every machine, with `-u` and `-e` from the derivation for a dev container.
- `UPDATE: packages/computer/src/plugin.ts:576-593` - the `devcontainer exec` branch goes; a dev container takes the `docker exec` branch with `-u`, `-e` from the derivation, then the caller's `env`, and `-w` the workspace folder inside, `within(held, folder)`; task 14 adds a caller's `cwd`.
- `UPDATE: packages/computer/src/plugin.ts:829-854` - the launcher is handed the runtime's own Docker command, args and env, so the relay execs through the same Docker the listing reads.
- `UPDATE: packages/computer/test/computer-devcontainer.test.ts:245-292` - asserts the `docker exec` argv and spawns it through the fake Docker.
- `UPDATE: packages/computer/test/devcontainer.test.ts` - the relay cases assert `docker exec` lines.
- `UPDATE: packages/computer/test/fixtures/devcontainer.mjs:92-120` - the `exec` verb goes; `up` writes a `devcontainer.metadata` label with a `remoteUser` and a `remoteEnv` into the Docker fixture's machine.
- `UPDATE: packages/computer/test/fixtures/docker.mjs:255-259` - `exec` parses `-i`, `-u`, `-w` and `-e`, records them, and takes over what the fake CLI's `exec` did: the `command -v` answer, `failCommands`, the `plugin install` answer and `passthrough`; it answers the probe with a scripted environment.

## Steps

1. Write the derivation from task 17's *Resume*: the user, the probe's shell and flags, the merge of `remoteEnv` over the probe, and the `${containerEnv:...}` resolution; nothing in it is guessed past what task 17 saw.
2. Run the probe once when `up` answers a container id other than the one the kept probe names, on both roads that run `up` (the runtime's `run` and the launcher's `connect`), and rewrite the machine's entry with it.
3. A dev container with no kept probe, made before this or by a daemon that lost it, is probed on its first reach and the result kept.
4. Route `reach`, `exec`, `inside()` and the nested host spawn through the one derivation, so no road spells the `docker exec` flags a second time; `nestedHost` changes only through `reach`.
5. The relay's nested host gets its container by id, which removes its fall back to the CLI's `devcontainer.local_folder` lookup.
6. Comments that cite `a-dev-container-is-made-by-the-dev-container-cli` cite `a-dev-container-is-reached-by-docker-exec` and say what the code does: `devcontainer.ts:15` and `:375`, `runtime.ts:652` and `:768`, `plugin.ts:304` and `:827`, `packages/sdk/src/types/containers.ts:12`, `packages/sdk/src/host.ts:7525`.

## Validation

- `packages/computer/test/computer-devcontainer.test.ts`: `how()` for a dev container answers `docker exec -i -u <remoteUser> -w <folder inside> -e <probe and remoteEnv> <id> node server.mjs`, a caller's `env` comes after as `-e`, and the spawn lands in the fake Docker; today it answers `devcontainer exec`.
- The same file: `computer_exec` on a dev container runs through the fake Docker with the same flags.
- `packages/computer/test/devcontainer.test.ts`: the relay's probe, installs, config write and nested host are all `docker exec` lines against the container id, and the fake CLI records only `up`.
- The same file: a second `up` answering the same container id runs no probe; one answering a new id runs it and rewrites the `computers.json` entry; a daemon restart reads the kept probe without probing.
- `rg -n "'exec'" packages/computer/src/devcontainer.ts` finds no CLI `exec`, and `rg -n "devcontainer exec" packages/computer/src` finds nothing.
- `node_modules/.bin/vitest run packages/computer/test` and `pnpm typecheck` pass.
- By hand, against the real CLI with task 17's `nvm/` folder: a `devcontainer://` session runs `node --version` through `computer_exec` and gets nvm's Node.

## Resume
