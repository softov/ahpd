---
title: A dev container is made by the Dev Container CLI, not by Docker alone
status: accepted
date: 2026-09-24
refs:
  - "[code://packages/computer/src/runtime.ts](../../packages/computer/src/runtime.ts) - the Docker runtime this host owns, which makes a machine from a manifest"
  - "[code://.project/ideas/dev-container-sessions.md](../ideas/dev-container-sessions.md) - the reference route this plan builds"
  - "[code://.project/research/a-backend-inside-a-machine.md](../research/a-backend-inside-a-machine.md) - the two routes into a machine, and why the relay is the one that covers every backend"
  - "[code://docs/COMPUTER.md](../../docs/COMPUTER.md) - the machine a person manages, which is the other mechanism and not this one"
---

## Context

The user, 2026-09-24: "On some next step supporting the vscode/devContainers RPC is possible since we will be supporting docker... it could make it support?"

Supporting the RPC is possible, and Docker is the prerequisite, but Docker is not what makes the request answerable.
The reference client offers the flow only when the workspace has a `.devcontainer/devcontainer.json` or a `.devcontainer.json` **and** the host answers `vscode/devContainers/isDockerAvailable` true (`devContainerAgentHostConnector.contribution.ts:61-73` and `:139`).
So a `connect` request arrives with a dev container definition already found for that folder, and the folder is what the request names (`:331`).
The reference host answers it with the Dev Container CLI: `devcontainer up --log-level debug --workspace-folder <dir>` replies `{ "outcome": "success", "containerId": ..., "remoteWorkspaceFolder": ... }`, and everything after that runs through `devcontainer exec --log-level debug --workspace-folder <dir> /bin/sh -c <command>` (`devContainerAgentHostService.ts:53-55` and `:199-203`).

This host already has a Docker runtime, and it makes a machine from a manifest a person writes.
If `connect` used that, the container would come from our fields while the client, the person and the repository all believe the repository's `devcontainer.json` was read: the image, the features, the mounts, `containerEnv`, `remoteUser` and `postCreateCommand` would be silently ignored.
That is the same failure the refusal in `a-backend-reaches-a-computer-through-a-port` exists to prevent, one layer up: a session that says `computer://box` and runs somewhere else is the lie, and a session presented as a dev container that is not the repository's is the same lie with a friendlier name.

## Decision

`vscode/devContainers/connect` is answered by the Dev Container CLI, and the capability is advertised only where the CLI resolves and Docker answers.

- `isDockerAvailable` answers whether Docker can be resolved from the host's environment, which is what the reference means by it.
- `_meta['vscode.devContainers']` is `true` only when both the CLI and Docker are there, so a host that has not installed `@devcontainers/cli` advertises nothing and no client offers the flow.
- `connect` runs `devcontainer up --workspace-folder <dir>`, reads the CLI's own JSON, and refuses with the CLI's words when the outcome is not `success`.
- Every command inside the container goes through `devcontainer exec --workspace-folder <dir> /bin/sh -c <command>`, which is the CLI's contract for a command in the container its own definition made.
- The CLI is a host dependency like Docker itself, and it is not vendored or reimplemented.

## Consequences

The container is the repository's dev container, so a session inside it has the image, the features, the mounts and the environment the file asks for, and none of that is read by this host.
A host without the CLI says so by omitting the key rather than by refusing later, which is the shape `computers` already has: the capability is present only while the thing that serves it is loaded.
The flags and the parsed result are the reference's, so a CLI that changes its output is a refusal carrying its own text rather than a container we guessed at.
Two mechanisms for a session in a container now exist and they are not one: `computer://<name>` is a machine a person manages from a manifest, and a dev container is a workspace's own definition. A person may have both, and the grant that allows one is not the grant that allows the other.
The cost is a Node CLI on every host that wants this, and the acceptance case cannot run in a checkout that lacks it. Docker 29.6.2 is installed here and `devcontainer` is not, so the suite drives a fake CLI and the real case is a by-hand checklist.

## Options

- **Make the container from this host's own manifest.** Rejected: the client asked because the folder has a dev container definition, and a container built from our fields reports a dev container that is not one.
- **Implement enough of `devcontainer.json` ourselves.** Rejected: that is the Dev Container specification, features and lifecycle commands and remote users and discovery included, and a partial reading is a worse lie than a dependency.
- **Advertise the key whenever Docker answers and fall back to our own manifest.** Rejected: the fallback is invisible to the client, which is the case this decision exists to refuse.
- **Require the image to carry the host and say nothing about the container.** Rejected: that answers how a host gets inside a container and not what container the person asked for.
