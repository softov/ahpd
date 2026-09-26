---
title: A dev container's cpus, memory and working directory reach it through the override config
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/runtime.ts#L570-L590](../../packages/computer/src/runtime.ts#L570-L590) - the `devcontainer up` argv, which drops a body's `cpus`, `memory` and `workdir`"
  - "[code://.project/decisions/read-only-needs-reach-a-dev-container-through-an-override-config.md](read-only-needs-reach-a-dev-container-through-an-override-config.md) - the override config this reuses"
---

## Context

A create body for a dev container may name `cpus`, `memory` and `workdir`, as a body for an image does, and the `devcontainer` branch of the runtime silently drops all three.
The Dev Container CLI has no flag for any of them, and it already takes an override config for the read-only needs.

## Decision

All three go through that override config: `cpus` and `memory` as `runArgs` (`--cpus`, `--memory`), and `workdir` as `workspaceFolder`.
Source: Softov, 2026-09-26, asked "container/03: a devcontainer body's cpus, memory and workdir are silently dropped today. What should happen to them?": "All via override".

## Consequences

A body means the same for either source.
The override's `runArgs` are added to the definition's own, so a definition that already sets `--cpus` gets two, and Docker takes the last; the docs say the body's value wins.

## Options

- **cpus and memory through `runArgs`, workdir refused.** Leaves a body field that works for an image and not for a folder.
- **Refuse all three.** The definition owns them; a body that names any is refused, and the form offers fields that fail.
