---
title: The session tools find a session and list the agents
domain: host
status: planned
priority: medium
created: 2026-11-10
revalidated: 2026-11-10
requires: []
changes: []
creates: []
refs:
  - git://7d76d5895 - the commit of ahpd this plan was checked at
  - git://e388d12f5:.project/briefs/tools-sessions.md - the brief this plan covers, with the rest in host/20261110-0813-the-session-tools-follow-vscode
  - "[code://packages/sdk/src/tools/session.ts#L102-L136](../../../../packages/sdk/src/tools/session.ts#L102-L136) - `serializeSession`, the row `list_sessions` answers, with no agent field"
  - "[code://packages/sdk/src/tools/session.ts#L139-L180](../../../../packages/sdk/src/tools/session.ts#L139-L180) - `filterSessions`, the filters; `workspace` matches a whole path or project name"
  - "[code://packages/sdk/src/tools/session.ts#L406-L440](../../../../packages/sdk/src/tools/session.ts#L406-L440) - `sessionTools` and `list_sessions`"
  - "[code://packages/sdk/src/tools/session.ts#L506-L530](../../../../packages/sdk/src/tools/session.ts#L506-L530) - `create_session`, whose `agent` names no agent"
  - "[code://packages/sdk/src/tools/session.ts#L331-L337](../../../../packages/sdk/src/tools/session.ts#L331-L337) - `modelMeant`, which refuses a wrong model without naming the models"
  - "[code://docs/server/MCP.md#L43-L61](../../../../docs/server/MCP.md#L43-L61) - what `/mcp` serves"
  - https://github.com/microsoft/vscode/blob/171e90619c723a84a3e1c7bcd58d226698f55c72/src/vs/platform/agentHost/node/shared/sessionServerTools.ts - VS Code's session tools at 171e90619, whose text this plan copies
---

## Goal

A caller of the session tools finds a session and learns the agents without ahpc.
`list_sessions` says each session's agent and takes more filters, newest first, up to a limit.
`list_agents` and `list_models` say what may be started, and `create_session` names the caller's agents itself, as Claude Code's Agent tool names its agent types.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `grep -n "name: '" packages/sdk/src/tools/session.ts` - ten tools; none lists agents or models.
- VS Code's `list_sessions` at 171e90619 takes `session`, `status`, `workspace`, `withChanges`, `unread`, `withPullRequest`, `includeArchived`, `createdAfter` and `createdBefore`, as ahpd does.

### Runtime path

```
tools/list (per caller) -> list_sessions / list_agents / list_models / create_session { agent: enum }
  -> the catalogue and the agents the caller may start -> the answer the model reads
```

### Gaps

- On Softov's daemon on 2026-11-06, `list_sessions` answered 341 rows, 155 KB.
- An ACP row with no time is dated when it is listed. The protocol requires both times on a summary, so this plan leaves the times as they are.

## Answers

| What | Source | Task |
| --- | --- | --- |
| A row says its `agent`, the provider id `create_session` takes | the brief | 01 |
| `list_sessions` takes VS Code's nine filters plus `agent`, `limit` (newest first), `title` and `path` (contains, any case), `modifiedAfter` and `modifiedBefore` | Softov, 2026-11-10, chose "VS Code's plus yours" | 01 |
| Two tools: `list_agents`, with each agent's top five models, and `list_models` | Softov, 2026-11-10: "list_agents and list_models. when listing agent if possible already list top 5 models" | 02 |
| `create_session`'s `agent` is an enum of the caller's agents, each name in its description | Softov, 2026-11-10, chose "Yes, an enum on `agent`" | 03 |
| Each new and changed text is VS Code's where VS Code has one | Softov, 2026-11-10, chose "VS Code's words" | 01-03 |
| VS Code's main at 171e90619 is the reference | Softov, 2026-11-10, chose "VS Code's newer main" | 01-03 |
| "Top five models" is the agent's first five, in the order its probe lists them | (defaulted: a probe lists its default first, and nothing else ranks models) | 02 |
| A tool built per caller lists only the agents that caller may start | (defaulted: as a wrong `agent` is refused today) | 02, 03 |

## Proposed architecture

- **Data flow** - the tools read the catalogue and the root's agent list for the caller; nothing new is stored.
- **Event flow** - none.
- **State flow** - none.
- **Layer responsibilities** - sdk: `tools/session.ts`. docs: `MCP.md` and `TOOLS.md`.
- **Source-of-truth files** - [`code://packages/sdk/src/tools/session.ts`](../../../../packages/sdk/src/tools/session.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - list_sessions finds by more](task-01-list-sessions-finds-by-more.md) | implemented | - |
| [02 - list_agents and list_models](task-02-list-agents-and-list-models.md) | todo | - |
| [03 - create_session names the agents](task-03-create-session-names-the-agents.md) | todo | 02 |

## Risks and tradeoffs

- The enum on `agent` adds a line of text for each agent to every turn that offers `create_session`. On Softov's daemon that is 19 lines.
- `title`, `path`, `agent`, `limit` and the modified range are ahpd's own. VS Code has no text for them, so their text follows VS Code's style.

## Resume state

- **Done so far:** planned 2026-11-10; task-01 implemented 2026-11-10.
- **Next action:** [task-02-list-agents-and-list-models.md](task-02-list-agents-and-list-models.md).
- **Open questions:** none.
- **Watch out for:** `/mcp` and each session's `/ahp-mcp/<uuid>` serve the same tools; a change reaches both. The prescribed `TMPDIR` inside the worktree turns eight git/filesystem cases red (`changes-refresh`, `git`, `watches`, `worktrees`), which pass with `TMPDIR` outside the repository.

## Final verification checklist

- [ ] `list_sessions { agent, limit: 5 }` answers that agent's five newest sessions, each with its `agent`.
- [ ] `title` and `path` match a part of the title or folder, in any case.
- [ ] `list_agents` answers each agent the caller may start, with up to five models.
- [ ] `create_session`'s `agent` lists exactly the caller's agents.
- [ ] `pnpm typecheck` and the sdk and server suites pass, and Windows CI is green.
