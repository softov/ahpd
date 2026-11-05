---
title: An ACP preset is a file a person edits
created: 2026-11-05
refs:
  - "[code://packages/agent-acp/src/presets.ts#L29-L113](../../packages/agent-acp/src/presets.ts#L29-L113) - the presets today: one TypeScript object, kept by hand"
  - "[code://packages/sdk/src/machines/agents.ts#L92](../../packages/sdk/src/machines/agents.ts#L92) - `knownAgents`, which holds each preset's name and command"
---

Each ACP agent that ahpd knows is a preset in code today.
A preset holds the command, the arguments, the variables, the sign-in, the trust and the approval modes.
A new agent, or a changed flag, needs a release of `@ahpd/agent-acp`.
With one file per preset, a person adds an ACP agent by adding one file.
The daemon checks each file against a schema when it reads it.
The shipped presets could be the same files, so a person can read and change every ACP setting in one place.
See [the agent settings brief](../briefs/agent-settings-at-plugin-and-record.md) for how the settings differ between agents.
