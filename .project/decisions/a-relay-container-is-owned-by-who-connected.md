---
title: A container the reopen-in-container relay makes is owned by whoever connected, and metered like any machine
status: accepted
date: 2026-10-02
refs:
  - "[code://packages/computer/src/devcontainer.ts](../../packages/computer/src/devcontainer.ts) - `devContainer`, the `ContainerPort` the relay makes containers through"
  - "[code://packages/sdk/src/types/containers.ts](../../packages/sdk/src/types/containers.ts) - `ContainerConnect`"
---

## Context

The computer plugin makes machines two ways: `computer://` creates and session sources through its runtime, and the reopen-in-container relay through the `ContainerPort` in `devcontainer.ts`.
Relay containers carry the same `ahpd.computer=1` label, so they are listed as machines, but nothing records who asked for them or when they came up.

## Decision

A container the relay makes or starts is owned by the connection that asked for it, recorded like any CLI-made machine, and its up time is a stretch like any other machine's.
Source: Softov, 2026-10-02, asked "are containers the VS Code reopen-in-container relay makes part of this plan: owned by the connecting person and metered while up?": "Yes, in this plan".

## Consequences

`ContainerConnect` carries the connection's owner, and the plugin opens a stretch when the relay brings a container up.
A relay container found that already has an owner keeps it; the first creator pays.

## Options

- **Defer the relay**: rejected, its containers would be charged to `root:<host>` with no stretch opened while the daemon runs.
