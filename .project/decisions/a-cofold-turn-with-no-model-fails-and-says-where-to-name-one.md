---
title: A cofold turn with no model configured fails and says to add "model" to the cofold configuration file
status: accepted
date: 2026-09-26
refs:
  - "[code://packages/agent-cofold/src/agent.ts#L248-L252](../../packages/agent-cofold/src/agent.ts#L248-L252) - `connectionOf`, which throws when no model is named anywhere"
  - "[code://packages/agent-cofold/src/config.ts#L45-L46](../../packages/agent-cofold/src/config.ts#L45-L46) - `harnessConfigPath`, `$XDG_CONFIG_HOME/cofold/config.json` or `~/.config/cofold/config.json`"
  - "[code://packages/agent-cofold/test/agent-cofold-turn.test.ts#L407-L434](../../packages/agent-cofold/test/agent-cofold-turn.test.ts#L407-L434) - the turn that fails without a model, asserting the instruction and the path"
---

## Context

cofold has no default model: with no `model` in the session settings, the plugin options or the cofold configuration file, `connectionOf` throws.
The turn fails with `cofold: no model was chosen, this backend has no default, and <path> names none`, which names the file but not what to put in it.

## Decision

With no model configured anywhere, a turn fails with a sentence that says to add `"model"` to the cofold configuration file and names its path; no model is picked silently.
Source: Softov, 2026-09-26, asked what a cofold turn does when no model is configured anywhere (require one, or pick one the endpoint lists): "Require model".

## Consequences

The error sentence changes, and the test that pins it asserts the instruction and the path.
A session is still created without a model; only the turn fails.

## Options

- **Pick one.** The first model the endpoint lists, which runs a turn on a model nobody chose.
