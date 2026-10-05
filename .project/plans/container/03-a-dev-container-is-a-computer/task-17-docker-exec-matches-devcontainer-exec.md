---
title: docker exec built from the metadata label matches devcontainer exec against the real CLI
status: implemented
depends: []
layer: "manual"
refs:
  - "[code://packages/computer/src/devcontainer.ts#L59-L62](../../../../packages/computer/src/devcontainer.ts#L59-L62) - `idLabels`, the pair every `up` passes"
  - "[code://packages/computer/src/plugin.ts#L210-L224](../../../../packages/computer/src/plugin.ts#L210-L224) - `within`, checked here as the source of `-w`"
  - npm://@devcontainers/cli@0.89.0 - the CLI whose `exec` is the reference
  - https://containers.dev/implementors/json_reference/ - `remoteUser`, `remoteEnv`, `userEnvProbe` and `${containerEnv:...}`
---

## Objective

It is known, from a real `@devcontainers/cli` and a real Docker, that `docker exec -u <remoteUser> -w <workspaceFolder> -e ...` built from the `devcontainer.metadata` label plus one `userEnvProbe` run prints the same environment as `devcontainer exec ... env`, and the exact `docker exec` argv the CLI builds is recorded, so task 18 copies a derivation that was seen rather than guessed.

## Files

- `UPDATE: .project/plans/container/03-a-dev-container-is-a-computer/task-17-docker-exec-matches-devcontainer-exec.md` - the result, in *Resume*.

No code and no `package.json` changes: the CLI is installed for this check only.

## Steps

1. Install the CLI into a scratch folder, not into the repository and not from the workstation's global copy: `npm i --prefix "$T/cli" @devcontainers/cli@0.89.0`, and run it as `"$T/cli/node_modules/.bin/devcontainer"`.
2. Write three definitions under `$T`, each a folder with `.devcontainer/devcontainer.json`:
   - `dockerfile/`: a `Dockerfile` `FROM debian:trixie-slim` that adds a user `dev` with `/bin/bash`, and `{ "build": { "dockerfile": "Dockerfile" }, "remoteUser": "dev" }`.
   - `features/`: `"image": "mcr.microsoft.com/devcontainers/base:debian"` with the features `ghcr.io/devcontainers/features/common-utils:2` and `ghcr.io/devcontainers/features/go:1`, so the user and part of the environment come from features through the label.
   - `nvm/`: the same base image, `"remoteEnv": { "FOO": "bar", "PATH": "${containerEnv:PATH}:/opt/extra" }`, and a `postCreateCommand` that installs nvm and a Node into `~/.nvm`, so `node` is on the `PATH` only in a login shell.
3. For each folder `F`, run `devcontainer up --workspace-folder F --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=F` and keep `containerId` and `remoteWorkspaceFolder` from its JSON.
4. Run `devcontainer exec --log-level trace --workspace-folder F --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=F env` and keep its output sorted; from the trace, copy the probe command it ran and the `docker exec` argv it built.
5. Read `docker inspect --format '{{ index .Config.Labels "devcontainer.metadata" }}' <id>` and derive by hand: the user (`remoteUser`, else `containerUser`, else the image's), `userEnvProbe` (default `loginInteractiveShell`), and `remoteEnv` merged in label order.
6. Run the probe once as the CLI ran it, through `docker exec -u <user> <id> ...`, and keep the environment it printed.
7. Build `docker exec -u <user> -w <remoteWorkspaceFolder> -e <probe merged with remoteEnv> <id> env`, sort it, and diff it with step 4.
8. Check that `within` on the `docker inspect` record maps `F` to `remoteWorkspaceFolder` for all three.
9. Check whether a variable passed as `up --remote-env X=1` appears in a later `devcontainer exec env` and in a plain `docker exec env`, and whether a variable in an override config's `containerEnv` appears in both, which confirms the `containerEnv` route task 09 builds; check also whether `${localEnv:NAME}` in `containerEnv` is resolved from the CLI's own environment, which `container/05-p1` task 02 reads.
10. Note where the CLI keeps a probe result between two `exec` calls, so task 18's `computers.json` store does not disagree with one the CLI keeps itself.
11. Remove the three containers with `docker rm -f` and the scratch folder.

## Validation

- *Resume* has, for each definition, the CLI's `docker exec` argv, the probe command, and a diff that is empty or lists each variable that differs with the reason (one the CLI's own process sets, for example).
- *Resume* states the derivation rule task 18 implements: which user, how `remoteEnv` is merged over the probe, how `${containerEnv:...}` and `${localEnv:...}` are resolved, and which folder `-w` takes.
- *Resume* answers steps 9 and 10, with the command that shows it.

