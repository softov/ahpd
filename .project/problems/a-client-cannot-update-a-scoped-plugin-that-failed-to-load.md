---
title: A client cannot update a scoped plugin that failed to load
status: open
date: 2026-11-03
severity: major
blocks:
  - plans/daemon/40-a-daemon-starts-with-no-backend/plan.md
refs:
  - "[code://packages/server/src/pluginschannel.ts#L345-L348](../../packages/server/src/pluginschannel.ts#L345-L348) - `idOf` and `specOf`: the row id of a plugin that did not load is its spec"
  - "[code://packages/server/src/pluginschannel.ts#L410-L416](../../packages/server/src/pluginschannel.ts#L410-L416) - `idParam` refuses an id with a `/`"
  - git://e19997c8 - the commit of ahpd it was seen at
---

## Symptom

A daemon from main with `@ahpd/agent-claude@0.13.0` in `plugins` starts, refuses the plugin and lists no agent.
The row of that plugin in `x-ahpd-plugins://` has the id `@ahpd/agent-claude`.
`x-ahpd/plugins/update` refuses both ids a client can send:

| `id` | Answer |
| --- | --- |
| `@ahpd/agent-claude` | `-32602` "needs id, the plugin's id as a row answers it, with no / or ?" |
| `agent-claude` | `-32602` "no plugin agent-claude is configured" |

## Cause

A plugin that did not load has no manifest slug, so its row id is the spec as written.
A scoped package name holds a `/`, and `idParam` refuses every id with a `/`.

## Impact

A client cannot move an old first-party plugin, which is the path daemon/40 adds for a person with no shell on the host.

## Workaround

On the host, run `ahpd plugin update all`, then `ahpd restart`.
On 2026-11-03 this moved the plugin from 0.13.0 to 0.14.0, and the Claude agent was listed after the restart.

## Fix

- Give a plugin that did not load a slug from its package name, so its row id has no `/`.
- Let `idParam` take a row id that the plugins list answers, `/` included.
