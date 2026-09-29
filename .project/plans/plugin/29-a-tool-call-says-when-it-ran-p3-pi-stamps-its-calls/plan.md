---
title: pi tool calls carry their start and end, live and restored
domain: plugin
status: planned
priority: medium
created: 2026-09-29
revalidated: 2026-09-29
requires:
  - plans/plugin/29-a-tool-call-says-when-it-ran/plan.md
  - plans/plugin/29-a-tool-call-says-when-it-ran-p1-the-sdk-keeps-a-calls-times/plan.md
decisions:
  - decisions/a-tool-calls-times-are-stamped-by-its-plugin.md
refs:
  - "[code://packages/agent-pi/src/mapping.ts#L279-305](../../../../packages/agent-pi/src/mapping.ts#L279-305) - `tool_execution_start` and `end`, with no time kept"
  - "[code://packages/agent-pi/src/replay.ts#L100-185](../../../../packages/agent-pi/src/replay.ts#L100-185) - entry times used only for the turn"
---

## Goal

Live, the plugin stamps `Date.now()` on `tool_execution_start` and `tool_execution_end`. Restored, the entry times reach the replayed events so the live mapping stamps both paths the same way.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's times are stamped by its plugin](../../../decisions/a-tool-calls-times-are-stamped-by-its-plugin.md) | Softov, 2026-09-29 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - pi tool calls carry their start and end, live and restored](task-01-stamp.md) | todo | p1 |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-stamp.md](task-01-stamp.md).
- **Open questions:** none.
- **Watch out for:** a `_meta` sent after the start replaces the whole `_meta`: it must carry the times and `toolKind` again.
