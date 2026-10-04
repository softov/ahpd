---
title: cofold tool calls carry their start and end live too, and restored calls keep their kind
domain: plugin
status: built
priority: medium
created: 2026-09-29
revalidated: 2026-10-03
requires:
  - plans/plugin/29-a-tool-call-says-when-it-ran/plan.md
  - plans/plugin/29-a-tool-call-says-when-it-ran-p1-the-sdk-keeps-a-calls-times/plan.md
decisions:
  - decisions/a-tool-calls-times-are-stamped-as-ahpd-keys.md
refs:
  - "[code://packages/agent-cofold/src/mapping.ts#L370-L393](../../../../packages/agent-cofold/src/mapping.ts#L370-L393) - `tool.proposed`, which holds the part and sends `toolKind` on `chat/toolCallStart`"
  - "[code://packages/agent-cofold/src/mapping.ts#L517-L542](../../../../packages/agent-cofold/src/mapping.ts#L517-L542) - `tool.started`, which sends `chat/toolCallReady` with no `_meta` and drops the event's `at`"
  - "[code://packages/agent-cofold/src/mapping.ts#L544-L556](../../../../packages/agent-cofold/src/mapping.ts#L544-L556) - `tool.completed`, which drops the event's `at` and `durationMs`"
  - "[code://packages/agent-cofold/src/mapping.ts#L564-L585](../../../../packages/agent-cofold/src/mapping.ts#L564-L585) - `tool.denied`, a call the run refused before it started"
  - "[code://packages/agent-cofold/src/tools.ts#L306-L323](../../../../packages/agent-cofold/src/tools.ts#L306-L323) - `toolCompleteAction`, which takes no `_meta`"
  - "[code://packages/agent-cofold/src/transcript.ts#L107-L133](../../../../packages/agent-cofold/src/transcript.ts#L107-L133) - `callPartOf`: restored calls carry unprefixed `durationMs`, `startedAt` and `endedAt`, and lose `toolKind` because it does not merge `toolMetaOf`"
  - "[code://packages/agent-cofold/src/transcript.ts#L205-L217](../../../../packages/agent-cofold/src/transcript.ts#L205-L217) - the restored times, gathered from each run's `tool.started` and `tool.completed` events"
  - "[code://packages/agent-cofold/test/agent-cofold-store.test.ts#L337](../../../../packages/agent-cofold/test/agent-cofold-store.test.ts#L337) - asserts the bare `durationMs` today"
---

## Goal

Live, a call's `_meta` takes `tool.started`'s `at` as start and `tool.completed`'s `at` and `durationMs` as end.
Restored, a call keeps its `toolKind` beside its times, and the times it already has move to the `ahpd.` names.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's times are stamped by its plugin, as ahpd keys](../../../decisions/a-tool-calls-times-are-stamped-as-ahpd-keys.md) | Softov, 2026-10-03 |

| What | Source | Task |
| --- | --- | --- |
| The restored calls' unprefixed `startedAt`, `endedAt` and `durationMs` become the `ahpd.` names here, so [host/43 p4](../../host/43-the-wire-is-the-protocols-p4-ahpds-own-meta-keys-say-ahpd/plan.md) does not rename them again | the decision; host/43 p4's Resume state, Softov, 2026-10-03 | 01 |
| A call the run refused (`tool.denied`) carries no times, since it never started | (defaulted: as p2 does for a denied call) | 01 |
| A restored call with a `tool.completed` and no `tool.started` takes its end minus its `durationMs` as its start | Softov, 2026-10-03, asked "Extra scope the writer added ... Keep it?": "Keep all" | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - cofold tool calls carry their start and end live too, and restored calls keep their kind](task-01-stamp.md) | done | p1 |

## Resume state

- **Done so far:** task 01, 2026-10-03.
- **Next action:** none; plugin/29 p1 through p5 are implemented.
- **Open questions:** none.
- **Watch out for:** a `_meta` sent after the start replaces the whole `_meta`: it must carry the `ahpd.` times and `toolKind` again. If host/43 p4 renamed the restored keys first, the rename here is already done and only the move to the helper is left.
