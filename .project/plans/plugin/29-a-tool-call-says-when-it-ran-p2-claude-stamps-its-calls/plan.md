---
title: Claude tool calls carry their start and end, live and restored
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
  - "[code://packages/agent-claude/src/session.ts#L1830-L1845](../../../../packages/agent-claude/src/session.ts#L1830-L1845) - `chat/toolCallReady` with `confirmed: 'not-needed'`, the start of a call nobody is asked about"
  - "[code://packages/agent-claude/src/session.ts#L3636-L3643](../../../../packages/agent-claude/src/session.ts#L3636-L3643) - `chat/toolCallConfirmed`, the start of a call a person approved"
  - "[code://packages/agent-claude/src/session.ts#L1950-L1957](../../../../packages/agent-claude/src/session.ts#L1950-L1957) - `chat/toolCallComplete`, which sends `_meta` only when `progressed`"
  - "[code://packages/agent-claude/src/session.ts#L3000-L3057](../../../../packages/agent-claude/src/session.ts#L3000-L3057) - the terminal call a person's own command runs"
  - "[code://packages/agent-claude/src/transcript.ts#L204-L389](../../../../packages/agent-claude/src/transcript.ts#L204-L389) - `buildTurns`: frame timestamps give only the turn's `startedAt`; tool calls get none, turns get no `duration`"
---

## Goal

Live, a call's start is when it starts running, after any approval, on the plugin's clock, and its end is when it completes. Restored, a call takes its `tool_use` frame time as start and its `tool_result` frame time as end, and each restored turn gets its `duration`.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's times are stamped by its plugin](../../../decisions/a-tool-calls-times-are-stamped-by-its-plugin.md) | Softov, 2026-09-29 |

| What | Source | Task |
| --- | --- | --- |
| A live call starts at whichever of its two start actions is sent: `chat/toolCallReady` with `confirmed: 'not-needed'`, or `chat/toolCallConfirmed` approved | Softov, 2026-09-29, asked "For a live Claude call, when should 'started' be?": "At approval, live" | 01 |
| `chat/toolCallComplete` always sends `_meta`, carrying the times and `toolKind` | the decision: an action's `_meta` replaces the call's whole `_meta` | 01 |
| A denied call carries no times, since it never ran | (defaulted: there is no start to stamp) | 01 |
| The terminal call a person's own command runs is stamped like any other | (defaulted: it is a tool call on the wire, and a client draws its duration the same way) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - Claude tool calls carry their start and end, live and restored](task-01-stamp.md) | todo | p1 |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-stamp.md](task-01-stamp.md).
- **Open questions:** none.
- **Watch out for:** a `_meta` sent after the start replaces the whole `_meta`: it must carry the times and `toolKind` again.
