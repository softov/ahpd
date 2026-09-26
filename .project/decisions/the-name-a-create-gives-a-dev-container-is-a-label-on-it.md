---
title: The name a create gives a dev container is kept as a label on the container
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/computer/src/provider.ts#L288-L312](../../packages/computer/src/provider.ts#L288-L312) - the write, which ignores the id `run` answers"
  - "[code://packages/computer/src/runtime.ts#L502-L511](../../packages/computer/src/runtime.ts#L502-L511) - `namedByFolder`, which answers the name Docker gave"
  - "[code://test/computer-devcontainer.test.ts](../../test/computer-devcontainer.test.ts) - the create test writes `computer://box` and lists `abc123`"
---

## Context

A computer is created by a write to `computer://<name>`, and the name is the one field a client asks for itself.
The Dev Container CLI names the container, so a dev container written as `computer://box` is listed under the name Docker chose and `computer://box` answers absent.

## Decision

The name a create gives is kept as a label on the container, and the computer is listed, inspected, reached and removed by that name.
Source: Softov, 2026-09-26, asked "What should the name typed in a create become for a dev container? (a) the container's name, via `--id-label` plus a rename or name label; (b) be refused as meaningless; (c) be ignored, as now": "kept as a label on the container".

## Consequences

`computer://box` is the dev container after `computer://box` was written, and a second name for a folder that already has a computer is refused rather than answered with the existing one.
The runtime resolves an id through that label before any Docker verb, since the container's own name is the CLI's.
A dev container made for a session carries the id the host generated under the same label.

## Options

- **Rename the container to the name.** Rejected: the CLI finds its container by labels, and a label keeps the name without fighting the CLI over the container's own name.
- **Refuse a name for a dev container.** Rejected: the form asks for one, and a create that cannot be named cannot be found by the client that made it.
