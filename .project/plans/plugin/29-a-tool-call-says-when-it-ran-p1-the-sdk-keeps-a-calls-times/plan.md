---
title: The sdk has one helper that builds and keeps a tool call's timing _meta
domain: plugin
status: planned
priority: medium
created: 2026-09-29
revalidated: 2026-09-29
requires:
  - plans/plugin/29-a-tool-call-says-when-it-ran/plan.md
decisions:
  - decisions/a-tool-calls-times-are-stamped-by-its-plugin.md
refs:
  - "[code://packages/sdk/src/host.ts#L1810-1834](../../../../packages/sdk/src/host.ts#L1810-1834) - `stampedCalls` and `withWorkerUri`, the pattern for a `_meta` key kept across actions"
---

## Goal

A helper in the sdk builds `{startedAt, endedAt, durationMs}` from two times and merges it into a call's `_meta` beside the keys already there, so a plugin that resends `_meta` keeps both `toolKind` and the times.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's times are stamped by its plugin](../../../decisions/a-tool-calls-times-are-stamped-by-its-plugin.md) | Softov, 2026-09-29 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - The sdk has one helper that builds and keeps a tool call's timing _meta](task-01-stamp.md) | todo | - |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-stamp.md](task-01-stamp.md).
- **Open questions:** none.
- **Watch out for:** a `_meta` sent after the start replaces the whole `_meta`: it must carry the times and `toolKind` again.
