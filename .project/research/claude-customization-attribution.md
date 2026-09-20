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

The SDK attributes a plugin's children, by name namespace, and no live attribution beyond that.
The installed `@anthropic-ai/claude-agent-sdk` reports plugins from `reloadPlugins()` as `{ name, path, source?, version? }`, and its flat `SlashCommand` and `AgentInfo` entries carry no `source` field (`sdk.d.ts`, `SDKControlReloadPluginsResponse`, `SlashCommand`, `AgentInfo`).
The probe below showed the namespace instead: a plugin named `acme` with a skill and an agent reported `commands` entries named `acme:acme-skill` and `agents` entries named `acme:acme-agent`, with the skill's description prefixed `(acme)`, while a project skill and the builtin agents and commands kept plain names.
So `customizationsOf` moves a skill, prompt or agent whose name begins `<plugin>:` under that plugin's container, strips the prefix from its display name, and leaves everything else in the per-kind directory containers; what the SDK reports with no namespace stays where it is rather than being guessed at.
No attributable builtin source was found: `initializationResult()` and `reloadPlugins()` carry no builtin flag, and this repository has no non-editable URI scheme, so a command with no disk skill behind it stays a `prompt` in the commands container rather than becoming a `builtin` container.

### Evidence

- Read `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`: `reloadPlugins()` answers `SDKControlReloadPluginsResponse` with `{ commands, agents, plugins, mcpServers, error_count }`, the plugin entry is `{ name, path, source?, version? }`, and `SlashCommand` and `AgentInfo` declare no source.
- Ran a live probe with the installed CLI and the machine's credentials: a temporary project holding `.claude/skills/user-skill` and a temporary local plugin whose manifest named it `acme` and which carried `skills/acme-skill` and `agents/acme-agent`. The probe called `initializationResult()` and `reloadPlugins()` and printed both.
- `reloadPlugins().plugins` answered `[{ name: 'acme', path: '<the plugin root>', source: 'acme@inline', version: '1.0.0' }]`.
- Both `commands` and `reloadPlugins().commands` answered the plugin skill as `{ name: 'acme:acme-skill', description: '(acme) A plugin skill', aliases: ['acme-skill'] }` and the project skill as `{ name: 'user-skill', description: 'A user skill from disk (project)' }`.
- Both `agents` and `reloadPlugins().agents` answered the plugin agent as `{ name: 'acme:acme-agent', description: 'A plugin agent' }` beside the project agent and the builtin agents, all with plain names.
- The probe's temporary script and directories were removed after the run, and nothing was committed.
