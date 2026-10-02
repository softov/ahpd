---
title: ACP sends the cost and tokens its agent reports
domain: plugin
status: built
priority: medium
created: 2026-10-01
revalidated: 2026-10-01
requires:
  - plans/plugin/32-a-turns-usage-is-every-call-it-made/plan.md
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L219-L227](../../../../packages/agent-acp/src/mapping.ts#L219-L227) - `usage_update` falls into `default: return []`"
  - "[code://packages/agent-acp/src/session.ts#L737-L738](../../../../packages/agent-acp/src/session.ts#L737-L738) - only `stopReason` is read from the prompt response"
  - npm://@agentclientprotocol/sdk@^1.4.0 - `usage_update { used, size, cost? }`, cost cumulative per session; `PromptResponse.usage` per turn, marked unstable
---

## Goal

An ACP turn reports the cost its agent sent during the turn, as the change in the session's cumulative `usage_update.cost`, and the tokens from `PromptResponse.usage` when the agent sends them.
ACP has no per-call counts, so there is no running token total.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Cost in `_meta.cost`, sent as it changes | [plugin 32](../32-a-turns-usage-is-every-call-it-made/plan.md) | 01 |
| `PromptResponse.usage` is read although unstable, and ignored when absent | (defaulted: it is the only per-turn token count ACP has) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - ACP reports what it has](task-01-report.md) | done | - |

## Resume state

- **Done so far:** built 2026-10-01, see [implemented.md](implemented.md).
- **Next action:** none.
- **Open questions:** none.
- **Watch out for:** `used` and `size` are the context window, not usage; they are not tokens spent.
