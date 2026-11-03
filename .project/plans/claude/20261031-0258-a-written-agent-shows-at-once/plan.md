---
title: A written agent shows at once
domain: claude
status: built
priority: medium
created: 2026-10-31
revalidated: 2026-10-31
requires:
  - plans/claude/20261031-0228-a-skill-names-its-own-file/plan.md
changes: []
creates: []
refs:
  - git://b93c1298 - the commit of ahpd this plan was checked at
  - "[code://packages/agent-claude/src/session/servers.ts#L86-L95](../../../../packages/agent-claude/src/session/servers.ts#L86-L95) - `laid`, which builds the list and sends `session/customizationsChanged`"
  - "[code://packages/agent-claude/src/session/servers.ts#L263-L272](../../../../packages/agent-claude/src/session/servers.ts#L263-L272) - a plugin switch, which calls `reloadPlugins` and `laid` during a session, the reload to copy"
  - "[code://packages/agent-claude/src/session/servers.ts#L284-L327](../../../../packages/agent-claude/src/session/servers.ts#L284-L327) - `describe`, the one read of the agents, commands and skills, from `initializationResult()`"
  - "[code://packages/agent-claude/src/session.ts#L283-L323](../../../../packages/agent-claude/src/session.ts#L283-L323) - `close`, where a session lets go of what it holds"
  - "[code://packages/agent-claude/src/claude.ts#L514-L519](../../../../packages/agent-claude/src/claude.ts#L514-L519) - the backend's `probe`"
  - "[code://packages/sdk/src/host.ts#L1306-L1343](../../../../packages/sdk/src/host.ts#L1306-L1343) - `probeAgent`, run once per backend at the start, which keeps the root's commands and customizations"
  - "[code://packages/sdk/src/types/agent.ts#L757-L765](../../../../packages/sdk/src/types/agent.ts#L757-L765) - `probe?()`, asked once at startup"
  - "[code://packages/sdk/src/sessions/changes.ts#L1921-L1984](../../../../packages/sdk/src/sessions/changes.ts#L1921-L1984) - a watcher with one debounce, a name filter, and a handle that closes itself on `error`, the pattern to copy"
  - "[code://docs/sdk/AGENT.md#L83](../../../../docs/sdk/AGENT.md#L83) - the backend methods table, where the new method goes"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.301 - `initializationResult()` is the first-connect answer; `reloadPlugins()` answers `agents` and `commands`; `reloadSkills()` answers `skills`
  - npm://@anthropic-ai/claude-agent-sdk@0.3.301 - the CLI watches the personal and project `agents` and `skills` folders only when they exist at its start, and tells the SDK nothing about an agent
  - https://github.com/microsoft/vscode/blob/171e90619c7/src/vs/platform/agentHost/node/claude/customizations/claudeSessionCustomizationDiscovery.ts#L443-L554 - `ClaudeCustomizationWatcher`, which watches `<scope>/.claude` and the `CLAUDE.md` files and reads again 300 ms after a change
  - https://github.com/microsoft/agent-host-protocol/blob/main/types/channels-session/state.ts - `DirectoryCustomization`: after a client writes into a writable directory, the host surfaces the child through the customization actions
---

## Goal

An agent, skill, command or rule written into a Claude folder shows in the open sessions without a restart.
The list outside a session and a new session show it too.
A file written by a client, by the agent, or by a person in an editor shows the same way.
An edit or a delete reaches the list as a new file does.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "reloadPlugins|reloadSkills|initializationResult" packages/agent-claude/src` - `describe`, the probe and the plugin switch.
- `rg -n "commands_changed" packages/agent-claude/src` - nothing; the CLI's push of a new command list is not read.
- `rg -n "agent\.probe\(\)" packages/sdk/src` - one call, in `probeAgent` at the start.
- `grep -a "skillChangeDetector" <SDK binary>` - the CLI's own watcher, on folders that exist when it starts.

### Runtime path

```
a file written under .claude -> the watcher -> reloadPlugins and reloadSkills -> laid
  -> session/customizationsChanged -> a client's customization list
