---
title: Cofold declares its needs, at a fixed target like Claude's
status: todo
depends: [task-01-the-need-type.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/config.ts#L45-L46](../../../../packages/agent-cofold/src/config.ts#L45-L46) - `harnessConfigPath`, read from `XDG_CONFIG_HOME` or the home directory"
  - "[code://packages/agent-cofold/src/agent.ts#L553-L572](../../../../packages/agent-cofold/src/agent.ts#L553-L572) - `machine()` and its comment, which mount the file at the host's own path"
  - "[code://packages/agent-cofold/src/agent.ts#L28](../../../../packages/agent-cofold/src/agent.ts#L28) - `CofoldOptions`"
  - "[code://packages/agent-cofold/src/plugin.ts#L51-L85](../../../../packages/agent-cofold/src/plugin.ts#L51-L85) - `optionsSchema`, which has no `computerConfigDir`"
  - "[code://packages/agent-claude/src/claude.ts#L87-L96](../../../../packages/agent-claude/src/claude.ts#L87-L96) - Claude's `computerConfigDir` option"
  - "[code://packages/agent-claude/src/claude.ts#L373-L398](../../../../packages/agent-claude/src/claude.ts#L373-L398) - Claude's `machine()`, the pattern this copies"
  - "[code://packages/agent-claude/src/plugin.ts#L41-L44](../../../../packages/agent-claude/src/plugin.ts#L41-L44) - Claude's schema entry, `anyOf` a string or `false`"
  - "[code://packages/server/src/config.ts#L203-L208](../../../../packages/server/src/config.ts#L203-L208) - `ahpd` reads `XDG_CONFIG_HOME` for its own config folder too"
---

## Objective

agent-cofold's `machine()` mounts the cofold configuration read-only at `<computerConfigDir>/cofold/config.json` (default `/ahpd/cofold`), and an env need sets `XDG_CONFIG_HOME` to that directory, so a cofold host inside a machine finds its providers whatever user the image runs as.
This applies [Cofold's configuration reaches a machine at a fixed target](../../../decisions/cofold-config-reaches-a-machine-at-a-fixed-target.md).

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts:28` - `CofoldOptions` gains `computerConfigDir?: string | false`, documented as Claude's is: the directory inside a machine, `false` for the image's own configuration.
- `UPDATE: packages/agent-cofold/src/agent.ts:553-572` - `machine()` answers `cofoldConfig` (file, `harnessConfigPath()` on this host, target `<dir>/cofold/config.json`, read-only, required) and `cofoldConfigHome` (env `XDG_CONFIG_HOME`, value `<dir>`); its comment says what the two needs are.
- `UPDATE: packages/agent-cofold/src/plugin.ts:51-85` - `computerConfigDir` in `optionsSchema`, copying Claude's entry: `anyOf: [{ type: 'string' }, { const: false }]` and a description naming the default and what `false` does.
- `UPDATE: packages/sdk/test/agent-machine-needs.test.ts`, `packages/agent-cofold/test/agent-cofold-options.test.ts` - the cases below.

## Steps

1. Read how `packages/agent-claude/src/claude.ts` reads `computerConfigDir` from its options and copy that shape: same option name, same default form, same `false` meaning.
2. With `computerConfigDir: false`, `machine()` answers neither need.
3. The env need's `default` is the directory, so a profile or plugin option can still point it elsewhere through `needs`.
4. Start a cofold session in a machine with the fake container host and check the nested `ahpd` still starts with `XDG_CONFIG_HOME` pointed at `/ahpd/cofold`: it reads its own config folder from the same variable. If it needs to write there, stop and report rather than moving the target.

## Validation

- `packages/sdk/test/agent-machine-needs.test.ts`: the default answers a file need targeting `/ahpd/cofold/cofold/config.json` and an env need `XDG_CONFIG_HOME` = `/ahpd/cofold`; today the target is the host path, so the case fails.
- `computerConfigDir: '/x'` moves both; `false` answers neither.
- `packages/agent-cofold/test/agent-cofold-options.test.ts`: `optionsSchema` accepts `computerConfigDir` as a string and as `false`, and refuses a number.
- `pnpm typecheck` green.

## Resume

The first version (2026-09-26) mounted the file at the host's own path; the review found a container user with another home never reads it, and Softov chose the fixed target.
