---
title: The docs say how to run it in Docker
status: implemented
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

- **Done so far:** `docs/server/DOCKER.md` is written in the order the steps give: the Compose install from `raw.githubusercontent.com` at the tag and the one `chown` a volume of another uid needs, then `docker run`, then a build from a GitHub URL, then the token (never `--connection-token` in a container), the configuration through `AHPD_CONFIG`, `AHPD_PLUGINS`, the agent CLIs an ACP agent needs, a table of what changes in a container, the Docker socket as an opt-in that gives root on the host, the same-path rule for a `docker` computer, the lifecycle with upgrade and rollback, backup and restore with the clear-text warning, and the move from a host install without `node_modules`, `daemon.json` and `daemon.log`. `INSTALL.md` has one line under *Install* that points at it, `UPGRADE.md` has the image refusal under *Refusals*, the sidebar has `Docker` after `Install`, and `docs/README.md` has its row. `docs/updates/v0_15.md` has one line in *Unreleased* under *Daemon*. `.project/pending/docker-checks.md` holds the two checks CI cannot run: LAN access with `--origin` from a phone, and a `docker` computer through the socket with the same path inside and outside.
- **Next action:** review the page and run the two pending checks on a host with Docker.
- **Open questions:** none.
- **Watch out for:** Docker is denied in this mode, so no command on the page ran against `ahpd:dev`; every claim on it comes from the code and the other pages, not from a container. Step 11 says to write the pending file when the image job passes, and nothing is pushed and Docker is denied, so that gate has not run: the file is written ahead of it, and its two checks are unverified until it does. `pnpm docs:build` needs `pnpm build` first, because `docs/server/reference.data.ts` imports `packages/server/dist/commands/registry.js`. `chmod` is denied too, so `docker/entrypoint.sh` and `docker/test/smoke.sh` are mode 0644 in the tree, and the plan's own `docker/test/smoke.sh ahpd:dev` line needs them committed executable.

Files changed by this task: `docs/server/DOCKER.md`, `docs/server/INSTALL.md`, `docs/server/UPGRADE.md`, `docs/.vitepress/config.mts`, `docs/README.md`, `.project/pending/docker-checks.md`, `docs/updates/v0_15.md`.
