---
title: A session switch on a built-in stays
domain: host
status: built
priority: medium
created: 2026-10-16
revalidated: 2026-10-16
changes: []
creates: []
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1196-L1323](../../../../packages/sdk/src/host/chatactions.ts#L1196-L1323) - the `session/customizationToggled` case"
  - "[code://packages/sdk/src/host/chatactions.ts#L1231](../../../../packages/sdk/src/host/chatactions.ts#L1231) - `asked`, the session's own decision"
  - "[code://packages/sdk/src/host/chatactions.ts#L1312-L1322](../../../../packages/sdk/src/host/chatactions.ts#L1312-L1322) - a refused switch says `has no runtime switch` and sends the backend's list again"
  - "[code://packages/sdk/src/host/tooling.ts#L530-L545](../../../../packages/sdk/src/host/tooling.ts#L530-L545) - `entriesFor`: session, then the store's workspace and global entries"
  - "[code://packages/sdk/src/host/tooling.ts#L559-L571](../../../../packages/sdk/src/host/tooling.ts#L559-L571) - `withEntries` lays the entries over what the backend reported"
  - "[code://packages/sdk/src/host/tooling.ts#L597-L621](../../../../packages/sdk/src/host/tooling.ts#L597-L621) - `tellOff` tells the backend once what the store has off"
  - "[code://packages/sdk/src/host/tooling.ts#L823-L846](../../../../packages/sdk/src/host/tooling.ts#L823-L846) - `customizationUnder` keeps no session decision for a backend customization"
  - "[code://packages/agent-claude/src/session/servers.ts#L240-L282](../../../../packages/agent-claude/src/session/servers.ts#L240-L282) - `setCustomizationEnabled` switches MCP servers only"
  - "[code://packages/agent-claude/src/session/servers.ts#L226](../../../../packages/agent-claude/src/session/servers.ts#L226) - the session already calls `applyFlagSettings`"
  - "[code://packages/agent-claude/src/session/customizations.ts#L96-L119](../../../../packages/agent-claude/src/session/customizations.ts#L96-L119) - `rootOf`: a built-in is keyed by its `source`, `<name>@builtin`"
  - "[code://packages/sdk/test/host-harness.test.ts#L680-L687](../../../../packages/sdk/test/host-harness.test.ts#L680-L687) - the test that expects the refusal"
  - "[code://docs/sdk/AHP.md#L678](../../../../docs/sdk/AHP.md#L678) - the docs row: a toggle is refused out loud"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278/sdk.d.ts#L2769 - `applyFlagSettings`
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278/sdk.d.ts#L2904 - `reloadPlugins`
  - npm://@anthropic-ai/claude-agent-sdk@0.3.278/sdk.d.ts#L6966 - `enabledPlugins`, keyed `<id>@<marketplace>`, with flag settings above user settings
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/agentSideEffects.ts#L384-L398 - VS Code records every toggle"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostCustomizationEnablementService.ts#L112-L127 - a session decision is keyed by id, a lasting one by source"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/agentHostCustomizationEnablementService.ts#L310-L315 - `replaceEnablement` tells the sessions it touches"
  - "file:///github/externals/vscode/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L487-L496 - VS Code's Claude agent applies MCP enablement only"
  - "file:///github/agent-host-protocol/types/channels-session/actions.ts#L430-L443 - `SessionCustomizationToggledAction`: the enablement replaces the list"
---

## Goal

"Disable (Session)" on a built-in Claude plugin stays off for that session.
The CLI stops loading the plugin in that session, and the session's customizations report it off.
The window's switch does not flicker back.

## Reconnaissance

### Searches performed

- `git grep -n "has no runtime switch" packages/` - the refusal is in `chatactions.ts`, and in agent-acp and agent-cofold.
- `git grep -n "applyFlagSettings\|reloadPlugins" packages/agent-claude/src` - both are in use already, for settings and for the plugin list.
- `grep -n "enabledPlugins" sdk.d.ts` - a setting that switches a plugin by its `<name>@<marketplace>` id.
- `rg -n "SessionCustomizationToggled|replaceEnablement" /github/externals/vscode/src/vs/platform/agentHost` - the VS Code path for a toggle.

### Runtime path

1. The window sends `session/customizationToggled` with one entry of kind `session`, for the id of a built-in plugin.
2. The host echoes the action, so the window draws the switch off.
3. The decision is the session's own, so the host asks the session's backend with `setCustomizationEnabled`.
4. agent-claude finds no MCP server with that id and answers `false`.
5. The host refuses with `<id> has no runtime switch` and sends `session/customizationsChanged` with the backend's list.
6. That list has no session entry, so the window draws the switch on again.

### What is true now

- The host keeps no session decision for a customization that the backend reported. `customizationUnder` returns no `own` for one.
- A global or folder "off" for a built-in goes to the store. `withEntries` shows it off, and `tellOff` asks the backend, which answers `false`. So the CLI still loads the plugin, and the off is display only.
- VS Code never refuses a toggle. It keeps a session decision by customization id and tells the session.
- VS Code's own Claude agent applies MCP enablement only. A plugin switched off there is display only too.

### Gaps

- Whether `applyFlagSettings({ enabledPlugins: { '<name>@builtin': false } })` and then `reloadPlugins()` unload a built-in in a live session. Task 01 step 1 reads it.
- Whether `applyFlagSettings` merges with the flag settings the session set at start, or replaces them. Task 01 step 2 reads it.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The host keeps a session decision for a backend customization that the backend switched, keyed by id | (defaulted: VS Code keys a session decision by id) | 02 |
| A store decision for a built-in reaches the CLI through the same switch, so a global off is real | (defaulted: `tellOff` already calls `setCustomizationEnabled`) | 01 |
| A built-in plugin switched off for a session is unloaded: agent-claude sets `enabledPlugins` and reloads the plugins | Softov, 2026-10-16, chose "The CLI stops loading it in that session" for "What does Disable (Session) on a built-in plugin do?" | 01 |
| A switch that the backend cannot make is refused, and the host sends the list again, as now | Softov, 2026-10-16, chose "It refuses and sends the list again, as now" for "When a backend cannot switch a customization for one session, what does the host do?" | 02 |
| Skills, prompts and subagents keep the refusal | (defaulted: the CLI has no switch for them, and the docs say so) | 02 |

## Proposed architecture

- **Data flow:** `customizationToggled` -> `setCustomizationEnabled(id, off)` -> agent-claude sets `enabledPlugins` and reloads the plugins -> `true` -> the host keeps the session decision -> `customizationsChanged` with a `session` entry first.
- **Layer responsibilities:** agent-claude switches a built-in plugin and reports what took. sdk keeps the session decision and lays it over the backend's list.

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Claude switches a built-in plugin](task-01-claude-switches-a-builtin-plugin.md) | done | - |
| [02 - The host keeps a session decision](task-02-the-host-keeps-a-session-decision.md) | done | 01 |
| [03 - The docs say a built-in switches](task-03-the-docs-say-a-builtin-switches.md) | done | 02 |

