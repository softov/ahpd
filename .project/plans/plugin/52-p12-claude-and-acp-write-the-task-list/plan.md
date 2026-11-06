---
title: Claude and ACP write the task list
domain: plugin
status: built
priority: medium
created: 2026-10-18
revalidated: 2026-10-18
requires:
  - plans/plugin/52-p1-the-host-keeps-one-task-list/plan.md
changes: []
creates: []
refs:
  - "[code://packages/agent-claude/src/input.ts#L307](../../../../packages/agent-claude/src/input.ts#L307) - `TodoWrite` is titled \"Update todo list\" today"
  - "[code://packages/agent-claude/src/input.ts#L324-L336](../../../../packages/agent-claude/src/input.ts#L324-L336) - `TaskCreate`, `TaskUpdate`, `TaskList` and `TaskGet` are titled today"
  - "[code://packages/agent-claude/src/session/query.ts#L372-L374](../../../../packages/agent-claude/src/session/query.ts#L372-L374) - the `env` Claude Code is started with"
  - "[code://packages/agent-claude/src/session/query.ts#L404-L405](../../../../packages/agent-claude/src/session/query.ts#L404-L405) - `allowedTools` and `disallowedTools` on the query"
  - "[code://packages/agent-claude/src/session/stream.ts#L306-L322](../../../../packages/agent-claude/src/session/stream.ts#L306-L322) - a complete `tool_use` block, where the input of a call is known"
  - "[code://packages/agent-claude/src/plugin.ts#L38](../../../../packages/agent-claude/src/plugin.ts#L38) - `optionsSchema` of the Claude plugin"
  - "[code://packages/agent-acp/src/mapping.ts#L399-L412](../../../../packages/agent-acp/src/mapping.ts#L399-L412) - `plan`, the turn's one Plan call, drawn from the ACP entries"
  - "[code://packages/agent-acp/src/mapping.ts#L524-L525](../../../../packages/agent-acp/src/mapping.ts#L524-L525) - the `plan` session update"
  - "[code://packages/sdk/src/types/events.ts#L28-L47](../../../../packages/sdk/src/types/events.ts#L28-L47) - `EventName`, the closed set of host events"
  - "[code://packages/sdk/src/types/plugin.ts#L919](../../../../packages/sdk/src/types/plugin.ts#L919) - `on`, how a plugin hears a host event"
  - npm://@agentclientprotocol/sdk@^1.8.0 - `PlanEntry`, with `content`, `priority` and `status`; each update sends the whole list
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.301 - `disallowedTools` and `env` on a query
  - https://code.claude.com/docs/en/settings - `CLAUDE_CODE_ENABLE_TASKS`, the variable that turns on the Task tools
---

## Goal

A Claude session uses the host task tools in place of its own by default, so its tasks land in the host list.
A setting keeps Claude's own tools, and then ahpd turns them on and writes each of their calls into the session's plan.
The plan update of an ACP server writes into the session's plan too, which covers Codex through `codex-acp`.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- `rg -n "TodoWrite|TaskCreate" packages/agent-claude/src` - only `input.ts` knows them, for a title.
- `rg -n "disallowedTools|env" packages/agent-claude/src/session/query.ts` - the query takes a deny list and an environment.
- `rg -n "case 'plan'" packages/agent-acp/src/mapping.ts` - the ACP plan becomes one Plan call per turn, and nothing else.
- `rg -n "EventName" packages/sdk/src/types/events.ts` - no host event carries a harness's list.

### Runtime path

```
Claude TodoWrite / TaskCreate / TaskUpdate, or ACP `plan` -> backend -> host -> tasks plugin -> the session's plan in the `plans` and `tasks` records
```

### Gaps

- A backend has no way to hand a harness's list to the host.
- The tasks plugin has no plan for a session, because a plan's scope is a folder or a bot.
- Claude is not told to leave its own task tools, and ahpd sets no `CLAUDE_CODE_ENABLE_TASKS`.

