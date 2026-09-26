---
title: Cofold's configuration reaches a machine at a fixed target
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L541-L560](../../packages/agent-cofold/src/agent.ts#L541-L560) - `machine()`, which mounts the configuration at the host's own path"
  - "[code://packages/agent-cofold/src/config.ts#L45-L46](../../packages/agent-cofold/src/config.ts#L45-L46) - `harnessConfigPath`, read from `XDG_CONFIG_HOME` or the home directory"
  - "[code://packages/agent-claude/src/claude.ts#L72-L87](../../packages/agent-claude/src/claude.ts#L72-L87) - `computerConfigDir`, Claude's fixed target, default `/ahpd/claude`, `false` for the image's own"
  - "[code://packages/agent-claude/src/claude.ts#L382-L406](../../packages/agent-claude/src/claude.ts#L382-L406) - Claude's needs, targeted under that directory"
  - "[code://packages/sdk/src/nested.ts#L119](../../packages/sdk/src/nested.ts#L119) - the nested host started in the machine, which sets no environment of its own"
---

## Context

cofold's configuration holds the provider endpoints and keys, and a cofold session in a machine runs in a host started inside it.
The need mounts the file at the host's own path, and the host inside looks for it under the container user's `XDG_CONFIG_HOME` or home, which is a different path unless the two users match.
Claude solves the same problem with a fixed target, `/ahpd/claude`, named by its `computerConfigDir` option, and an environment variable that tells the CLI to look there.

## Decision

cofold follows Claude's pattern.
Its configuration is mounted read-only at a fixed target under `/ahpd/cofold`, named by a `computerConfigDir` option on `@ahpd/agent-cofold` that defaults to `/ahpd/cofold` and takes `false` for the image's own configuration.
An environment need points `XDG_CONFIG_HOME` at that directory, so `harnessConfigPath()` inside the machine finds the file at `/ahpd/cofold/cofold/config.json`.
Source: Softov, 2026-09-26, asked "Where cofold's config goes inside a machine: a fixed path plus `XDG_CONFIG_HOME`, or require the container user's home to match the host's?": "fixed target plus XDG_CONFIG_HOME or just like claude... patterns are important".

## Consequences

A cofold machine works whatever user its image runs as.
`XDG_CONFIG_HOME` is set for the whole machine, so any other program in it that reads XDG configuration looks under `/ahpd/cofold` too.

## Options

- **Keep the host's path and require the image user's home to match.** No new option, and an image that runs as another user cannot sign in.
- **Pass the variable on the nested host's spawn, as Claude's backend passes `CLAUDE_CONFIG_DIR`.** Scoped to the one process, and it needs an environment field on the nested start that the port does not have; the machine-need kind for a variable already exists.
