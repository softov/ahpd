---
title: ACP tool calls carry their start and end while the daemon runs
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
  - "[code://packages/agent-acp/src/session.ts#L281-283](../../../../packages/agent-acp/src/session.ts#L281-283) - raw `updates` stored with no receive time"
  - "[code://packages/agent-acp/src/agent.ts#L96-104](../../../../packages/agent-acp/src/agent.ts#L96-104) - the transcript is in memory and lost on restart"
---

## Goal

The plugin stamps the receive time of a call's first `tool_call` as start and of the update that ends it as end, and keeps them with the stored updates so the in-memory transcript has them. ACP has no time of its own; a call replayed by `session/load` after a restart carries no times, since its receive time is the replay's.

## Decisions locked in

| Decision | Source |
| --- | --- |
| [A tool call's times are stamped by its plugin](../../../decisions/a-tool-calls-times-are-stamped-by-its-plugin.md) | Softov, 2026-09-29 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - ACP tool calls carry their start and end while the daemon runs](task-01-stamp.md) | todo | p1 |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-stamp.md](task-01-stamp.md).
- **Open questions:** none.
- **Watch out for:** a `_meta` sent after the start replaces the whole `_meta`: it must carry the times and `toolKind` again.
