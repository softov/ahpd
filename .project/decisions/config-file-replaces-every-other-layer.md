---
title: --config-file replaces every other configuration layer
status: accepted
date: 2026-09-28
refs:
  - "[code://packages/server/src/config.ts#L204-L226](../../packages/server/src/config.ts#L204-L226) - `loadConfig(named)`, where a named file is the whole configuration"
  - "file:///github/cofold/packages/config/src/index.ts - `resolveConfig`, where an explicit path merges over the other layers"
---

## Context

`@cofold/config` merges an explicit path over the user file, the project file and the environment's file.
In ahpd, `--config-file` has always been the whole configuration.

## Decision

With `--config-file`, the daemon reads that file and no other: the user, project and environment layers are turned off.

Source: Softov, 2026-09-28, asked "--config-file today replaces the user file. With cofold it would merge over it. Which?": "Keep replace".

## Consequences

Tests, containers and supervisors that name a file stay isolated from `~/.config/ahpd` and from the directory they start in.
A person who wants one key changed for a run passes the flag for it, not a partial file.

## Options

- **Merge over the other layers.** A named file states only what differs, and `sourceOf` says which file set each key.
