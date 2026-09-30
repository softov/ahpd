---
title: A configuration change applies live where the key can, and otherwise on `ahpd restart`
status: accepted
date: 2026-09-29
refs:
  - "[code://packages/sdk/src/plugins.ts](../../packages/sdk/src/plugins.ts) - the host is built once from every plugin's contributions"
  - "[code://packages/server/src/commands/plugin.ts#L131-L133](../../packages/server/src/commands/plugin.ts#L131-L133) - today's \"Restart the daemon to load the change\" line"
  - "[code://packages/server/src/daemon.ts#L151-L210](../../packages/server/src/daemon.ts#L151-L210) - how the daemon is started and stopped"
---

## Context

A plugin's contributions (agents, tools, schemes, ports) are folded into the host when it is built, and a plugin has no teardown.
Loading a plugin again while the daemon runs needs a host that can take contributions back, a fresh ES module, and a rule for sessions running on it.
Some daemon keys (`advancedTools`, `wire`) can change while the daemon runs; the listener, the paths and the plugins cannot.

## Decision

A key that can apply while the daemon runs applies at once.
Any other key is written to `config.json`, root state carries `_meta["ahpd.restartNeeded"]: true` until the daemon restarts, and `ahpd restart` (CLI and HTTP) restarts it in place.
A restart is refused while a turn is running, naming the sessions, unless it is given `--force`.

Source: Softov, 2026-09-29, asked "When a plugin's config changes through root config or `ahpd plugin config`, how does it take effect?": "Restart command"; on the keys: "things that could be applyed direct without restart could be apply.. like wire. advancedTools, etc. host gets a _meta for restart needed"; asked "What should `ahpd restart` do while a turn is running?": "Refuse, --force to go".

## Consequences

Changing one plugin restarts every session's process; sessions come back from the store.
Reloading one plugin alone is [an idea](../ideas/a-plugin-reloads-without-a-restart.md).

## Options

- **Live reload of one plugin**: needs a teardown hook, a host that removes contributions, module cache busting and a rule for running sessions.
- **On the next start only**: no command, and a client that changed a setting cannot apply it.
