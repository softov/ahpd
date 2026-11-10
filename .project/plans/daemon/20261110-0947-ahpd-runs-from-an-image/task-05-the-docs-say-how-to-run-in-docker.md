---
title: The docs say how to run it in Docker
status: todo
depends: [task-03-compose-runs-the-image.md]
layer: "docs"
refs:
  - "[code://docs/server/INSTALL.md](../../../../docs/server/INSTALL.md) - gets one line that points at the Docker page"
  - "[code://docs/server/UPGRADE.md#L23-L34](../../../../docs/server/UPGRADE.md#L23-L34) - *Refusals*, which gets the image refusal"
  - "[code://docs/.vitepress/config.mts#L22-L40](../../../../docs/.vitepress/config.mts#L22-L40) - the sidebar"
  - "[code://docs/README.md#L13-L26](../../../../docs/README.md#L13-L26) - the list of server pages"
---

## Objective

`docs/server/DOCKER.md` tells a person how to install, run, configure, back up and upgrade ahpd in Docker.
A check by hand that CI cannot run is a file in `.project/pending/`.

## Files

- `CREATE: docs/server/DOCKER.md` - install, the token, configuration, plugins, agent CLIs, what changes in a container, lifecycle, backup and restore.
- `UPDATE: docs/server/INSTALL.md` - one line under *Install* that points at the Docker page.
- `UPDATE: docs/server/UPGRADE.md:23-34` - the image refusal under *Refusals*.
- `UPDATE: docs/.vitepress/config.mts:22-40` - `page('Docker', '/server/DOCKER')` after Install.
- `UPDATE: docs/README.md:13-26` - a row for `DOCKER.md`.
- `CREATE: .project/pending/docker-checks.md` - LAN access with `--origin` from a phone, and a `docker` computer through the socket.

## Steps

1. Write the install with Compose first: `mkdir work`, the `compose.yaml` from `raw.githubusercontent.com` at the tag, then `docker compose up -d`.
2. Write `docker run` next, then a build from the GitHub URL at a tag or a branch.
3. Say where the token is, and tell the reader never to pass `--connection-token` in a container.
4. Give the table of features that change in a container: folders, terminals, agents, each computer kind.
5. Say that the Docker socket gives root on the host.
6. Say that a folder for a `docker` computer needs the same path inside and outside.
7. Give the lifecycle: start, stop, restart, logs, health, upgrade, rollback, backup, restore, remove.
8. Give the move from a host install: copy `~/.config/ahpd` without `node_modules`, `daemon.json` and `daemon.log`.
9. Say that a backup holds the vault and the token in clear text.
10. Add the lines to `INSTALL.md`, `UPGRADE.md`, the sidebar and `docs/README.md`.
11. Write the pending file when the image job passes.

## Validation

- `pnpm docs:build` passes, and the sidebar shows Docker after Install.
- Every command on the page runs as written against `ahpd:dev`.
- `node <do-spec>/scripts/lint-prose.mjs .project/pending/docker-checks.md` passes.

## Resume

