---
title: Cofold's configuration reaches a machine at a fixed target, named by a path variable
status: accepted
date: 2026-10-03
supersedes: decisions/cofold-config-reaches-a-machine-at-a-fixed-target.md
refs:
  - "[code://packages/agent-cofold/src/config.ts](../../packages/agent-cofold/src/config.ts) - `harnessConfigPath`, where agent-cofold looks for cofold's configuration"
  - "[code://packages/agent-cofold/src/agent.ts](../../packages/agent-cofold/src/agent.ts) - `machine()`, the needs a cofold machine gets"
---

## Context

The configuration was mounted read-only under `/ahpd/cofold` and an env need pointed `XDG_CONFIG_HOME` there.
`XDG_CONFIG_HOME` is also where the nested `ahpd` keeps its own folder, and it creates `$XDG_CONFIG_HOME/ahpd/usage` at start; in a machine `/ahpd/cofold` is a folder Docker made for the mount and owns as root, so a nested host running as any other user exits.
Reproduced on 2026-10-03 with a nested `ahpd --stdio` over a read-only `XDG_CONFIG_HOME`: `EACCES: permission denied, mkdir '<dir>/ahpd/usage'`.

## Decision

cofold still follows Claude's pattern: its configuration is mounted read-only at a fixed target under `computerConfigDir` (default `/ahpd/cofold`, `false` for the image's own).
An env need sets `COFOLD_CONFIG` to that file, and `harnessConfigPath()` reads `COFOLD_CONFIG` before `XDG_CONFIG_HOME`; `XDG_CONFIG_HOME` is left as the image has it.
Source: Softov, 2026-10-03, asked how cofold should find its config once `XDG_CONFIG_HOME` broke the nested host: "A cofold config path var".

## Consequences

A cofold machine works whatever user its image runs as, and the nested host keeps its own home.
No other program in the machine has its XDG configuration moved.

## Options

- Keep `XDG_CONFIG_HOME` and make `/ahpd/cofold` writable through container/05 p6's state volume: cofold in a machine needs a root image until then.
- Keep `XDG_CONFIG_HOME` and require a root image.
