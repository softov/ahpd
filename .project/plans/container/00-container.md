---
title: Container - what exists today
domain: container
revalidated: 2026-09-24
---

There is no dev container support today, and this file is where the plan that adds it starts.
What exists is a Docker runtime behind `computer://` machines, a protocol surface that already carries VS Code's own extension methods, and a transport seam that a relay can be built on.

## What is here

- `code://packages/computer` - the Docker runtime behind `computer://<name>`: a machine a person makes from a manifest with an image, mounts and a working directory, and the `computers` port that answers how to reach one as a process.
- `code://packages/sdk/src/host.ts` - the host, its `initialize` `_meta` block, its `NEEDS`/`UNGATED` gate, and the `vscode/*` extension methods it already serves for the reference client's detached worktree flow.
- `code://packages/sdk/src/rpc.ts` - `createPeer` and `receive`, the seam every transport goes through.
- `code://packages/sdk/src/listen.ts` - the WebSocket server, which is one transport over that seam.
- `code://packages/server/src/main.ts` - the daemon: flags, config, plugins, and one `listen(...)` call.

## What is not here

- No stdio transport. The daemon has one way in, which is a WebSocket on a port.
- No dev container surface: `_meta['vscode.devContainers']` is not advertised, so the reference client does not offer its flow against this host.
- No `devcontainer` CLI dependency, and the CLI is not installed on this machine. Docker 29.6.2 is.
- No way for one host to carry another host's frames.

## The two mechanisms, kept apart

A `computer://<name>` machine comes from a manifest a person writes, is a resource that person manages, and is reached by a backend through the `computers` port.
A dev container comes from a workspace's own `devcontainer.json`, is made by the Dev Container CLI, and is reached by a *client* through a relay that carries a nested host.
They are not two spellings of one thing, and neither replaces the other. Decision `a-dev-container-is-made-by-the-dev-container-cli` is where that is argued.

## Tests

The container work is tested with a fake CLI and a fake runtime, because `pnpm test` is network-free and may have no Docker.
`code://test/fixtures/docker.mjs` is the existing pattern for a fake Docker, and the container work adds a fake `devcontainer` beside it.
