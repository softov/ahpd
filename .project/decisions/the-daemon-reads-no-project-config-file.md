---
title: The daemon reads no project configuration file
status: accepted
date: 2026-09-28
supersedes: decisions/a-project-config-file-is-trusted-like-the-users.md
refs:
  - "file:///github/cofold/.project/plans/commands/02-a-program-chooses-its-config-layers/plan.md - the project layer is off unless the program names a file"
  - "[code://packages/server/src/config.ts#L204-L226](../../packages/server/src/config.ts#L204-L226) - `loadConfig`, where the layers are chosen"
---

## Context

`@cofold/config` can merge a project file found upward from the working directory, and after cofold commands/02 a program turns that layer on by naming the file.
A project file may name plugins, and naming a plugin runs its code in the daemon.

## Decision

The daemon does not turn the project layer on. It reads the user file, the file `$AHPD_CONFIG` names, or `--config-file` alone.
Turning it on later is one option in `loadConfig`, when a need for it appears.

Source: Softov, 2026-09-28, after asking for the workspace config to be opt-in: "so if necessary in a future we enable".

## Consequences

Starting `ahpd` inside a repository never reads a configuration from that repository.
Per-project settings go through `--config-file` or `$AHPD_CONFIG`.

## Options

- **Read `ahpd.json` fully trusted** (the superseded decision).
- **Read it only with a flag or a key in the user file.** Not needed until somebody asks for per-project files.
