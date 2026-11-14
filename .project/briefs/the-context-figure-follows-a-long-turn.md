---
title: The context figure follows a long turn
created: 2026-11-14
refs:
  - git://805736b65 - the commit of ahpd the facts were checked at
  - "[code://packages/agent-claude/src/session/query.ts#L887-L910](../../packages/agent-claude/src/session/query.ts#L887-L910) - `askContext`: `getContextUsage` with a 2 s wait"
  - "[code://packages/agent-claude/src/session/query.ts#L938-L950](../../packages/agent-claude/src/session/query.ts#L938-L950) - `introduce`: the figure asked when the session starts"
  - "[code://packages/agent-claude/src/session/query.ts#L1362-L1370](../../packages/agent-claude/src/session/query.ts#L1362-L1370) - the figure asked when a turn ends"
  - "[code://packages/agent-claude/src/session/query.ts#L1031-L1033](../../packages/agent-claude/src/session/query.ts#L1031-L1033) - a `compact_boundary` adds a line to the chat and asks nothing"
  - "[code://packages/agent-claude/src/session/query.ts#L963-L975](../../packages/agent-claude/src/session/query.ts#L963-L975) - `sayMeta`: `session/metaChanged` when the usage keys moved"
---

# The context figure follows a long turn

Softov's goal: the context window in a client shows what the session holds now, also during a long turn and after a compaction.

## What Softov saw on 2026-11-14

- A session of agent-claude on DeepSeek ran one turn for 24 minutes, with 188 tool calls and one compaction.
- ahpw's usage panel showed 72k of 200k for the whole turn, and the same after the compaction.

## What ahpd has now

- agent-claude asks the CLI for the context with `getContextUsage` at two moments: when the session starts, and when a turn ends.
- Nothing asks during a turn. A `compact_boundary` adds "Conversation compacted" to the chat and asks nothing.
- So a client shows the figure of the last turn that ended, for the whole of a running turn.
- `sayMeta` sends the figure in the session's `_meta` with `session/metaChanged`, and only when it changed.
- ahpw lays the session's `_meta` over the last turn's, so a `session/metaChanged` during a turn reaches the panel. No client change is needed.

## Answers

| Question | Answer | Date |
| --- | --- | --- |
| When the figure updates | During a turn, throttled: after each compaction, and at most every 30 s after a model reply | 2026-11-14 |

## The change

- After a `compact_boundary`, agent-claude asks `getContextUsage` and sends the figure with `sayMeta`.
- During a turn, after a model reply, it asks again where 30 s have passed since the last ask.
- One ask runs at a time. A late or failed answer keeps the last figure, as now.
- The ask at the turn's end stays as it is.
