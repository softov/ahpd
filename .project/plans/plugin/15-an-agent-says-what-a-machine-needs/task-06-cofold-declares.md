---
title: Cofold declares its needs, at a fixed target like Claude's
status: todo
depends: [task-01-the-need-type.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/config.ts#L45-L46](../../../../packages/agent-cofold/src/config.ts#L45-L46) - `harnessConfigPath`, read from `XDG_CONFIG_HOME` or the home directory"
  - "[code://packages/agent-cofold/src/agent.ts#L541-L560](../../../../packages/agent-cofold/src/agent.ts#L541-L560) - `machine()`, which today mounts the file at the host's own path"
  - "[code://packages/agent-claude/src/claude.ts#L72-L87](../../../../packages/agent-claude/src/claude.ts#L72-L87) - `computerConfigDir`, the pattern this copies"
---

## Objective

agent-cofold's `machine()` mounts the cofold configuration read-only at a fixed target under `computerConfigDir` (default `/ahpd/cofold`), and an env need points `XDG_CONFIG_HOME` there, so a cofold host inside a machine finds its providers whatever user the image runs as.
This follows [Cofold's configuration reaches a machine at a fixed target](../../../decisions/cofold-config-reaches-a-machine-at-a-fixed-target.md).

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts` - `CofoldOptions` gains `computerConfigDir?: string | false`, documented like Claude's; `machine()` answers the file need at `<dir>/cofold/config.json` and an env need `XDG_CONFIG_HOME=<dir>`.
- `UPDATE: packages/agent-cofold/src/plugin.ts` - the option is read from the plugin's options, as Claude's plugin reads its own.
- `UPDATE: test/agent-machine-needs.test.ts` - the cases below.

## Steps

1. Read how `packages/agent-claude/src/claude.ts` declares `computerConfigDir` and its needs, and copy that shape: same option name, same `false` meaning "the image's own configuration", same kind of description.
2. With `computerConfigDir: false`, `machine()` answers no config need and no env need.
3. The file need keeps `required: true`, `readOnly: true` and the description saying it holds the provider keys.

## Validation

- `test/agent-machine-needs.test.ts`: the default answers a file need targeting `/ahpd/cofold/cofold/config.json` and an env need `XDG_CONFIG_HOME` = `/ahpd/cofold`; today the target is the host path, so the case fails.
- `computerConfigDir: '/x'` moves both; `false` answers neither.
- `pnpm typecheck` green.

## Resume

The first version (2026-09-26) mounted the file at the host's own path; the review found a container user with another home never reads it, and Softov chose the fixed target.