## Answers

| What | Source | Task |
| --- | --- | --- |
| ahpd translates the ACP `plan` update and Codex `update_plan` into the host model, in p1 | Softov, 2026-10-18, chose "In p1" for "Translating each of their updates into the host task model: in p1, or in a later plan?" | 01, 02, 06 |
| Claude uses the host task tools in place of its own by default; a setting keeps its own tools and translates them | Softov, 2026-10-18, chose "Host tools in place" for "What should its default be?" (Claude tools) | 03, 05 |
| When Claude keeps its own tools, ahpd turns them on with `CLAUDE_CODE_ENABLE_TASKS`; a setting, on by default | Softov, 2026-10-18, chose "On" for "ahpd sets neither CLAUDE_CODE_ENABLE_TASKS nor CLAUDE_CODE_ENABLE_TODO_TOOLS ... What should its default be?" | 04 |
| A translated list writes to the session's plan, kept across turns | Softov, 2026-10-18, chose "The session's plan" for "Which plan does it write to?" | 02 |
| Codex reaches ahpd through `codex-acp`, so translating the ACP plan update covers Codex | (defaulted: the request to write this plan, 2026-10-18) | 06 |
| A whole-list update matches each entry to a task of the session's plan by its text | (defaulted: the request to write this plan, 2026-10-18) | 02 |
| A step missing from the next list is set to `dropped`, and its record stays | (defaulted: the request to write this plan, 2026-10-18) | 02 |
| A `TodoWrite` that clears the list when every step is complete drops nothing | (defaulted: the request to write this plan, 2026-10-18) | 02, 05 |
| A translated task keeps `source`: the tool and the harness's own id | (defaulted: the model in p1, 2026-10-18) | 02, 05 |
| The harness statuses map as `pending` to `todo`, `in_progress` to `doing`, `completed` to `done`, and `deleted` to `dropped` | (defaulted: the four statuses Claude and ACP send) | 02 |
| Claude denies its own task tools only when the tasks plugin is loaded and offers `task_add` | Softov, 2026-10-18, "deny Claude's own task tools only when the tasks plugin is loaded and offers task_add" for "Does Claude lose its own tools on a host with no tasks plugin?" | 03 |
| A backend hands a list to the tasks plugin with a new host event, `plan_update`, heard with `on` | (defaulted: proposed by the planner, 2026-10-18; Softov may change it) | 01, 02 |
| The session's plan has a third scope, `session`, with the session id as text | (defaulted: proposed by the planner, 2026-10-18; Softov may change it) | 02 |
| The two Claude settings are Claude plugin options, `hostTasks` and `enableTasks`, both `true` | (defaulted: proposed by the planner, 2026-10-18; Softov may change it) | 03, 04 |
| The default denies `TodoWrite`, `TaskCreate`, `TaskUpdate`, `TaskList` and `TaskGet` | (defaulted: proposed by the planner, 2026-10-18; Softov may change it) | 03 |
| When two entries have the same text, an entry matches the first task in order that is not matched yet | (defaulted: proposed by the planner, 2026-10-18; Softov may change it) | 02 |
| `by` on a stamp of a translated task is the sender of the turn | (defaulted: proposed by the planner, 2026-10-18; Softov may change it) | 02 |
| A translated task keeps the `priority` of an ACP entry, which has the same values as a host task | (defaulted: proposed by the planner, 2026-10-18; Softov may change it) | 02, 06 |
| The session's plan is called by the session's title, which the host adds to `plan_update`; with no title yet it is `Session <id>`, and the goal stays empty | Softov, 2026-10-18, "the session's plan is called by the session's title. The host adds the session's title to plan_update. Until the session has a title, the plan is called "Session <id>". The goal stays empty." for "What should the session's plan be called, and what should its goal be?" | 01, 02 |

## Proposed architecture

