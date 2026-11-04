---
title: A background row outlives its turn
domain: claude
status: planned
priority: high
created: 2026-11-04
revalidated: 2026-11-04
refs:
  - git://9e8210df - the commit of ahpd the facts were checked at
  - "[code://packages/agent-claude/src/session/workers.ts#L529-L563](../../../../packages/agent-claude/src/session/workers.ts#L529-L563) - `reconcileWork`, which builds every row again from `live` and removes each told row that it does not build"
  - "[code://packages/agent-claude/src/session/workers.ts#L367-L372](../../../../packages/agent-claude/src/session/workers.ts#L367-L372) - `scopeOfCall`, which finds a task's scope in the open tool call parts"
  - "[code://packages/agent-claude/src/session/query.ts#L1130](../../../../packages/agent-claude/src/session/query.ts#L1130) - `ctx.parts.clear()` at the end of a turn, after which `scopeOfCall` finds no lead call"
  - "[code://packages/agent-claude/src/session/workers.ts#L455-L479](../../../../packages/agent-claude/src/session/workers.ts#L455-L479) - `shellWork`, which reads the command from the call's part and falls back to the label"
  - "[code://packages/agent-claude/src/session/workers.ts#L49-L54](../../../../packages/agent-claude/src/session/workers.ts#L49-L54) - `TaskInfo`, what the session keeps for each task"
  - "[code://packages/agent-claude/test/agent-claude-background-work.test.ts#L213-L262](../../../../packages/agent-claude/test/agent-claude-background-work.test.ts#L213-L262) - the shell row cases, none of which ends the turn"
  - "[code://packages/sdk/src/host/background.ts#L100-L118](../../../../packages/sdk/src/host/background.ts#L100-L118) - the host removes a row only when the backend reports the removal"
  - npm://@anthropic-ai/claude-agent-sdk@0.3.301 - `background_tasks_changed` lists every live task and replaces the set
---

## Goal

A chat keeps a row for each background task that still runs, after the turn that started it has ended.
Today the first change to a Claude session's background tasks after its turn ends removes every row.
A stop of one shell, or one shell that ends, then removes the rows of the shells that still run.
Softov saw this on 2026-11-04: a stop of `sleep 600` removed the row of a loop that ran on.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg -n "parts.clear\(\)" packages/agent-claude/src` - the lead scope's parts are cleared at the end of each turn.
- `rg -n "tasks\.remove" packages/*/src` - ACP and the sdk remove a row by its id when its work ends; only Claude builds the whole set again.
- `rg -n "background_tasks_changed" packages/*/test` - no case ends the turn before a task changes.

### Runtime path

```
task_notification or background_tasks_changed -> dropTask / noteLive -> reconcileWork
  -> scopeOfCall(toolUseId) finds no part after the turn -> the task is not built
  -> tasks.remove for every told row -> chat/backgroundWorkRemoved for each
```

### Gaps

- A task's chat and command are read from the turn's open parts each time, and those parts are gone once the turn ends.

## Answers

| What | Source | Task |
| --- | --- | --- |
| Fix the case where one stop removes every background row | Softov, 2026-11-04, "plan for that case" | 01 |
| Each task keeps the chat and command found while its call was open, and a later reconcile reads them from `TaskInfo` | (defaulted: the same data `taskInfo` holds for the description; the scope lookup stays for a task not seen yet) | 01 |
| A subagent row keeps its chat the same way | (defaulted: `reconcileWork` skips a subagent task by the same `scopeOfCall` check) | 01 |

## Proposed architecture

- **Data flow** - `TaskInfo` gains `chat` and `command`, written the first time `reconcileWork` resolves the task's scope.
  A later `reconcileWork` uses them when `scopeOfCall` finds nothing.
- **State flow** - `dropTask` removes the record with the task, as today, so nothing is kept for a task that ended.
- **Layer responsibilities** - agent-claude: keep and read the pinned chat and command · sdk host: no change.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/workers.ts`](../../../../packages/agent-claude/src/session/workers.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - a background row outlives its turn](task-01-a-background-row-outlives-its-turn.md) | implemented | - |

## Risks and tradeoffs

- A task whose scope was never resolved during its turn still gets no row. That is the case today, and a level frame after the turn cannot name its chat.

## Resume state

- **Done so far:** task 01 is implemented on 2026-11-04. The two new cases fail without the change.
- **Next action:** review, then the check by hand in [claude-0745-background-row-checks.md](../../../pending/claude-0745-background-row-checks.md).
- **Watch out for:** nothing open.

## Final verification checklist

- [x] After a turn ends with two shells running, a stop of one removes only its row.
- [x] After a turn ends, a level that drops one shell removes only its row, and the other keeps its command.
- [ ] `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the agent-claude and sdk tests pass.
