---
title: Container - what exists today
domain: container
revalidated: 2026-09-26
---

A dev container is a computer, and this file is where the plan that made it one starts.
What exists is a Docker runtime behind `computer://` machines, a dev container made by the Dev Container CLI and reached as the same kind of object, a protocol surface that already carries VS Code's own extension methods, and a transport seam a relay is built on.

## What is here

- `code://packages/computer` - the Docker runtime behind `computer://<name>`, and the `computers` port that answers how to reach one as a process. A machine is made from an image, or from a folder's `devcontainer.json` by the Dev Container CLI, and both carry `ahpd.computer=1`.
- `code://packages/computer/src/devcontainer.ts` - the launcher and the CLI runner: `up` with the two id labels, the host inside, and the relay's pipes.
- `code://packages/sdk/src/host.ts` - the host, its `initialize` `_meta` block, its `NEEDS`/`UNGATED` gate, and the `vscode/*` extension methods it already serves for the reference client's detached worktree flow and its dev container relay.
- `code://packages/sdk/src/rpc.ts` - `createPeer` and `receive`, the seam every transport goes through.
- `code://packages/sdk/src/listen.ts` - the WebSocket server, which is one transport over that seam.
- `code://packages/server/src/main.ts` - the daemon: flags, config, plugins, and one `listen(...)` call.

## What is not here

- No stdio transport. The daemon has one way in, which is a WebSocket on a port.
- The dev container surface is advertised only while Docker and the CLI are both there, so a host without the CLI offers nothing and is never asked.
- No `devcontainer` CLI dependency, and the CLI is not installed on this machine. Docker 29.6.2 is.
- No way for one host to carry another host's frames but the dev container relay.

## One computer, two recipes

A `computer://<name>` machine is one object with two recipes.
A profile makes it from an image, a manifest and the mounts a person or the deployment names, and it is reached by a backend through the `computers` port.
A folder makes it from that folder's own `devcontainer.json`, read by the Dev Container CLI, which decides the image, the features, the mounts and the user.
Both carry `ahpd.computer=1`, so both are listed, picked and reached as `computer://<id>`; a machine made from a folder also carries `ahpd.devcontainer.folder=<folder>`, which is how a reach (`devcontainer exec`) and a listing tell it apart.
A dev container outlives the connection and the client that made it: a relay that ends leaves the container where the CLI can reuse it, and destroying the computer removes the container and never the folder or its `devcontainer.json`.
A container made by hand with `devcontainer up` and without the labels is not a computer and is not listed.
VS Code's own dev container flow stays as a door for clients that speak it, and its `connect` finds or makes the same computer.
Decision `a-dev-container-is-a-computer-made-from-its-devcontainer-json` is where this is argued, and it corrects this file's earlier "two mechanisms, kept apart".

## Tests

The container work is tested with a fake CLI and a fake runtime, because `pnpm test` is network-free and may have no Docker.
`code://test/fixtures/docker.mjs` is the existing pattern for a fake Docker, `code://test/fixtures/devcontainer.mjs` is the fake CLI, and the CLI fixture writes what it made into the Docker fixture so the pair of them read as one machine.
