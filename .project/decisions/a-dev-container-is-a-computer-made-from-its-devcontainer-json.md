---
title: A dev container is a computer, made from its devcontainer.json
status: accepted
date: 2026-09-26
refs:
  - "[code://.project/decisions/a-dev-container-is-made-by-the-dev-container-cli.md](a-dev-container-is-made-by-the-dev-container-cli.md) - still holds: the Dev Container CLI makes it; its \"two mechanisms\" consequence is what this revises"
  - "[code://packages/computer/src/runtime.ts#L272](../../packages/computer/src/runtime.ts#L272) - computers are listed by the `ahpd.computer=1` label"
  - "[code://packages/computer/src/devcontainer.ts](../../packages/computer/src/devcontainer.ts) - the launcher that runs the CLI today, for the relay only"
---

## Context

Both a computer and a dev container are Docker containers.
They became two things because `container/01` copied VS Code's whole flow, relay included: a dev container is tied to the connection that opened it, is not listed, and vanished from ahpapp on reload.
Softov, 2026-09-26: "what diff in running a computer docker and this devcontainer? both aren't dockers? I was thinking in the beggining a devcontainer was just a map in a way vscode does to create containers".

## Decision

There is one kind of object, the computer, with two recipes: a profile, made with `docker run` (and `kvm` later), or a folder's `devcontainer.json`, made with `devcontainer up`.
A session reaches any computer the same two ways: the backend's process run inside, or a nested host (`container/04`).
The VS Code relay stays as a door for VS Code's "Use Dev Container" flow, and its `connect` finds or makes the same computer.
A computer from a `devcontainer.json` is offered both in the computer form and, for a session's folder, as a `devcontainer://<folder>` row in the picker that is made at session start.
Source: Softov, 2026-09-26, asked "Does this unified model match what you want?", answered "Yes, one computer, two recipes"; asked where it appears, answered "Both"; asked what the automatic entry looks like, answered "devcontainer://<folder> entry".

## Consequences

A dev container is listed, survives a reload, and is picked like any computer.
It is still the repository's own container: the CLI makes it and every command in it goes through `devcontainer exec`, so its user and environment apply, as the earlier decision requires.
`00-container.md`'s "two mechanisms, kept apart" is corrected.

## Options

- **Keep them apart.** What `container/01` built; two lists, two lifetimes, and a container that vanishes with its connection.
- **One computer, and drop the relay.** Simpler, and VS Code's own dev container flow would no longer be offered against this host.
