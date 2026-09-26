---
title: A cofold session has files, shell, web and memory, run by cofold itself
domain: plugin
status: planned
priority: high
created: 2026-09-26
revalidated: 2026-09-26
requires:
  - plans/plugin/03-agent-cofold/plan.md
changes: []
creates: []
decisions:
  - decisions/cofold-runs-its-own-tools-in-its-process.md
refs:
  - "[code://packages/agent-cofold/src/session.ts#L353-L365](../../../../packages/agent-cofold/src/session.ts#L353-L365) - `agentOf`: `tools` is the host's only, and there is no `capabilities`"
  - "[code://packages/agent-cofold/src/session.ts#L690](../../../../packages/agent-cofold/src/session.ts#L690) - `run(...)` with `workspace: where`, which the capabilities resolve paths against"
  - "[code://packages/agent-cofold/src/plugin.ts#L98](../../../../packages/agent-cofold/src/plugin.ts#L98) - `apply`, where the plugin's options are read"
  - "[code://packages/agent-cofold/src/agent.ts#L74-L75](../../../../packages/agent-cofold/src/agent.ts#L74-L75) - `defaultStoreRoot`, where memory goes beside the sessions"
  - "[code://packages/sdk/src/types/agent.ts#L187](../../../../packages/sdk/src/types/agent.ts#L187) - `onFileEdit`, how a backend reports an edit it made itself"
  - "[code://packages/agent-claude/src/session.ts#L932](../../../../packages/agent-claude/src/session.ts#L932) - the pattern: Claude's write tools reported before and after"
  - "[code://packages/agent-claude/src/session.ts#L2348-L2356](../../../../packages/agent-claude/src/session.ts#L2348-L2356) - a shell call drawn with `toolKind: 'terminal'`"
  - file:///github/cofold/packages/papo/src/agent.ts - `capabilitiesOf`, the same four turned on from a config
  - file:///github/cofold/packages/agents/src/run/tools.ts - validate, `beforeTool`, policy, execute, `afterTool`
  - "file:///github/cofold/packages/tools/src/shell.ts - `shell_exec`, marked `effects: { writes: true, destructive: true }`"
---

## Goal

A cofold session can read, search, edit and write files, run a command, fetch and search the web, and keep memory, the way a Claude session can.
Cofold runs these tools itself; ahpd shows each call, asks before what the permission mode says to ask, and shows the edits.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `grep -n "capabilities" /github/cofold/packages/agents/src/types/agent.ts` - `AgentOptions.capabilities`, resolved per run with the run's `workspace`.
- `grep -n "name: '" /github/cofold/packages/tools/src/*.ts` - `read_file`, `write_file`, `edit_file`, `list_files`, `search_files`, `shell_exec`, `web_fetch`, `web_search`, `memory_read`, `memory_write`.
- `grep -n "SearchProvider" /github/cofold/packages/tools/src/types/web.ts` - `web_search` exists only when a search provider is given: Brave, Tavily or DuckDuckGo.
- `grep -n "isEdit\|effects.writes" packages/agent-cofold/src/session.ts` - the permission policy already treats a tool with `effects.writes` as an edit and knows the workspace boundary.

### Runtime path

```
turn -> agentOf(values) -> createAgent({ tools: host's, capabilities: [new] files, shell, web, memory })
model calls edit_file -> beforeTool [new] onFileEdit(before) -> policy asks or allows -> cofold executes
                      -> afterTool [new] onFileEdit(after) -> the call completes in the chat
```

### Gaps

- `agentOf` passes no capabilities.
- Nothing reports an edit a cofold tool made, so a client sees no changed file.
- A `shell_exec` call is drawn as a generic tool, not a terminal.
- No option says which tools are on or which search provider to use.

## Decisions locked in

| Decision | Task |
| --- | --- |
| [Cofold runs its own tools in its own process, as Claude does](../../../decisions/cofold-runs-its-own-tools-in-its-process.md) | 01, 02, 03 |

| What | Source | Task |
| --- | --- | --- |
| All four on by default; a plugin option `tools: { files, shell, web, memory }` turns one off, the shape papo's `ToolsConfig` has | Softov, 2026-09-26: "files, shell, web, memory"; papo's config for the shape | 01 |
| `web_search` only when a provider is configured under `tools.web.search` (`brave`, `tavily`, `duckduckgo`) | `@cofold/tools`' `web({ search })` | 01 |
| Memory under `<store root>/memory/<workspace slug>/` | papo's `capabilitiesOf` puts it under its home the same way | 01 |
| The capabilities are built here from `@cofold/tools`, not imported from papo | papo is a CLI, not a library this plugin depends on | 01 |
| A session with a computer still refuses | `container/04` is where cofold reaches a machine | - |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A cofold session's agent has the four capabilities](task-01-the-four-capabilities.md) | todo | - |
| [02 - A cofold tool call is drawn and its edits are reported](task-02-calls-drawn-and-edits-reported.md) | todo | 01 |
| [03 - The permission modes cover the new tools](task-03-permission-modes-cover-them.md) | todo | 01 |
| [04 - Docs and the package](task-04-docs-and-package.md) | todo | 02, 03 |

## Risks and tradeoffs

- `shell_exec` is destructive and runs as the daemon's user; the default permission mode must ask before it, which task 03 pins.
- A client that also offers its own terminal tool sees two ways to run a command; the host's `ahp_terminals` stays, since it is a terminal a person can watch.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-the-four-capabilities.md](task-01-the-four-capabilities.md).
- **Open questions:** none.
- **Watch out for:** `agentOf` is rebuilt per turn; building the capabilities there is cheap, but memory's directory must come from the session's workspace, not the process's cwd.

## Final verification checklist

- [ ] VS Code: a cofold session reads a file, edits it (the edit shows as a change), and runs `ls` (drawn as a terminal).
- [ ] VS Code: in the default mode the edit and the command ask first; in `acceptEdits` the edit does not.
- [ ] `web_fetch` works; `web_search` appears only with a provider configured.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm boundary` green.
- [ ] `docs/PLUGINS.md`, `plans/index.md` updated.
