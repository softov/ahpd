---
title: A dev container is made by the Dev Container CLI and reached by docker exec
status: accepted
date: 2026-10-02
supersedes: decisions/a-dev-container-is-made-by-the-dev-container-cli.md
refs:
  - "[code://packages/computer/src/plugin.ts#L563-L595](../../packages/computer/src/plugin.ts#L563-L595) - `reach` builds `devcontainer exec` for a dev container today"
  - "[code://packages/computer/src/devcontainer.ts#L311-L312](../../packages/computer/src/devcontainer.ts#L311-L312) - `inside()`, the relay's probe, installs and config write through the CLI"
  - "[code://packages/computer/src/runtime.ts#L767-L786](../../packages/computer/src/runtime.ts#L767-L786) - `exec` for the `computer_exec` tool"
  - https://github.com/devcontainers/cli - `exec` reads the `devcontainer.metadata` label, runs `userEnvProbe`, then calls `docker exec`
---

## Context

The superseded decision sent every command in a dev container through `devcontainer exec`.
`devcontainer exec` does not reach the container any other way: it finds the container by label, works out the user, environment and folder from the configuration and the `devcontainer.metadata` label, runs the `userEnvProbe` shell once to capture the environment, and then calls `docker exec`.
So the CLI is needed to make the container, and after that a dev container can be reached like every other machine, once its user, environment and folder are known.

## Decision

The Dev Container CLI makes the container: `devcontainer up`, read through its JSON outcome, and the capability is advertised only where the CLI resolves and Docker answers.
Every command afterwards, the relay's included, runs through `docker exec` with the user, environment and working folder read from the `devcontainer.metadata` label plus one `userEnvProbe` run when the container is made.
Source: Softov, 2026-10-02: `devcontainer up` to make it, then `docker exec`, in place of `devcontainer exec` for every command.

## Consequences

With one reach path for every machine, parts can be image mounts in a dev container too and the Node CLI is needed only at create.
The environment the probe captured is kept with the container, so it must be read again when the container is made again.
The switch is checked first against a real `@devcontainers/cli`: the environment `devcontainer exec ... env` prints must equal what `docker exec` prints with the derived user, folder and variables, for a Dockerfile definition, one with features, and one with `remoteEnv` and a login-shell `PATH`.

## Options

- Keep `devcontainer exec` for every command: a Node process per command, and parts mounted by volume only because of the CLI.
