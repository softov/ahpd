---
title: The docs say where an agent's configuration lives
status: done
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
2. Say that each provider has its own state volume, variants of one plugin included, and that two agents asking for the same thing at one target get it once.
3. Say that a variant's key is never in the state volume or the container's environment: it reaches the CLI on each exec from that variant's own `env`, so variants sharing a machine never see each other's key.
4. Add `stateScope` to the profile fields, with both values, both volume names and its default.

## Validation

- Read by hand against the code.

## Resume

- Built 2026-10-05 on cecc459.
- `docs/COMPUTER.md`: `state` and `stateScope` in Profiles, the collapse rule beside the shared-target rule, the per-variant directory under Claude Code in a machine, the copy-in warning kept for hand-written copies, and a new "Agent state" section with the volume names, the seed rules and `host` as the old shared sign-in.
- On 2026-10-06 the "Agent state" section gained the hash suffix on volume names, ownership written with `docker cp -a`, a dev container that builds its image seeded after `up` inside it, and links inside a seeded directory being skipped.
- `packages/agent-claude/README.md` names the new `computerConfigDir` default.
- The key line says a variant's key reaches the CLI per exec and never the state volume or the container's environment; that it comes from the variant's own `env` alone is p5 task 09, not built yet, so the docs do not claim it.
- `plans/index.md` is not touched by this build.