## Resume

Run on 2026-10-03 with `@devcontainers/cli@0.89.0` installed with npm into a scratch folder, Docker 29.6.2 and buildx 0.35.0 on Debian 13.

**Results that contradict the plan.**
The `nvm/` definition does not put nvm's `node` on the `PATH` for `devcontainer exec`: `remoteEnv.PATH` set to `${containerEnv:PATH}:/opt/extra` replaces the probe's `PATH` (which had `/home/vscode/.nvm/versions/node/v22.23.3/bin`) instead of extending it, so `devcontainer exec ... node --version` fails with `exec: "node": executable file not found in $PATH`, and only `bash -lic 'node --version'` prints `v22.23.3`.
So task 18's by-hand check ("a `devcontainer://` session runs `node --version` through `computer_exec` and gets nvm's Node" with the `nvm/` folder) fails when `docker exec` matches the CLI exactly; it needs a definition without a `remoteEnv.PATH`, or the check must expect the failure.
`--override-config` replaces the folder's `devcontainer.json` rather than merging with it: an override holding only `containerEnv` fails with `Dev container config (.../.devcontainer/devcontainer.json) is missing one of "image", "dockerFile" or "dockerComposeFile" properties.`, so task 09 step 1 ("write only the keys this adds") cannot be done, and the override must be the folder's whole config plus the added keys.
A full override placed in another folder still builds `"build": { "dockerfile": "Dockerfile" }` from the workspace's `.devcontainer/`, because the CLI resolves paths against the workspace's config path, not the override's.
`${localEnv:NAME}` in an override's `containerEnv` keeps the value out of the CLI's argv and out of the override file, but not out of every argv: the CLI resolves it and runs `docker run ... -e Z=<value> ...`, so the value is in Docker's own argv, in the CLI's stderr log at the default `info` level (the `Start: Run: docker run ...` line), and in `docker inspect`'s `Config.Env`; container/05-p1 task 02 step 2's condition "the value stays out of argv" holds only for the CLI's argv.
`devcontainer exec` in 0.89.0 has no `--container-session-data-folder` (it answers `Unknown arguments: container-session-data-folder`), so the CLI never reads a cached probe on `exec`.
Step 4 asks to copy the `docker exec` argv from the trace, but `--log-level trace` logs only `Run in container: <command>` and never the `docker exec` argv; the argv below was captured with `--docker-path` pointing at a shim that logged its arguments and then ran `/usr/bin/docker`.

**How the CLI's `exec` runs, for every definition.**
It finds the container with `docker ps -q -a --filter label=ahpd.computer=1 --filter label=ahpd.devcontainer.folder=<F>`, then `docker inspect --type container <id>`.
It starts one shell server as `docker exec -i -u <user> -e VSCODE_REMOTE_CONTAINERS_SESSION=<uuid> <id> /bin/sh` and runs `uname -m`, the os-release read and `getent passwd '<user>'` through it; the login shell field of that passwd line is the probe's shell.
It runs the probe as its own `docker exec -i -u <user> <id> <shell> -lic 'echo -n <uuid>; cat /proc/self/environ; echo -n <uuid>'`, splits the output on NUL between the markers, and drops `PWD`.
It runs the command as `docker exec -i -u <user> -e K=V ... -w <remoteWorkspaceFolder> <id> <command...>`, with the probe's variables in the probe's order, then `remoteEnv` keys overwriting in place or appended.
`VSCODE_REMOTE_CONTAINERS_SESSION` is set only on the shell server, never on the command, so no variable of the CLI's own process reaches the command.

