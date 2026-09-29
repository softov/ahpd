---
title: A tool call says when it started and how long it ran, live and in history
domain: plugin
status: planned
priority: medium
created: 2026-09-29
revalidated: 2026-09-29
requires: []
decisions:
  - decisions/a-tool-calls-times-are-stamped-by-its-plugin.md
refs:
  - https://github.com/microsoft/agent-host-protocol - AHP 0.9.0: a turn has `startedAt` and `duration`, a tool call has only an open `_meta`; an action's `_meta` replaces the call's whole `_meta` (`channels-chat/reducer.ts` `tcBaseWithMeta`)
  - "[code://packages/agent-cofold/src/transcript.ts#L106-217](../../../../packages/agent-cofold/src/transcript.ts#L106-217) - the names already shipped on restored cofold calls"
  - "[code://packages/sdk/src/host.ts#L1854-1870](../../../../packages/sdk/src/host.ts#L1854-1870) - `telemetered` clocks calls live for OTLP only"
---

## Goal

Every tool call a backend runs says when it started, when it ended and how long it ran, so a client can show "worked on X for Y s", both while the session runs and after the daemon restarts, wherever the harness kept the times.

## Reconnaissance

### Runtime path

```
harness event (time or none) -> plugin maps the tool call -> _meta.startedAt / endedAt / durationMs -> chat/toolCall* action and snapshot -> ahpapp, ahpc
harness transcript on disk -> plugin restores the turns -> the same _meta on each restored call
```

### Gaps

- No plugin puts a time on a live tool call; cofold drops the `at` and `durationMs` it has.
- Restored Claude and pi calls get no time though their files have one; restored Claude turns have no `duration`.
- Restored cofold calls lose `toolKind`.
- ACP has no time on a tool call in v1 or the v2 draft; its history comes back only as a `session/load` replay ([acp/02](../../acp/02-replay-lands-in-history/plan.md)), whose receive times are the replay's.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's start and end are stamped by the plugin that runs it, as _meta startedAt, endedAt and durationMs](../../../decisions/a-tool-calls-times-are-stamped-by-its-plugin.md) | Softov, 2026-09-29 |

| What | Source | Plan |
| --- | --- | --- |
| A live Claude call starts when it starts running, after any approval, on the plugin's clock; a restored one uses its `tool_use` frame time | Softov, 2026-09-29, asked "For a live Claude call, when should 'started' be?": "At approval, live" | p2 |
| Restored pi calls from a parallel batch share the batch's end time | Softov, 2026-09-29, asked "pi in parallel mode writes every tool result of a batch at the batch's end... Accept that?": "Accept it" | p3 |
| ACP calls are timed by receive time while the daemon runs; calls replayed after a restart carry none | Softov, 2026-09-29, asked "ACP has no times in its protocol and no history after a daemon restart... Accept that?": "Accept it" | p4 |
| The host adds no times of its own; a backend that stamps nothing shows none | Softov, 2026-09-29, asked "A backend that stamps nothing... should the host fill in times from its own clock?": "No host fallback" | - |

## Tasks

| Plan | Status | Depends on |
| --- | --- | --- |
| [p1 - The sdk has one helper that builds and keeps a tool call's timing _meta](../29-a-tool-call-says-when-it-ran-p1-the-sdk-keeps-a-calls-times/plan.md) | planned | - |
| [p2 - Claude tool calls carry their start and end, live and restored](../29-a-tool-call-says-when-it-ran-p2-claude-stamps-its-calls/plan.md) | planned | p1 |
| [p3 - pi tool calls carry their start and end, live and restored](../29-a-tool-call-says-when-it-ran-p3-pi-stamps-its-calls/plan.md) | planned | p1 |
| [p4 - ACP tool calls carry their start and end while the daemon runs](../29-a-tool-call-says-when-it-ran-p4-acp-stamps-its-calls/plan.md) | planned | p1 |
| [p5 - cofold tool calls carry their start and end live too, and restored calls keep their kind](../29-a-tool-call-says-when-it-ran-p5-cofold-stamps-its-live-calls/plan.md) | planned | p1 |

## Risks and tradeoffs

- VS Code reads no per-call time, so only ahpapp and ahpc show it.

## Resume state

- **Done so far:** researched and planned 2026-09-29.
- **Next action:** p1, then p2 to p5.
- **Open questions:** none.
- **Watch out for:** every `_meta` a plugin sends after a call starts must carry the timing keys and `toolKind` again.

## Final verification checklist

- [ ] In ahpapp, a live call and a restored call of each backend show a duration.
- [ ] `plans/index.md` updated.
