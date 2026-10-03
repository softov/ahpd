---
title: A plugin is loaded once, and each of its presets is a variant registered as an agent of its own
status: accepted
date: 2026-10-02
supersedes: decisions/a-repeated-plugin-is-keyed-by-its-provider.md
refs:
  - "[code://packages/agent-claude/src/plugin.ts#L98-L100](../../packages/agent-claude/src/plugin.ts#L98-L100) - `apply` registers one agent today"
  - "[code://packages/server/src/plugins.ts#L660-L678](../../packages/server/src/plugins.ts#L660-L678) - the repeated-name check this replaces"
  - "[code://packages/server/src/rootconfig.ts#L109-L114](../../packages/server/src/rootconfig.ts#L109-L114) - the `plugins.<name>#<provider>` key this replaces"
---

## Context

The OpenRouter Claude was a second load of `@ahpd/agent-claude`, with its own `provider`, `displayName`, `models` and a `presets` map whose entries were a session-level choice.
Two loads of one module run the same code twice to get two entries in the picker, and they needed their own root config keys.
A session-level preset cannot change the models offered either, because a harness's models are per agent at root.

## Decision

A plugin appears once in `plugins`; a name written twice fails the start, and its root config key is `plugins.<name>`.
The agent is the plugin's wire, and a preset is a variant of it: every preset registers its own agent, keyed by the preset's key as provider id, with its `name`, its `models` and its options.
A plugin with a built-in preset keeps it unless the preset is set to `false`; an object under the built-in's key is laid over it.
Source: Softov, 2026-10-02: "agent is the name of the wire of the plugin.. preset is the variant."; asked "Is that the design?": "with buildin agent. can disable buildin preset. any new is a new agent on wire. move name to inside the present. Claude OpenRouter."; then "model also inside the preset."; asked "How is the built-in Claude preset switched off?": "presets.claude: false".

## Consequences

A session no longer picks a preset; it picks the agent its preset registered.
Each preset has its own model list in the picker.
An ACP plugin cannot serve two servers until it takes presets the same way.

## Options

- Load the plugin once per variant, keyed `plugins.<name>#<provider>`: the code is loaded twice and the keys change when a second entry is added.
- Keep presets as a session-level choice: one picker entry, and the models cannot differ per preset.
