---
title: Cofold declares its needs
status: todo
depends: [task-01-the-need-type.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/config.ts#L45-L46](../../../../packages/agent-cofold/src/config.ts#L45-L46) - `harnessConfigPath`, where cofold's config is"
---

## Objective

agent-cofold's `machine()` answers `cofoldConfig` (file, read-only, required, the harness config path, mounted at the same path), so a cofold host inside a machine finds its providers.

## Files

- `UPDATE: packages/agent-cofold/src/agent.ts` - `machine()`.

## Steps

1. The need carries a description saying it holds the provider keys.

## Validation

- A unit test over the answer, with `XDG_CONFIG_HOME` set and unset.

## Resume
