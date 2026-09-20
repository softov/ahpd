---
title: Can the Claude SDK attribute a customization to a plugin, a builtin, or the user
date: 2026-09-19
refs:
  - code://packages/agent-claude/src/session.ts - where the CLI's flat lists become customizations today
  - src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts - the reference projection, inside the clone
  - src/vs/platform/agentHost/node/claude/customizations/claudeBuiltinCommands.ts - the reference builtin container, inside the clone
---

## Question

The reference projects a plugin as its own `PluginCustomization` container, keeps plugin-contributed skills and agents out of the per-scope directory lists, and puts builtins in a container of their own with real URIs.
The Claude Agent SDK reports plugins away from its flat lists: `reloadPlugins()` answers plugins beside commands, agents and MCP servers, and the message-stream init carries a `plugins` field, while `initializationResult()`, which is what feeds `customizationsOf` today, carries none.
Is there enough attribution in what the SDK reports to reproduce that projection without scanning the disk?

## Why it matters

`customizationsOf` in `packages/agent-claude/src/session.ts` synthesises three `directory` containers from the flat lists and invents `~/.claude/<kind>/<name>` URIs, so the window lists plugin-contributed entries and builtins as if the user had written them.
The pass that raised this is `.project/review/2026-09-19-upstream-pass-4.md`; how deep the fix goes depends entirely on this answer.

## Method

1. Read what the installed SDK version reports for `plugins`, `skills`, `agents` and `slash_commands`, and whether any of them carries a source.
2. Probe one project with a plugin installed beside a user skill and a builtin command, and compare what each entry reports.
3. Match the result against the reference's three containers in `claudeSessionCustomizationDiscovery.ts`.

## Answer

Empty until the investigation is run.
The fallback is already known: containers are projected only as far as the SDK attributes, and what it cannot attribute stays a `directory` container rather than being invented.
