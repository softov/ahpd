---
title: A container made by an older connect is adopted by its folder
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/devcontainer.ts#L350-L375](../../packages/computer/src/devcontainer.ts#L350-L375) - `connect`, which now passes `--id-label` on every `up`"
---

## Context

`connect` from container/01 made containers with only the CLI's own `devcontainer.local_folder` label.
container/03 passes `--id-label` on every `up` and `exec`, which replaces that lookup, so an older container is not found and a second one is made beside it.

## Decision

When no container carries ahpd's labels for a folder, the plugin looks for one by the CLI's `devcontainer.local_folder` label, and adopts it by adding ahpd's labels on first use.
Source: Softov, 2026-09-26, asked "container/03: containers made by container/01's old unlabelled `connect` are not found now, so a second one is made. Adopt them?": "Adopt by folder".

## Consequences

An operator upgrading keeps the containers people already work in.
Docker cannot add a label to a running container, so adoption records the container id against the folder in the plugin's own state, or recreates the container through `up` with the labels; the task chooses after reading what the CLI does with an existing container.

## Options

- **Leave them.** The old containers are orphaned and the docs say to remove them; people lose what is inside.
