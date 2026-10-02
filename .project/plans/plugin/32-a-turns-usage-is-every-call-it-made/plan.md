---
title: A turn's usage is every model call it made, sent as it runs, with the harness's cost
domain: plugin
status: planned
priority: high
created: 2026-10-01
revalidated: 2026-10-01
requires: []
refs:
  - "[code://packages/agent-claude/src/session.ts#L2668-L2675](../../../../packages/agent-claude/src/session.ts#L2668-L2675) - claude reads usage only from `result`, main loop only, no cache writes"
  - "[code://packages/agent-pi/src/session.ts#L575-L589](../../../../packages/agent-pi/src/session.ts#L575-L589) - pi reports the last call of a turn, not the sum"
  - "[code://packages/agent-cofold/src/mapping.ts#L566-L581](../../../../packages/agent-cofold/src/mapping.ts#L566-L581) - cofold reports only the run's aggregate, without its cost"
  - "[code://packages/agent-acp/src/mapping.ts#L219-L227](../../../../packages/agent-acp/src/mapping.ts#L219-L227) - ACP drops `usage_update`"
  - "[code://packages/agent-cofold/src/mapping.ts#L103-L119](../../../../packages/agent-cofold/src/mapping.ts#L103-L119) - the `_meta.cacheWriteTokens` and `reasoningTokens` spelling the others follow"
  - npm://@microsoft/agent-host-protocol@0.9.0 - `chat/usage` replaces the active turn's usage (`channels-chat/reducer.ts` line 741), so a running total can be sent after each call
  - file:///github/ahp-review/prospect/ahpd-control-accounting-code-grounded-investigation.md - section 5, usage producers and their gaps
---

## Goal

Every backend reports a turn's usage as the sum of every model call the turn made, subagent calls included, sent as a running total after each call, with cache writes and the harness's own cost when it reports one.
Today pi undercounts any turn with tool calls, claude misses cache writes and subagents, cofold and claude never send cost, and ACP sends nothing.
A meter, and a limit checked mid-turn, need these numbers first.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Runtime path

```
harness per-call usage -> backend sums the turn -> chat/usage (running total, _meta.cost) -> activeTurn.usage -> clients, and later the agent meter
```

### Gaps

- claude: per-call `message_delta.usage` is ignored; `result.usage` is main loop only; `modelUsage[*].costUSD` is never read.
- pi: `message_end` usage overwrites instead of adding; `usage.cost` is never read.
- cofold: `model.completed.usage` is ignored; `outcome.cost` is never read.
- ACP: `usage_update` and `PromptResponse.usage` are both ignored.

## Decisions locked in

| What | Source | Plan |
| --- | --- | --- |
| A turn's usage is sent as a running total after each model call, and a last one at the turn's end | Softov, 2026-10-01, on a safe cap for agents, asked whether usage comes mid-turn: "Claude, pi and cofold could return midturn? Since cofould and pi use api." | p1, p2, p3 |
| The harness's own cost, when it reports one, rides `usage._meta.cost` as `{ amount, currency }` | Softov, 2026-10-01, asked "Which price counts against budgets?": "Harness cost when present"; the shape (defaulted: ACP's own `Cost`) | p1, p2, p3, p4 |
| Cache writes ride `usage._meta.cacheWriteTokens`, as cofold and pi already send them | [`code://packages/agent-cofold/src/mapping.ts#L103-L119`](../../../../packages/agent-cofold/src/mapping.ts#L103-L119) | p1 |
| A cost the harness marks as a guess is not sent | (defaulted: claude's `costBasis: 'unknown'` means no price row; the price table is the fallback later) | p1 |

## Tasks

| Plan | Status | Depends on |
| --- | --- | --- |
| [p1 - claude counts every call, subagents and cache writes included, with its cost](../32-a-turns-usage-is-every-call-it-made-p1-claude-counts-every-call/plan.md) | planned | - |
| [p2 - pi sums every call of a turn, with its cost](../32-a-turns-usage-is-every-call-it-made-p2-pi-sums-its-calls/plan.md) | planned | - |
| [p3 - cofold counts each step, and sends the run's cost](../32-a-turns-usage-is-every-call-it-made-p3-cofold-counts-each-step/plan.md) | planned | - |
| [p4 - ACP sends the cost and tokens its agent reports](../32-a-turns-usage-is-every-call-it-made-p4-acp-reports-what-it-has/plan.md) | planned | - |

## Risks and tradeoffs

- Restored turns keep the usage their transcripts give today; only the live path changes.
- Running totals are display values until the agent meter records them; nothing is enforced here.

## Resume state

- **Done so far:** planned 2026-10-01.
- **Next action:** any of p1 to p4; they are independent.
- **Open questions:** none.
- **Watch out for:** `chat/usage` must be sent before `chat/turnComplete`, or the reducer hangs it on nothing (comment at claude `session.ts` 2665-2667).

## Final verification checklist

- [ ] A claude, pi and cofold turn with tool calls shows a usage that grows during the turn and equals the sum of its calls at the end.
- [ ] `plans/index.md` updated.
