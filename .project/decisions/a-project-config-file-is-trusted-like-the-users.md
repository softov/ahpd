---
title: A project configuration file is trusted like the user's own
status: superseded
superseded-by: decisions/the-daemon-reads-no-project-config-file.md
date: 2026-09-28
refs:
  - "[code://packages/server/src/config.ts#L204-L226](../../packages/server/src/config.ts#L204-L226) - `loadConfig`, one file today"
  - "file:///github/cofold/packages/config/src/index.ts - `resolveConfig`, whose project layer is found upward from the working directory"
  - "[code://.project/decisions/plugin-contributes-host-options.md](plugin-contributes-host-options.md) - what a plugin named in the file may do"
---

## Context

ahpd reads its configuration through `@cofold/config`, which can merge a project file found upward from the working directory over the user's file.
Every key a project file sets is taken, `plugins` included, and naming a plugin runs its code in the daemon's process.
A daemon started inside a cloned repository would run whatever plugin that repository's file names.

## Decision

The daemon reads a project file, and every key in it counts the same as in the user's file, `plugins`, `users` and the token keys included.

Source: Softov, 2026-09-28, asked "Should ahpd read a project file found upward from the working directory?": "Yes, fully".

## Consequences

Starting `ahpd` in a directory is trusting that directory's configuration file, the same way running its build scripts is.
The startup lines say which files were read, so a project file is never applied without being named.
`--config-file` still replaces every layer, so a supervisor that names a file is not affected by the directory it starts in.

## Options

- **No project layer.** A repository can never configure the daemon; per-project settings go in `--config-file`.
- **A project file without `plugins`, `users` or the token keys.** Those three are refused from it with a warning, and the rest is taken.
