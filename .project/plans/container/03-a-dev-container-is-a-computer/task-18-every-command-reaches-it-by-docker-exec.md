---
title: Every command reaches a dev container by docker exec
status: done
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
6. Comments that cite `a-dev-container-is-made-by-the-dev-container-cli` cite `a-dev-container-is-reached-by-docker-exec` and say what the code does: `devcontainer.ts:15` and `:375`, `runtime.ts:652` and `:768`, `plugin.ts:304` and `:827`, `packages/sdk/src/types/containers.ts:12`, `packages/sdk/src/host/handshake.ts:259`.

## Validation

- `packages/computer/test/computer-devcontainer.test.ts`: `how()` for a dev container answers `docker exec -i -u <remoteUser> -w <folder inside> -e <probe and remoteEnv> <id> node server.mjs`, a caller's `env` comes after as `-e`, and the spawn lands in the fake Docker; today it answers `devcontainer exec`.
- The same file: `computer_exec` on a dev container runs through the fake Docker with the same flags.
- `packages/computer/test/devcontainer.test.ts`: the relay's probe, installs, config write and nested host are all `docker exec` lines against the container id, and the fake CLI records only `up`.
- The same file: a second `up` answering the same container id runs no probe; one answering a new id runs it and rewrites the `computers.json` entry; a daemon restart reads the kept probe without probing.
- `rg -n "'exec'" packages/computer/src/devcontainer.ts` finds no CLI `exec`, and `rg -n "devcontainer exec" packages/computer/src` finds nothing.
- `node_modules/.bin/vitest run packages/computer/test` and `pnpm typecheck` pass.
- By hand, against the real CLI with task 17's `nvm/` folder: a `devcontainer://` session runs `bash -lic 'node --version'` through `computer_exec` and gets nvm's Node (nvm loads from `~/.bashrc`, which only an interactive shell reads); a plain `node --version` fails there under the real CLI too, because that folder's `remoteEnv.PATH` replaces the probe's `PATH` (task 17).

## Resume

Implemented on 2026-10-03 from task 17's derivation, which ran that day against `@devcontainers/cli` 0.89.0 and Docker 29.6.2; task 17's Resume was read whole first and nothing here is re-derived from it.

**What is where**

- `devcontainer.ts`: `Probe`, `Reach` and `execArgv` are the derivation's three exported shapes; `reachOf(found, probe)` reads the `devcontainer.metadata` label into a user and an environment, `probeEnv(docker, found)` runs the probe, and `workdirOf(found)` reads the remote workspace folder back out of the mount the CLI made. `inside()` and the nested host spawn both go through `execArgv` against the container id, and `DevContainerOptions.docker` is now a `Cli` rather than a program name, because the launcher no longer looks a program up on its own.
- `runtime.ts`: `reachedDevContainer(options, id, found)` is the glue - inspect, read the kept probe, probe when it does not name this container, keep it. It lives here and not in `devcontainer.ts` because `devcontainer.ts` cannot import `owners.ts` without a cycle through `runtime.ts`.
- `owners.ts`: `probeOf` and `keepProbe` beside `ownedOf`/`claimOwned`, in the same 0600 file, as one `Entry` that carries either half.
- `plugin.ts`: the `devcontainer exec` branch is gone; the dev container takes the same branch as any other machine, with the derivation's `-u` and `-e` before the caller's own and `-w` from `within(held, cwd)` else the folder inside.

**Choices the task did not settle**

- Every command carries `-w`, the launcher's own included: `reachOf` reads the workspace folder inside back out of the mount, and `execArgv` puts it on every argv, as the CLI's own `exec` does.
- The probe is taken after `up` and before the launcher's install, and once per connect rather than once per command - the container is the thing it describes, not the command.
- A probe that cannot be answered (no `getent`, a shell that refuses, no `/proc`) answers an empty environment and logs one line. `docker exec` would run with whatever it has, so refusing the whole connect would be worse than the command running under less than it was owed.

**By hand, run on 2026-10-03** against the real CLI with task 17's `nvm/` folder: the build's `computer_exec` of `env` matched `devcontainer exec ... env` for all three of task 17's definitions, and `bash -lic 'node --version'` printed `v22.23.3` through both, where `bash -lc` failed through both with `node: command not found`. The commands, for a rerun:

```sh
devcontainer up --workspace-folder <nvm-folder> \
  --id-label ahpd.computer=1 \
  --id-label "ahpd.devcontainer.folder=<nvm-folder>" --log-level debug
docker inspect --format '{{json .}}' <containerId> \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["Config"]["Labels"]["devcontainer.metadata"])'
docker exec -i -u vscode <containerId> getent passwd vscode
docker exec -i -u vscode <containerId> bash -lic 'echo -n MARK; cat /proc/self/environ; echo -n MARK'
```

Then a `devcontainer://` session, with a `computer_exec` of `bash -lic 'node --version'` answering nvm's Node and a plain `node --version` failing in that folder, because its `remoteEnv.PATH` replaces the probe's `PATH` (task 17).

### The fix turn of 2026-10-05

The real-CLI run of 2026-10-03 found one container keyed under three probe entries, a need's value written to `computers.json`, and values leaking through the relay. What changed:

- `packages/computer/src/devcontainer.ts` - `probeKept(found, container, env)` keeps only the variables whose value the container's `Config.Env` does not already hold, the rule `execArgv` follows, and both roads that keep a probe go through it, so no `containerEnv` value is written to `computers.json` (Softov, 2026-10-05, a row in the plan's answer table). The relay resolves `${localEnv:...}` from the environment the CLI is spawned with, its `env` option included. `masked` reads a line at a time and masks a quoted value whole, and `maskedLines` holds a partial line until it completes, so a `-e K=V` cut across two reads of the CLI's output no longer leaks. The `container/05-p1` citation on `execArgv` is gone.
- `packages/computer/src/runtime.ts` - `computer_exec` on a dev container runs `docker exec` against the container id, as `how` and the relay do, rather than against the Docker name. `configOf` runs before the override directory is made, so a definition that does not parse is refused in its own words rather than as a CLI to install, and nothing is left behind. `reachedDevContainer` keeps the stripped probe.
- Tests: `computer-devcontainer.test.ts` "gives a command run after the create a need's variable" (the value is in the machine's environment, in no command's `-e`, in no argv and not in `computers.json`), "runs `computer_exec` on it with the same flags" (id `abc123`), "rewrites the kept probe when up answers another container", "reads the kept probe back after a restart, and runs no probe for it", "keeps no probe that answered nothing, and probes again", "refuses a definition that does not parse in its own words", "masks the values in the error a failed up is refused with"; `devcontainer.test.ts` "resolves a localEnv reference from the environment the CLI is spawned with", "falls back to a localEnv reference's default", "masks a value cut across two reads, and a quoted one whole" (with the echoed commands showing `-e NAME` only), "masks the values in the error a failed up is refused with", and the `-w` on the relay's own commands in "reaches every command by the id". `computer-owner.test.ts` and `computer-uptime.test.ts` now expect the container id `abc123` apart from the Docker name and the record under the listing's name.
- Failed before the fix: the need-variable, `computer_exec`, localEnv, masking and definition-parse cases. The restart, failed-probe, rewrite, failed-`up` masking, localEnv default and `-w` cases cover fixes that were already in the code and passed when written.
