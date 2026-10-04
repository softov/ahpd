---
title: Claude tool calls carry their start and end, live and restored
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
  - "[code://packages/agent-claude/src/session.ts#L1830-L1845](../../../../packages/agent-claude/src/session.ts#L1830-L1845) - `chat/toolCallReady` with `confirmed: 'not-needed'`, the start of a call nobody is asked about; it sends `_meta` only for a spawning call today"
  - "[code://packages/agent-claude/src/session.ts#L2144-L2152](../../../../packages/agent-claude/src/session.ts#L2144-L2152) - the ready `canUseTool` sends for a call a person is asked about, with no `_meta`"
  - "[code://packages/agent-claude/src/session.ts#L3635-L3642](../../../../packages/agent-claude/src/session.ts#L3635-L3642) - `chat/toolCallConfirmed`, the start of a call a person approved"
  - "[code://packages/agent-claude/src/session.ts#L1950-L1956](../../../../packages/agent-claude/src/session.ts#L1950-L1956) - `chat/toolCallComplete`, which sends `_meta` only when `progressed`"
  - "[code://packages/agent-claude/src/session.ts#L3000-L3057](../../../../packages/agent-claude/src/session.ts#L3000-L3057) - the terminal call a person's own command runs"
  - "[code://packages/agent-claude/src/transcript.ts#L204-L389](../../../../packages/agent-claude/src/transcript.ts#L204-L389) - `buildTurns`: frame timestamps give only the turn's `startedAt`; tool calls get none, turns get no `duration`"
---

## Goal

Live, a call's start is when it starts running, after any approval, on the plugin's clock, and its end is when it completes.
Restored, a call takes its `tool_use` frame time as start and its `tool_result` frame time as end, and each restored turn gets its `duration`.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's times are stamped by its plugin, as ahpd keys](../../../decisions/a-tool-calls-times-are-stamped-as-ahpd-keys.md) | Softov, 2026-10-03 |

| What | Source | Task |
| --- | --- | --- |
| A live call starts at whichever of its two start actions is sent: `chat/toolCallReady` with `confirmed: 'not-needed'`, or `chat/toolCallConfirmed` approved | Softov, 2026-09-29, asked "For a live Claude call, when should 'started' be?": "At approval, live" | 01 |
| `chat/toolCallComplete` always sends `_meta`, carrying the times and `toolKind` | the decision: an action's `_meta` replaces the call's whole `_meta` | 01 |
| A denied call carries no times, since it never ran | (defaulted: there is no start to stamp) | 01 |
| The terminal call a person's own command runs is stamped like any other | Softov, 2026-10-03, asked "Extra scope the writer added ... Keep it?": "Keep all" | 01 |
| A call `canUseTool` asks about after its not-needed ready went out is stamped again at approval, and loses its times if denied | Softov, 2026-10-03, asked "Claude: a call stamped early and then asked for approval is re-stamped at approval; a denied call loses its times. OK?": "Yes" | 01 |
| A restored turn's `duration` is its last frame's time minus its `startedAt` | Softov, 2026-10-03, asked "Extra scope the writer added ... Keep it?": "Keep all" | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Claude tool calls carry their start and end, live and restored](task-01-stamp.md) | done | p1 |

## Resume state

- **Done so far:** task 01, 2026-10-03.
- **Next action:** p3.
- **Open questions:** none.
- **Watch out for:** a `_meta` sent after the start replaces the whole `_meta`: it must carry the `ahpd.` times and `toolKind` again.
