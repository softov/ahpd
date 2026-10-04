---
title: ACP tool calls carry their start and end while the daemon runs
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
  - "[code://packages/agent-acp/src/types.ts#L314-L336](../../../../packages/agent-acp/src/types.ts#L314-L336) - `WatchedTurn.updates`, raw `SessionUpdate[]` with no receive time"
  - "[code://packages/agent-acp/src/types.ts#L222-L249](../../../../packages/agent-acp/src/types.ts#L222-L249) - `AcpCall`, what the mapping keeps of a call between updates"
  - "[code://packages/agent-acp/src/session.ts#L669-L678](../../../../packages/agent-acp/src/session.ts#L669-L678) - where a live update is stored, then mapped"
  - "[code://packages/agent-acp/src/mapping.ts#L334](../../../../packages/agent-acp/src/mapping.ts#L334) - `mapUpdate(turn, update)`; `tool_call` at 363 and `tool_call_update` at 379"
  - "[code://packages/agent-acp/src/mapping.ts#L173-L179](../../../../packages/agent-acp/src/mapping.ts#L173-L179) - `opened`, the `chat/toolCallStart` for the first update about a call"
  - "[code://packages/agent-acp/src/mapping.ts#L188-L209](../../../../packages/agent-acp/src/mapping.ts#L188-L209) - `closed`, the `chat/toolCallComplete` for the update that ends it"
  - "[code://packages/agent-acp/src/session.ts#L846-L894](../../../../packages/agent-acp/src/session.ts#L846-L894) - a permission request, which can open a call's row before any update about it"
  - "[code://packages/agent-acp/src/session.ts#L1563-L1640](../../../../packages/agent-acp/src/session.ts#L1563-L1640) - the terminal call a person's own command runs"
  - "[code://packages/agent-acp/src/transcript.ts#L50](../../../../packages/agent-acp/src/transcript.ts#L50) - the transcript re-runs `mapUpdate` over the stored updates"
  - "[code://packages/agent-acp/src/transcript.ts#L98-L122](../../../../packages/agent-acp/src/transcript.ts#L98-L122) - `replayedTurns`, the `session/load` replay, whose updates have no time of their own"
  - "[code://packages/agent-acp/src/agent.ts#L104-L107](../../../../packages/agent-acp/src/agent.ts#L104-L107) - the transcript is this process's record, in memory and lost on restart"
---

## Goal

The plugin stamps a call's start with the time it received the first update about the call and its end with the time it received the update that ends it, and keeps those times with the stored updates so the in-memory transcript has them.
ACP has no time of its own; a call replayed by `session/load` after a restart carries no times, since its receive time is the replay's.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's times are stamped by its plugin, as ahpd keys](../../../decisions/a-tool-calls-times-are-stamped-as-ahpd-keys.md) | Softov, 2026-10-03 |

| What | Source | Task |
| --- | --- | --- |
| A stored update becomes `{ update, at? }`; a live one is stored with its receive time, and `replayedTurns` stores none | Softov, 2026-09-29, asked "ACP has no times in its protocol and no history after a daemon restart... Accept that?": "Accept it" | 01 |
| `mapUpdate` takes the time as a parameter and stamps only when one is given | (defaulted: a replayed update has no time, and the replay's own would be wrong) | 01 |
| A call is opened by the first update about it, `tool_call` or `tool_call_update`, not only by `tool_call` | [`code://packages/agent-acp/src/mapping.ts#L379`](../../../../packages/agent-acp/src/mapping.ts#L379) | 01 |
| A call starts at the receive time of the first update about it | Softov, 2026-10-03, asked "plugin/29 p4: for an ACP agent's tool call, which moment counts as its start?": "First update about it" | 01 |
| A call ends at the receive time of the update that completes or fails it; a call that arrives finished in one update has the same start and end | (defaulted: the end is the one update that closes the row, `closed` in `mapping.ts`) | 01 |
| Only a `session/update` stamps; a permission request that opens the row first does not, and the start waits for the first update | Softov, 2026-10-03, asked "ACP: a permission request can show a call before any update about it. Should only updates set the start (history replays only updates)?": "Updates only" | 01 |
| The terminal call a person's own command runs is stamped like any other, on the plugin's clock | Softov, 2026-10-03, asked "Extra scope the writer added ... Keep it?": "Keep all" | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - ACP tool calls carry their start and end while the daemon runs](task-01-stamp.md) | done | p1 |

## Resume state

- **Done so far:** task 01, 2026-10-03.
- **Next action:** p5.
- **Open questions:** none.
- **Watch out for:** a `_meta` sent after the start replaces the whole `_meta`: it must carry the `ahpd.` times and `toolKind` again.
