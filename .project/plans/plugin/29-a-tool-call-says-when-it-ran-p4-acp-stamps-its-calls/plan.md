---
title: ACP tool calls carry their start and end while the daemon runs
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
  - "[code://packages/agent-acp/src/types.ts#L314-L336](../../../../packages/agent-acp/src/types.ts#L314-L336) - `WatchedTurn.updates`, raw `SessionUpdate[]` with no receive time"
  - "[code://packages/agent-acp/src/session.ts#L669-L678](../../../../packages/agent-acp/src/session.ts#L669-L678) - where a live update is stored, then mapped"
  - "[code://packages/agent-acp/src/mapping.ts#L334](../../../../packages/agent-acp/src/mapping.ts#L334) - `mapUpdate(turn, update)`; `tool_call` at 363 and `tool_call_update` at 379"
  - "[code://packages/agent-acp/src/transcript.ts#L50](../../../../packages/agent-acp/src/transcript.ts#L50) - the transcript re-runs `mapUpdate` over the stored updates"
  - "[code://packages/agent-acp/src/transcript.ts#L98-L120](../../../../packages/agent-acp/src/transcript.ts#L98-L120) - `replayedTurns`, the `session/load` replay, whose updates have no time of their own"
  - "[code://packages/agent-acp/src/agent.ts#L96-L104](../../../../packages/agent-acp/src/agent.ts#L96-L104) - the transcript is in memory and lost on restart"
---

## Goal

The plugin stamps a call's start and end with the times it received them, the start at the update the plan's open question settles and the end at the update that ends the call, and keeps them with the stored updates so the in-memory transcript has them. ACP has no time of its own; a call replayed by `session/load` after a restart carries no times, since its receive time is the replay's.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's times are stamped by its plugin](../../../decisions/a-tool-calls-times-are-stamped-by-its-plugin.md) | Softov, 2026-09-29 |

| What | Source | Task |
| --- | --- | --- |
| A stored update becomes `{ update, at? }`; a live one is stored with its receive time, and `replayedTurns` stores none | Softov, 2026-09-29, asked "ACP has no times in its protocol and no history after a daemon restart... Accept that?": "Accept it" | 01 |
| `mapUpdate` takes the time as a parameter and stamps only when one is given | (defaulted: a replayed update has no time, and the replay's own would be wrong) | 01 |
| A call is opened by the first update about it, `tool_call` or `tool_call_update`, not only by `tool_call` | [`code://packages/agent-acp/src/mapping.ts#L379`](../../../../packages/agent-acp/src/mapping.ts#L379) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - ACP tool calls carry their start and end while the daemon runs](task-01-stamp.md) | todo | p1, and the open question in Resume state |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-stamp.md](task-01-stamp.md).
- **Open question (ask before task 01):** which receive time is a call's start - (a) the receive time of the first update about the call, or (b) the receive time of the first update that says it is running (`in_progress`).
- **Watch out for:** a `_meta` sent after the start replaces the whole `_meta`: it must carry the times and `toolKind` again.
