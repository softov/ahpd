---
title: pi tool calls carry their start and end, live and restored
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
  - "[code://packages/agent-pi/src/mapping.ts#L251](../../../../packages/agent-pi/src/mapping.ts#L251) - `mapEvent(turn, event)`, which gains the time"
  - "[code://packages/agent-pi/src/mapping.ts#L87-L104](../../../../packages/agent-pi/src/mapping.ts#L87-L104) - `startCall`, which sends nothing for a call the model's stream opened already"
  - "[code://packages/agent-pi/src/mapping.ts#L327-L332](../../../../packages/agent-pi/src/mapping.ts#L327-L332) - `tool_execution_start`, with no time kept"
  - "[code://packages/agent-pi/src/mapping.ts#L348-L395](../../../../packages/agent-pi/src/mapping.ts#L348-L395) - `tool_execution_end`, with no time kept and no `_meta` on its `chat/toolCallComplete`"
  - "[code://packages/agent-pi/src/session.ts#L390-L416](../../../../packages/agent-pi/src/session.ts#L390-L416) - the `tool_call` hook's `ready`, which readies a call `not-needed` or asks about it, after `tool_execution_start`"
  - "[code://packages/agent-pi/src/session.ts#L1110-L1116](../../../../packages/agent-pi/src/session.ts#L1110-L1116) - `chat/toolCallConfirmed`, a person's answer"
  - "[code://packages/agent-pi/src/session.ts#L237-L252](../../../../packages/agent-pi/src/session.ts#L237-L252) - `releasePending`, a question cancelled as denied"
  - "[code://packages/agent-pi/src/session.ts#L880-L921](../../../../packages/agent-pi/src/session.ts#L880-L921) - `runCommand`, the shell call a person's own command runs"
  - "[code://packages/agent-pi/src/replay.ts#L62](../../../../packages/agent-pi/src/replay.ts#L62) - `raise`, how replay feeds `mapEvent`, discarding the actions"
  - "[code://packages/agent-pi/src/replay.ts#L111-L183](../../../../packages/agent-pi/src/replay.ts#L111-L183) - entry times (`entry.timestamp`) used only for the turn; tool events raised at 161 and 173"
---

## Goal

Live, the plugin stamps `Date.now()` when pi starts a call and when it ends one, and an asked call's start moves to its approval.
Restored, the entry times reach the replayed events so the live mapping stamps both paths the same way.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's times are stamped by its plugin, as ahpd keys](../../../decisions/a-tool-calls-times-are-stamped-as-ahpd-keys.md) | Softov, 2026-10-03 |

| What | Source | Task |
| --- | --- | --- |
| The entry time reaches the mapping as a parameter, `mapEvent(turn, event, at?)`; live passes none and the mapping uses `Date.now()`, replay's `raise` passes the entry's `timestamp` | (defaulted: pi's event type is pi's, and a parameter keeps it unchanged) | 01 |
| Restored pi calls from a parallel batch share the batch's end time | Softov, 2026-09-29, asked "pi in parallel mode writes every tool result of a batch at the batch's end... Accept that?": "Accept it" | 01 |
| A live call a person is asked about starts at its approval, and one denied carries no times | Softov, 2026-10-03, asked "pi: a tool call that asks the person first. When does it start?": "At approval" | 01 |
| The shell call a person's own command runs is stamped like any other | Softov, 2026-10-03, asked "Extra scope the writer added ... Keep it?": "Keep all" | 01 |
| The start rides on the held row's `_meta`, and on whichever action next carries it: `chat/toolCallStart` when `tool_execution_start` opens the row, else the hook's `chat/toolCallReady` | [`code://packages/agent-pi/src/mapping.ts#L88`](../../../../packages/agent-pi/src/mapping.ts#L88): `startCall` sends nothing for a row the model's stream opened | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - pi tool calls carry their start and end, live and restored](task-01-stamp.md) | done | p1 |

## Resume state

- **Done so far:** task 01, 2026-10-03.
- **Next action:** p4.
- **Open questions:** none.
- **Watch out for:** a `_meta` sent after the start replaces the whole `_meta`: it must carry the `ahpd.` times and `toolKind` again.