## Risks and tradeoffs

- `reloadPlugins` reloads every plugin in the session, so a switch costs one reload. Its `holdOnCacheImpact` option can keep the prompt cache.
- A flag setting sits above user settings. A plugin that a person turned on in `settings.json` is off in the session while the switch is off.

## Resume state

- **Done so far:** planned 2026-10-16. All three tasks built and reviewed 2026-10-16, merged in `21d0c2ed`.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none.
- **Watch out for:** the id of a built-in plugin is `plugin:<name>`, and its `enabledPlugins` key is its `source`. Two readings from task 01 that task 02 rests on: a switched-off plugin is *absent* from `reloadPlugins`' answer, so agent-claude is the one keeping the row; and `applyFlagSettings` merges into the flag layer at the top level, so a switch sends every decision of the session and not only the one it is moving.

## Final verification checklist

- [x] A test in agent-claude: switching a built-in off sets `enabledPlugins` and reloads the plugins, and answers `true`.
- [x] A test in the sdk: a session toggle of a built-in stays off in `customizations()`, with no refusal.
- [x] A test in the sdk: a skill toggle is still refused.
- [x] The gates pass: build, typecheck, boundary, schema and vitest.
- [ ] By hand: "Disable (Session)" on `cc-plugin-agents-md` stays off, and the plugin's skills leave the slash list.
- [x] `plans/index.md` updated.