**dockerfile/** (`remoteUser: dev`, label `[ {"remoteUser":"dev"} ]`, `remoteWorkspaceFolder` `/workspaces/dockerfile`).
Probe: `docker exec -i -u dev <id> /bin/bash -lic 'echo -n <uuid>; cat /proc/self/environ; echo -n <uuid>'`.
CLI argv: `docker exec -i -u dev -e HOSTNAME=88ae23c97b41 -e HOME=/home/dev -e LS_COLORS= -e SHLVL=1 -e PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin -e _=/usr/bin/cat -w /workspaces/dockerfile <id> env`.
Diff of the sorted `devcontainer exec ... env` against the sorted derived `docker exec ... env`: empty.

**features/** (base image's label gives `{"remoteUser":"vscode"}`, the features add no user and no `remoteEnv`; `GOROOT`, `GOPATH` and the Go `PATH` come from the image's `Config.Env`, `remoteWorkspaceFolder` `/workspaces/features`).
Probe: `docker exec -i -u vscode <id> /bin/bash -lic 'echo -n <uuid>; cat /proc/self/environ; echo -n <uuid>'`.
CLI argv: `docker exec -i -u vscode -e HOSTNAME=3192bdacbf18 -e HOME=/home/vscode -e LANG=C.UTF-8 -e LS_COLORS= -e GOROOT=/usr/local/go -e USER=vscode -e SHLVL=1 -e PROMPT_DIRTRIM=4 -e PATH=/usr/local/go/bin:/go/bin:/usr/local/go/bin:/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/vscode/.local/bin -e GOPATH=/go -e _=/usr/bin/cat -w /workspaces/features <id> env`.
Diff: empty; the doubled Go entries in `PATH` are the login shell's own and the CLI passes them through unchanged.

**nvm/** (label ends with `{"postCreateCommand":...,"remoteEnv":{"FOO":"bar","PATH":"${containerEnv:PATH}:/opt/extra"}}`, unresolved, `remoteWorkspaceFolder` `/workspaces/nvm`).
Probe: `docker exec -i -u vscode <id> /bin/bash -lic 'echo -n <uuid>; cat /proc/self/environ; echo -n <uuid>'`, whose `PATH` starts with `/home/vscode/.nvm/versions/node/v22.23.3/bin`.
CLI argv: `docker exec -i -u vscode -e NVM_INC=/home/vscode/.nvm/versions/node/v22.23.3/include/node -e HOSTNAME=e1fef0f005a0 -e HOME=/home/vscode -e LANG=C.UTF-8 -e LS_COLORS= -e NVM_DIR=/home/vscode/.nvm -e USER=vscode -e SHLVL=1 -e NVM_CD_FLAGS= -e PROMPT_DIRTRIM=4 -e PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/extra -e NVM_BIN=/home/vscode/.nvm/versions/node/v22.23.3/bin -e _=/usr/bin/cat -e FOO=bar -w /workspaces/nvm <id> env`.
Diff: empty, and the `PATH` lacking nvm's `bin` is the CLI's own result, as said at the top.

**Derivation rule for task 18.**
The user is the last `remoteUser` in the `devcontainer.metadata` label array, else the last `containerUser`, else the image's `Config.User`, else `root`.
The probe mode is the last `userEnvProbe` in the label, default `loginInteractiveShell`, mapped to flags `-lic`, `-lc` for `loginShell`, `-ic` for `interactiveShell`, and no probe for `none`.
The probe's shell is the seventh field of `getent passwd <user>` run in the container, and the probe is `docker exec -i -u <user> <id> <shell> <flags> 'echo -n <marker>; cat /proc/self/environ; echo -n <marker>'`, parsed as NUL-separated `K=V` between the markers, with `PWD` removed.
The CLI does no `PATH` merge of its own on `exec` (its merge is skipped when it may patch `/etc/profile`, which `up` already did and marked in `/var/devcontainer/.patchEtcProfileMarker`), so the probe's `PATH` is taken as printed.
`remoteEnv` is the label entries' `remoteEnv` objects merged in label order, later keys winning, laid over the probe so a `remoteEnv` key replaces the probe's value in place.
`${containerEnv:NAME}` resolves from the container's `Config.Env` as `docker inspect` gives it, not from the probe.
`${localEnv:NAME}` in `remoteEnv` stays unresolved in the label and is resolved at every `exec` from the environment of the process running it, to an empty string when unset: with `LOC_A=exec-value` the command saw `L=exec-value` although `up` ran with `LOC_A=up-value`, and with `LOC_A` unset it saw `L=`.
So ahpd resolves `${localEnv:...}` from the environment it would have spawned the CLI with, at the time of the command.
`-w` takes `remoteWorkspaceFolder` from `up`'s JSON, which is `/workspaces/<basename of F>` here.
A script applying this rule (`docker exec -i -u <user> -e <probe merged with remoteEnv> -w <remoteWorkspaceFolder> <id> env`) printed exactly the CLI's environment for all three definitions.

**Step 8.**
The logic of `within` in `packages/computer/src/plugin.ts`, run on each `docker inspect` record, maps `F` to `/workspaces/dockerfile`, `/workspaces/features` and `/workspaces/nvm`, equal to `remoteWorkspaceFolder` in all three, from the single bind mount `type=bind,source=F,target=/workspaces/<name>` the CLI adds.

**Step 9.**
Shown with `SECRET_Z=<value> devcontainer up --workspace-folder F9 --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=F9 --remote-env X=1 --override-config ov/full.json`, where `ov/full.json` is `{ "build": { "dockerfile": "Dockerfile" }, "remoteUser": "dev", "containerEnv": { "Y": "2", "Z": "${localEnv:SECRET_Z}" } }`, followed by `devcontainer exec ... env` and `docker exec -u dev <id> env`.
`X` from `up --remote-env X=1` appears in neither the later `devcontainer exec env` nor a plain `docker exec env`: it reaches `up`'s lifecycle commands only.
`Y` and `Z` from the override's `containerEnv` appear in both, which confirms the `containerEnv` route task 09 builds.
`${localEnv:SECRET_Z}` is resolved from the CLI's own environment at `up`: the override file's sha256 was unchanged afterwards and the CLI's argv held no value, but the CLI ran `docker run ... -e Y=2 -e Z=<value> ...`, logged that line, and the container's `Config.Env` holds `Z=<value>`, while the label keeps `"Z":"${localEnv:SECRET_Z}"` unresolved.

**Step 10.**
The CLI keeps a probe result only when `up` is given `--container-session-data-folder <dir>`, and then inside the container, at `<dir>/env-<userEnvProbe>.json` (here `/tmp/dc-session/env-loginInteractiveShell.json`, owned by the remote user, mode 0644, `PWD` already removed).
It writes it only when `up` waits for the probe, which happens when a lifecycle command runs; an `up` with no lifecycle command exits before the probe ends and writes nothing.
A second `up --container-session-data-folder /tmp/dc-session` read it (no `userEnvProbe: not found in cache` line), while `devcontainer exec` rejects the flag and probed again on every call (`userEnvProbe: not found in cache` each time).
Shown with `devcontainer up --log-level trace --container-session-data-folder /tmp/dc-session ...` twice on a definition with `"postStartCommand": "true"`, then `docker exec <id> ls -la /tmp/dc-session`.
ahpd passes no such flag, so the CLI keeps no probe of its own and task 18's `computers.json` entry is the only store.

**Image mount through `up`.**
`--mount type=image,...` in an override config's `runArgs` works with Docker 29 through `devcontainer up`: with `"runArgs": ["--mount", "type=image,source=busybox:latest,target=/opt/bb"]` the CLI passed it to `docker run`, `docker inspect` showed a mount of `Type: image`, `RW: false`, `docker exec -u dev <id> /opt/bb/bin/busybox echo image-mount-works` printed its line, and a write to `/opt/bb` failed with `Read-only file system`.
The source image must already be in the local image store: with `busybox` absent, `docker run` did not pull it and failed with `pull access denied for vsc-<name>-uid`, naming the container's image instead of the missing mount source, so container/05 p4 must pull the source before `up`.
In `docker inspect` an image mount's `Source` is a path under `/var/lib/docker/rootfs/overlayfs/`, which `within` never matches against a host working directory.

**Cleanup.**
The containers made here and the `vsc-*` images built for them were removed with `docker rm -f` and `docker rmi`, and the scratch folder was deleted; `busybox:latest` was pulled for the image mount and kept, and the base images were pulled by buildx into its cache, not the image store.
