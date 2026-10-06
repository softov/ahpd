---
title: The host records which plugin registered each agent, and a nested host loads that plugin
status: accepted
date: 2026-10-05
supersedes: decisions/a-backend-that-runs-nested-names-its-plugin.md
refs:
  - "[code://packages/sdk/src/nested.ts#L98](../../packages/sdk/src/nested.ts#L98) - the plugin guessed as `@ahpd/agent-<provider>`"
  - "[code://packages/sdk/src/plugins.ts#L500-L507](../../packages/sdk/src/plugins.ts#L500-L507) - `registerAgent`, where the plugin that registers an agent is known"
  - "[code://packages/sdk/src/types/plugin.ts#L454-L470](../../packages/sdk/src/types/plugin.ts#L454-L470) - `Loaded.spec`, what configuration named for that plugin"
---

## Context

A nested host has to load the plugin that serves the session's agent.
The proxy guesses it as `@ahpd/agent-<provider>`, which is wrong for a variant (`claude-openrouter`), a renamed provider (`cofold-work`), a plugin published under another scope, and a plugin loaded from a path.
container/05 p9 runs every backend nested on a machine of another host, so every agent needs an answer, not only the ones that declare `runsNested`.

## Decision

The host records, for each agent, the spec of the plugin that registered it, and the nested host is asked to load that spec's name.
`runsNested` stays a boolean, and no backend names its own package.
Source: Softov, 2026-10-05, asked "how does the host know which package an agent came from, for a variant, a third-party plugin or a local path?": "Host records the spec".

## Consequences

A plugin author declares nothing, and a variant, a renamed provider or someone else's package loads the right plugin.
The `@ahpd/agent-<provider>` default goes, so a caller of `nestedAgent` without a plugin is a type error, not a guess.
A plugin loaded from a path names a file on this host, so the inner host finds it only where the machine has it; making it present is the ahpd part's, and a session whose plugin the inner host cannot load ends with a sentence naming it.

## Options

- **The backend declares its package** (`runsNested: { plugin }`, the superseded decision). Every author must name a package, a backend that does not run nested by default needs a second member for p9, and a path-loaded plugin has no package name to give.
