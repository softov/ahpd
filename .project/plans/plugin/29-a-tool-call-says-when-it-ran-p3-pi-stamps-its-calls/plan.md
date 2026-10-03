---
title: pi tool calls carry their start and end, live and restored
domain: plugin
status: planned
priority: medium
created: 2026-09-29
revalidated: 2026-10-03
requires:
  - plans/plugin/29-a-tool-call-says-when-it-ran/plan.md
  - plans/plugin/29-a-tool-call-says-when-it-ran-p1-the-sdk-keeps-a-calls-times/plan.md
decisions:
  - decisions/a-tool-calls-times-are-stamped-by-its-plugin.md
refs:
  - "[code://packages/agent-pi/src/mapping.ts#L251](../../../../packages/agent-pi/src/mapping.ts#L251) - `mapEvent(turn, event)`, which gains the time"
  - "[code://packages/agent-pi/src/mapping.ts#L327-L332](../../../../packages/agent-pi/src/mapping.ts#L327-L332) - `tool_execution_start`, with no time kept"
  - "[code://packages/agent-pi/src/mapping.ts#L348](../../../../packages/agent-pi/src/mapping.ts#L348) - `tool_execution_end`, with no time kept"
  - "[code://packages/agent-pi/src/replay.ts#L62](../../../../packages/agent-pi/src/replay.ts#L62) - `raise`, how replay feeds `mapEvent`"
  - "[code://packages/agent-pi/src/replay.ts#L120-L185](../../../../packages/agent-pi/src/replay.ts#L120-L185) - entry times (`entry.timestamp`) used only for the turn"
---

## Goal

Live, the plugin stamps `Date.now()` on `tool_execution_start` and `tool_execution_end`. Restored, the entry times reach the replayed events so the live mapping stamps both paths the same way.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's times are stamped by its plugin](../../../decisions/a-tool-calls-times-are-stamped-by-its-plugin.md) | Softov, 2026-09-29 |

| What | Source | Task |
| --- | --- | --- |
| The entry time reaches the mapping as a parameter, `mapEvent(turn, event, at?)`; live passes none and the mapping uses `Date.now()`, replay's `raise` passes the entry's `timestamp` | (defaulted: pi's event type is pi's, and a parameter keeps it unchanged) | 01 |
| Restored pi calls from a parallel batch share the batch's end time | Softov, 2026-09-29, asked "pi in parallel mode writes every tool result of a batch at the batch's end... Accept that?": "Accept it" | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - pi tool calls carry their start and end, live and restored](task-01-stamp.md) | todo | p1 |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-stamp.md](task-01-stamp.md).
- **Open questions:** none.
- **Watch out for:** a `_meta` sent after the start replaces the whole `_meta`: it must carry the times and `toolKind` again.
