---
title: Claude tool calls carry their start and end, live and restored
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
  - "[code://packages/agent-claude/src/session.ts#L1410-1797](../../../../packages/agent-claude/src/session.ts#L1410-1797) - tool start, then complete, where the SDK message timestamps are dropped"
  - "[code://packages/agent-claude/src/transcript.ts#L225-343](../../../../packages/agent-claude/src/transcript.ts#L225-343) - `buildTurns`: frame timestamps give only the turn's `startedAt`; tool calls get none, turns get no `duration`"
---

## Goal

Live, a call's start is when it starts running, after any approval, on the plugin's clock, and its end is when it completes. Restored, a call takes its `tool_use` frame time as start and its `tool_result` frame time as end, and each restored turn gets its `duration`.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's times are stamped by its plugin](../../../decisions/a-tool-calls-times-are-stamped-by-its-plugin.md) | Softov, 2026-09-29 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Claude tool calls carry their start and end, live and restored](task-01-stamp.md) | todo | p1 |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-stamp.md](task-01-stamp.md).
- **Open questions:** none.
- **Watch out for:** a `_meta` sent after the start replaces the whole `_meta`: it must carry the times and `toolKind` again.