a file written under the personal .claude -> the backend's watcher -> probeAgent -> root/agentsChanged
```

### Gaps

- Nothing in ahpd watches a Claude folder.
- A session reads its agents, commands and skills once, in `describe`.
- The host asks a backend's `probe` once, and a backend has no way to ask for it again.
- `reported.init` keeps the first agents and commands, because `initializationResult()` never changes.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A watcher on each scope's Claude folders starts the read again, not a client's `resourceWrite` only | Softov, 2026-10-31, chose "A watcher" | 01, 02, 03 |
| The read again uses `reloadPlugins()` for the agents and commands and `reloadSkills()` for the skills | the brief; `initializationResult()` is the first-connect answer | 02 |
| The watcher reads again 300 ms after the last change | (defaulted: VS Code's `ClaudeCustomizationWatcher` waits 300 ms) | 01 |
| The watcher reacts to `agents`, `skills`, `commands`, `rules`, `plugins`, `CLAUDE.md`, `CLAUDE.local.md` and the settings files | (defaulted: the names VS Code reacts to) | 01 |
| A session watches its personal scope and, with a working directory, its project scope | the brief; the scopes of the skills plan | 02 |
| A session in a machine starts no watcher | (defaulted: its CLI reads its own config volume, as in the skills plan) | 02 |
| The probe is read again after a change in the personal scope, so the root list and a new session show the file | the brief, *The change* | 03 |
| A change during a turn reads again at once, as a plugin switch does | (defaulted: the plugin switch reloads during a turn today) | 02 |
| A writable directory is sent with no children too, and the project scope is sent | the skills plan, which this plan requires | - |

## Proposed architecture

- **Data flow** - the watcher sees a change and waits 300 ms. The session then asks the CLI for its agents, commands and skills, and `laid` lays out the list again.
- **Event flow** - `session/customizationsChanged` for a session, and `root/agentsChanged` after the probe is read again.
- **State flow** - `reported` holds the last answer of the CLI; a read again replaces its agents, commands and skills.
- **Layer responsibilities** - agent-claude: `watch.ts` watches, `servers.ts` reads again, and `claude.ts` tells the host. sdk: `probeAgent` asks the probe again. docs: `AGENT.md` and the README.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/servers.ts`](../../../../packages/agent-claude/src/session/servers.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The Claude folders are watched](task-01-the-claude-folders-are-watched.md) | done | - |
| [02 - A session reads its list again](task-02-a-session-reads-its-list-again.md) | done | 01 |
| [03 - The probe is read again](task-03-the-probe-is-read-again.md) | done | 01 |

## Risks and tradeoffs

- A reload changes the agent list in the Task tool's description, so the next request of a running conversation misses the prompt cache once. A plugin switch costs the same today.
- `reloadPlugins()` also loads a plugin that changed on disk since the start. That is the same reload a plugin switch runs.
- A recursive watch of a large `.claude` folder costs one handle per folder on some platforms. The watch covers only `.claude` and the `CLAUDE.md` files at a working directory's top, never the whole tree.

## Resume state

- **Done so far:** planned 2026-10-31, and tasks 01 to 03 implemented on 2026-10-31. See [implemented.md](implemented.md).
- **Next action:** none. Softov passed the checks by hand on 2026-11-03.
- **Open questions:** none.
- **Watch out for:** the line numbers in the refs are from before the skills plan merged.

## Final verification checklist

- [x] An agent written from VS Code's Agent Customizations shows in that session and in the `/agent` picker with no restart.
- [x] An agent written by hand into `~/.claude/agents/` shows in an open session.
- [x] A new session and the list outside a session show the agent.
- [x] A skill written into `<working directory>/.claude/skills/` shows in that session's project directory.
- [x] An edit of an agent's `name` and a delete of an agent file reach the list.
- [x] A running turn can call the new agent through its Task tool after the reload.
- [x] `pnpm typecheck` and the agent-claude and sdk suites pass, and Windows CI is green.
