---
title: Container - what exists today
domain: container
revalidated: 2026-10-02
---

A computer is a machine a session runs in, named `computer://<id>`, and a dev container is one of them.
The `@ahpd/computer` plugin makes and reaches machines, the SDK carries the `computers` and `containers` ports a backend and the host use, and the daemon serves VS Code's own dev container methods over the same host.

## Packages

- [`code://packages/computer`](../../../packages/computer) - the provider behind `computer://<id>` and the `computers` port; its entry point is [`code://packages/computer/src/plugin.ts`](../../../packages/computer/src/plugin.ts).
- [`code://packages/computer/src/runtime.ts`](../../../packages/computer/src/runtime.ts) - the `docker` runtime: list, inspect, run, start, stop, remove and exec, all by the `ahpd.computer=1` label.
- [`code://packages/computer/src/devcontainer.ts`](../../../packages/computer/src/devcontainer.ts) - the Dev Container CLI runner and the relay launcher: `up` with the two id labels, the host inside, and the relay's pipes.
- [`code://packages/computer/src/owners.ts`](../../../packages/computer/src/owners.ts) - `computers.json` beside the daemon's config, which holds the owner of a machine the CLI made.
- [`code://packages/sdk/src/nested.ts`](../../../packages/sdk/src/nested.ts) - the proxy a `runsNested` backend gets: an `ahpd --stdio` inside the machine, reached as a client.
- [`code://packages/sdk/src/host.ts`](../../../packages/sdk/src/host.ts) - the host, its `initialize` `_meta` block and the `vscode/devContainers/*` methods it serves.
- [`code://packages/sdk/src/listen.ts`](../../../packages/sdk/src/listen.ts) - the WebSocket and stdio transports over the same seam.

## Contracts

- [`code://packages/sdk/src/types/computers.ts`](../../../packages/sdk/src/types/computers.ts) - `Spawn`, `NestedStart`, `MachineSource` and `ComputerPort`: how a backend reaches a machine as a process.
- [`code://packages/sdk/src/types/containers.ts`](../../../packages/sdk/src/types/containers.ts) - `ContainerPort`, the relay VS Code's dev container flow drives.
- [`code://packages/computer/src/runtime.ts#L194`](../../../packages/computer/src/runtime.ts#L194) - `ComputerRuntime`, the shape every runtime implements.

## Runtimes

A profile's `runtime` names what makes the machine: `docker`, `ssh`, `libvirt` or `proxmox`, each with its own options, per [One computer: provider, the runtime named for what makes the machine](../../decisions/a-machine-runtime-is-named-for-its-maker.md).
`docker` is the one built; the container/05 plans add the others.
A machine id records which runtime made it, so several runtimes can serve one host.

## One computer, two recipes

A `docker` machine is made from an image, a manifest and the mounts a person or the deployment names.
A dev container is made from a folder's own `devcontainer.json` by the Dev Container CLI's `up`, which decides the image, the features, the mounts and the user.
A create body picks between them with a flat `source` field: `image` reads the image fields and ignores the folder, `devcontainer` requires the folder, and any other value is refused.
Both carry `ahpd.computer=1`, so both are listed, picked and reached as `computer://<id>`; a dev container also carries `ahpd.devcontainer.folder=<folder>`, which is how a listing and the picker know a folder already has its computer.
Every command in a dev container, the relay's nested host included, runs through `docker exec` with the user, environment and working folder read from the container's `devcontainer.metadata` label plus one `userEnvProbe` run when the container is made, per [A dev container is made by the Dev Container CLI and reached by docker exec](../../decisions/a-dev-container-is-reached-by-docker-exec.md).
A dev container outlives the connection and the client that made it, and destroying the computer removes the container, never the folder or its `devcontainer.json`.
A container made by hand with `devcontainer up` carries only the CLI's `devcontainer.local_folder=<folder>`, is not listed, and is adopted by a `connect` for that folder rather than duplicated; the adoption is recorded in `computers.json`, which lists it from then on.
`devcontainer.folders` names the absolute folders a dev container may be made from, compared resolved, with no list meaning any folder, and `devcontainer: false` switches every route off at once.
VS Code's dev container flow stays as a door for clients that speak it, and its `connect` finds or makes the same computer.

## Runtime path

```
create body / devcontainer://F / vscode connect -> devcontainer up --id-label ahpd.computer=1 --id-label ahpd.devcontainer.folder=F
session in computer://<id>                      -> how(id) -> docker exec -i [-u -w -e] <id> <command>
runsNested backend                              -> nested(id) -> the same how() -> ahpd --stdio inside -> nested.ts proxy
```

## Tests

`pnpm test` is network-free and may have no Docker, so the container work runs against a fake Docker and a fake CLI.
- [`code://packages/computer/test/fixtures/docker.mjs`](../../../packages/computer/test/fixtures/docker.mjs) - the fake Docker.
- [`code://packages/computer/test/fixtures/devcontainer.mjs`](../../../packages/computer/test/fixtures/devcontainer.mjs) - the fake CLI, which writes what it made into the Docker fixture so the pair read as one machine.
- [`code://packages/computer/test/computer-devcontainer.test.ts`](../../../packages/computer/test/computer-devcontainer.test.ts) and [`code://packages/computer/test/devcontainer.test.ts`](../../../packages/computer/test/devcontainer.test.ts) - the dev container computer and the relay.
- [`code://packages/sdk/test/nested-proxy.test.ts`](../../../packages/sdk/test/nested-proxy.test.ts) and [`code://packages/sdk/test/nested-start.test.ts`](../../../packages/sdk/test/nested-start.test.ts) - the nested host.

The real CLI is checked by hand; `@devcontainers/cli` 0.89.0 and Docker 29.6.2 are installed on the workstation.

## Known gaps

- An adopted container gets none of what the override config carries - read-only needs, `containerEnv`, limits, the name and agents labels - because it was made before this host knew the folder; container/03 task 15 records the choice.
- The relay serves `vscode/devContainers/isDockerAvailable`, `connect`, `disconnect` and `relaySend`, not `stop` and `remove`.
- Only the `docker` runtime exists.
