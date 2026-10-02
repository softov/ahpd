---
title: claude counts every call, subagents and cache writes included, with its cost
domain: plugin
status: planned
priority: high
created: 2026-10-01
revalidated: 2026-10-01
requires:
  - plans/plugin/32-a-turns-usage-is-every-call-it-made/plan.md
refs:
  - "[code://packages/agent-claude/src/session.ts#L1215-L1225](../../../../packages/agent-claude/src/session.ts#L1215-L1225) - `usageOf`, drops `cache_creation_input_tokens`"
  - "[code://packages/agent-claude/src/session.ts#L1341-L1362](../../../../packages/agent-claude/src/session.ts#L1341-L1362) - `message_start` and `message_delta` are read, their usage is not"
  - "[code://packages/agent-claude/src/session.ts#L2668-L2675](../../../../packages/agent-claude/src/session.ts#L2668-L2675) - the one `chat/usage` today, from `result.usage`"
  - npm://@anthropic-ai/claude-agent-sdk@^0.3.278 - `message_delta.usage` per API call (subagents tagged `parent_tool_use_id`); `result.modelUsage[model].costUSD` and `costBasis`, cumulative per query
---

## Goal

A claude turn's usage is the sum of every API call it made, subagent calls included, with cache writes, sent after each call, and the turn's cost from `modelUsage` at the end.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| Running total per call, cost in `_meta.cost`, cache writes in `_meta.cacheWriteTokens`, no cost when `costBasis` is `unknown` | [plugin 32](../32-a-turns-usage-is-every-call-it-made/plan.md) | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - claude counts every call](task-01-count.md) | todo | - |

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-count.md](task-01-count.md).
- **Open questions:** none.
- **Watch out for:** `modelUsage` and `total_cost_usd` are cumulative per `query()`; the turn's cost is the difference from the previous `result`.