- **Data flow** - a harness writes its list. The backend hands the list or one change to the host. The tasks plugin writes the session's plan.
- **Event flow** - a whole list from ACP or `TodoWrite`, and one change from `TaskCreate` or `TaskUpdate`.
- **State flow** - the session's plan is a record of the `plans` collection, kept across turns. Its tasks are records of `tasks` with `source`.
- **Layer responsibilities** - The sdk gives the seam from a backend to a plugin. The Claude backend keeps the two settings, the deny list, the environment and its translation. The ACP backend keeps its translation. The tasks plugin keeps the session's plan and the text match.
- **Source-of-truth files** - [`code://packages/sdk/src/types/events.ts`](../../../../packages/sdk/src/types/events.ts), [`code://packages/agent-acp/src/mapping.ts`](../../../../packages/agent-acp/src/mapping.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a-backend-hands-its-list-to-the-host](task-01-a-backend-hands-its-list-to-the-host.md) | done | - |
| [02 - the-sessions-plan-takes-a-harness-list](task-02-the-sessions-plan-takes-a-harness-list.md) | done | 01 |
| [03 - claude-uses-the-host-tools](task-03-claude-uses-the-host-tools.md) | done | - |
| [04 - claude-keeps-its-own-tools-on-a-setting](task-04-claude-keeps-its-own-tools-on-a-setting.md) | done | 03 |
| [05 - claudes-own-task-calls-write-the-plan](task-05-claudes-own-task-calls-write-the-plan.md) | done | 02, 04 |
| [06 - the-acp-plan-update-writes-the-plan](task-06-the-acp-plan-update-writes-the-plan.md) | done | 02 |
| [07 - the-docs-say-how-a-harness-list-lands](task-07-the-docs-say-how-a-harness-list-lands.md) | done | 05, 06 |

## Risks and tradeoffs

- A text match reads an edited step as one dropped step and one new step. The record of the old step stays, so nothing is lost.
- On a host with no tasks plugin, Claude keeps its own tools, so its list stays in the harness and no plan holds it.
- A harness can rewrite its list many times in a turn. Each write goes to the records, so the store sees many writes.

## Resume state

- **Done so far:** plan and tasks written 2026-10-18, with the rows moved from p1. Open questions answered 2026-10-18. Task 01 implemented 2026-10-18, and amended the same day for the title answer. `plan_update` is a host event, and `Start.planUpdate` is the backend's call. `spawn` raises the event with the session, the chat, the harness, the tool, the turn, the title and the sender. Task 02 implemented the same day: the tasks plugin hears `plan_update` and writes the session's plan. It matches a whole list by text and a single change by the harness's id. Task 03 implemented the same day: `hostTasks`, on by default, denies Claude's own five task tools when the host offers `task_add`. Task 04 implemented the same day: `enableTasks` sets `CLAUDE_CODE_ENABLE_TASKS=1` when the session keeps its own tools, on the host and in a machine. Task 05 implemented the same day: Claude's three task calls are translated into the plan, and a `TaskCreate` waits for its id. Task 06 implemented the same day: each ACP `plan` update hands the whole list to the host, and the turn keeps its one Plan call. Task 07 implemented the same day: the task list doc, and the Claude and ACP READMEs, say how a harness's list lands.
- **Next action:** none. The plan is built, and `implemented.md` says what exists.
- **Open questions:** none. The title answer is the last row of the Answers table.
- **Watch out for:** a missing step is `dropped`, never removed. A `TodoWrite` with an empty list after every step was `completed` is not a drop.

## Final verification checklist

- [ ] A Claude session with the defaults has no `TodoWrite` and adds its tasks with `task_add`.
- [ ] A Claude session with its own tools kept writes each `TaskCreate` and `TaskUpdate` into the session's plan.
- [ ] A `codex-acp` session writes its plan into the session's plan, and a step it removes reads `dropped`.
- [ ] The session's plan is the same plan in the next turn.
- [ ] `docs/plugins/TASK-LIST.md`, `docs/plugins/agent-claude.md` updated.
