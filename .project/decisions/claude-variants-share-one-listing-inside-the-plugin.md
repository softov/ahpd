---
title: Claude variants share one listing inside the plugin
status: accepted
date: 2026-10-04
refs:
  - "[code://packages/agent-claude/src/plugin.ts#L189-L211](../../packages/agent-claude/src/plugin.ts#L189-L211) - every variant of one load shares `paths`, and each is registered as an agent of its own"
  - "[code://packages/agent-claude/src/claude.ts#L411](../../packages/agent-claude/src/claude.ts#L411) - each variant's `list`"
  - "[code://packages/sdk/src/host/catalogue.ts#L294-L345](../../packages/sdk/src/host/catalogue.ts#L294-L345) - the host keeps every agent's row for an id and picks the recorded provider's"
  - "[code://packages/sdk/src/plugins.ts#L500-L507](../../packages/sdk/src/plugins.ts#L500-L507) - `registerAgent` does not record which plugin an agent came from"
---

## Context

Every Claude preset (`claude`, `claude-openrouter`, `claude-openrouter-build`, ...) is registered as an agent of its own, and each one's `list` calls the SDK's `listSessions({ dir })` over the same `paths` and the same `~/.claude/projects`.
On dev-01 that listing takes tens of seconds, and the catalogue paid for it once per variant.
The host cannot tell that two agents read the same store: `registerAgent` keeps no plugin, and `Agent` has no key for a store.
The host does need every variant's row for an id, because host 37 picks the row of the provider the session was recorded under, and a row only one variant offered would move a session to another endpoint.

## Decision

The Claude plugin builds one listing per load and hands it to every variant it registers, and calls that arrive while it runs share it; the host still calls each variant's `list` and gets each one's rows.

Source: Softov, 2026-10-04, asked "The host can't tell which agents share a store, so the Claude plugin lists its transcripts once and hands that listing to every variant. Keep it inside the plugin?": inside the plugin.

## Consequences

- The projects directory is read once per refresh, however many presets are configured.
- No `Agent` member and no host code is added for it, and other plugins are untouched.
- The sharing is right only while every variant of one load lists the same `paths` with the same `CLAUDE_CONFIG_DIR`; a preset that gets its own `paths` or its own configuration directory has to get its own listing.
- A second plugin whose agents share a store does the same inside itself, or this is revisited.

## Options

- An optional `Agent.store()` key, with the host listing one agent per key and copying its rows to the others: works for every plugin, and adds a member to `Agent` and a copy step to `listing` for a case only Claude has today.
- Registering one agent for all presets: changes what a client sees as providers, which host 30 and host 37 depend on.
