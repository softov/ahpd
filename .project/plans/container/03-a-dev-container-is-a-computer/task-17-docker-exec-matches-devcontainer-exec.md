---
title: docker exec built from the metadata label matches devcontainer exec against the real CLI
status: todo
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
