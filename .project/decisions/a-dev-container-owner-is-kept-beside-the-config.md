---
title: A machine the Dev Container CLI made keeps its owner in a file beside the config, not on the container
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/computer/src/runtime.ts](../../packages/computer/src/runtime.ts) - `MACHINE_OWNER`, the labels a `docker run` machine carries"
  - "[code://packages/computer/src/devcontainer.ts#L59-L62](../../packages/computer/src/devcontainer.ts#L59-L62) - `idLabels`, the folder identity the CLI finds a container by"
---

## Context

Decision `a-machine-is-owned-by-whoever-created-it-and-pays-for-its-up-time` stores the owner with the machine so it survives a restart.
A `docker run` machine carries it as `ahpd.owner`, `ahpd.team` and `ahpd.project` labels.
The Dev Container CLI sets labels only through `--id-label`, which is also how it finds an existing container, so an owner label there would make a second container for a folder that already has one and leave the relay's folder lookup matching two.

## Decision

A machine the Dev Container CLI made keeps its owner, team and project in `computers.json` in the daemon's config folder, keyed by machine id; its id-labels stay the folder identity.
A `docker run` machine keeps its labels.
Source: Softov, 2026-10-02, asked "the Dev Container CLI can only label a container through --id-label, which is also how it finds an existing container. Where should a CLI-made machine's owner live?": "File beside config". The file name and the `configDir` the plugin context gains for it are (defaulted: the daemon's other stores live in that folder).

## Consequences

A folder keeps one container whoever brings it up, and its owner survives a daemon restart.
The owner does not travel with the container to another host, and a CLI-made container found with no entry is charged to `root:<host>`.
An entry is removed when its machine is removed.

## Options

- **The owner is part of the identity**: rejected, each owner would get their own container per folder and every folder lookup would have to name the owner.
- **No owner for CLI-made machines**: rejected, their up time would all be the host's.
