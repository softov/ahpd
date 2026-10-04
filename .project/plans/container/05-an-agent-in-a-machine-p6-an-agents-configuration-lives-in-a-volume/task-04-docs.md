---
title: The docs say where an agent's configuration lives
status: todo
depends: [task-03-a-state-volume-is-seeded.md, task-05-identical-needs-collapse-to-one.md]
layer: "docs"
refs:
  - "[code://docs/COMPUTER.md](../../../../docs/COMPUTER.md) - Profiles, and the copy-in warning"
---

## Objective

`docs/COMPUTER.md` documents `state`, the volume names, when a seed runs, and that `host` is the old shared sign-in.
It documents `stateScope`: `"owner"`, the default, gives each owner of a profile its own state volume, a bot, automation or plugin owner included, and `"shared"` gives every owner of the profile one, for a team that wants one shared bot state.

## Files

- `UPDATE: docs/COMPUTER.md`.

## Steps

1. Replace the copy-in warning with the state volume, keeping the warning for hand-written copies.
2. Say that variants of one plugin share its state volume, and that two agents asking for the same thing at one target get it once.
3. Say that a variant's key is never in the state volume or the container's environment: it reaches the CLI on each exec from that variant's own `env`, so variants sharing a machine never see each other's key.
4. Add `stateScope` to the profile fields, with both values, both volume names and its default.

## Validation

- Read by hand against the code.

## Resume
