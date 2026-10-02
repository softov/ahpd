---
title: pi sums every call of a turn, with its cost
domain: plugin
status: built
priority: high
created: 2026-10-01
revalidated: 2026-10-01
requires:
  - plans/plugin/32-a-turns-usage-is-every-call-it-made/plan.md
refs:
  - "[code://packages/agent-pi/src/session.ts#L518](../../../../packages/agent-pi/src/session.ts#L518) - each assistant `message_end` overwrites `answered`"
  - "[code://packages/agent-pi/src/session.ts#L575-L589](../../../../packages/agent-pi/src/session.ts#L575-L589) - usage sent once, at `agent_settled`, from the last message"
  - "[code://packages/agent-pi/src/mapping.ts#L141-L163](../../../../packages/agent-pi/src/mapping.ts#L141-L163) - `usageOf`, which never reads `usage.cost`"
  - npm://@earendil-works/pi-ai@^0.87.1 - `AssistantMessage.usage.cost.total`, computed per call
---

## Goal

A pi turn's usage is the sum of every assistant message's usage, sent after each `message_end`, with the summed `usage.cost.total` as the cost.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Running total per call, cost in `_meta.cost` | [plugin 32](../32-a-turns-usage-is-every-call-it-made/plan.md) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - pi sums its calls](task-01-sum.md) | done | - |

## Resume state

- **Done so far:** built 2026-10-01, see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** keep the rule that an all-zero report from a failed call is not usage (`mapping.ts` 148-152).
