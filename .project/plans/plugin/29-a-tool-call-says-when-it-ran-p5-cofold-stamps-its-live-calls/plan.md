---
title: cofold tool calls carry their start and end live too, and restored calls keep their kind
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
  - "[code://packages/agent-cofold/src/mapping.ts#L496-535](../../../../packages/agent-cofold/src/mapping.ts#L496-535) - live mapping drops `at` and `durationMs`"
  - "[code://packages/agent-cofold/src/transcript.ts#L106-217](../../../../packages/agent-cofold/src/transcript.ts#L106-217) - restored calls: times present, `toolKind` lost because `callPartOf` does not merge `toolMetaOf`"
---

## Goal

Live, a call's `_meta` takes the event `at` as start and end and `tool.completed`'s `durationMs`. Restored, a call keeps its `toolKind` beside the times it already has.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's times are stamped by its plugin](../../../decisions/a-tool-calls-times-are-stamped-by-its-plugin.md) | Softov, 2026-09-29 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - cofold tool calls carry their start and end live too, and restored calls keep their kind](task-01-stamp.md) | todo | p1 |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-stamp.md](task-01-stamp.md).
- **Open questions:** none.
- **Watch out for:** a `_meta` sent after the start replaces the whole `_meta`: it must carry the times and `toolKind` again.
