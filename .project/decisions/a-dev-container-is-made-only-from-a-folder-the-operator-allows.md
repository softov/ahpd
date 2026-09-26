---
title: A dev container is made only from a folder the operator allows, and devcontainer false turns every route off
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/manifest.ts#L372-L404](../../packages/computer/src/manifest.ts#L372-L404) - `devcontainerOf`, which checks only that the folder exists and has a definition"
  - "[code://packages/computer/src/plugin.ts#L230-L247](../../packages/computer/src/plugin.ts#L230-L247) - the `devcontainer` option, whose `false` switches off only the launcher"
  - "[code://packages/computer/src/plugin.ts#L471-L505](../../packages/computer/src/plugin.ts#L471-L505) - the `devcontainer://` session-time create"
  - "[code://packages/computer/src/plugin.ts#L685-L693](../../packages/computer/src/plugin.ts#L685-L693) - the picker row"
  - "[code://docs/COMPUTER.md](../../docs/COMPUTER.md) - says a `devcontainer` source is not gated by `bodyMounts`"
---

## Context

A dev container's `devcontainer.json` decides its image, its mounts, its `runArgs` and its `initializeCommand`, which runs on this host.
The deployment limits a machine made from an image with the `images` allowlist and limits the host paths a body may name with `bodyMounts`, but a `devcontainer` source reaches neither: any folder with a definition is made.
The plugin's `devcontainer: false` switches off the VS Code relay only; the session-time create and the picker row stay on, even on a host without the CLI, while `docs/CONTAINERS.md` says the option switches the whole thing off.

## Decision

The computer plugin takes an allowlist of folders for dev containers, and a folder outside it is refused on every route: a create body, a `devcontainer://` session setting, the picker row and the relay's `connect`.
`devcontainer: false` turns off every dev container route: the launcher, the session-time create and the picker row.
With no allowlist configured, any folder is allowed, as an unset `images` allows any image; `devcontainer: false` is how an operator turns them off.
Source for the unset case: Softov, 2026-09-26, asked "container/03: with no folder allowlist configured, which folders may a dev container be made from?": "Any folder".
Source: Softov, 2026-09-26, asked "Should dev containers respect the operator's limits? (a) gated by `bodyMounts` / a new `devcontainers` allowlist of folders; (b) `devcontainer: false` disables every route; (c) keep the ungated behaviour": "an allowlist of folders, and `devcontainer: false` turns off every route".

## Consequences

An operator who limits images can also limit which repositories this host builds containers from.
The picker offers the row only for a folder the list allows, and never when dev containers are off.
`docs/CONTAINERS.md` and `docs/COMPUTER.md` must say what the list is and what `false` turns off.

## Options

- **Gate a dev container by `bodyMounts`.** Rejected: `bodyMounts` is about paths a body names, and a folder's definition is a recipe, so one switch would allow either too much or nothing.
- **Leave dev containers ungated.** Rejected: it lets a body reach whatever a folder's definition declares, around every limit the operator set.
