---
title: The context figure follows a long turn
domain: claude
status: planned
priority: medium
created: 2026-11-14
revalidated: 2026-11-14
refs:
  - git://3f11a2751 - the last commit that holds the brief this plan covers, .project/briefs/the-context-figure-follows-a-long-turn.md
  - "[code://packages/agent-claude/src/session/query.ts#L860-L909](../../../../packages/agent-claude/src/session/query.ts#L860-L909) - `inTime` and `askContext`: `getContextUsage` with a 2 s wait, no answer on a late or failed one"
  - "[code://packages/agent-claude/src/session/query.ts#L938-L950](../../../../packages/agent-claude/src/session/query.ts#L938-L950) - `introduce`: the pattern to copy, which keeps a figure only when no later one came meanwhile"
  - "[code://packages/agent-claude/src/session/query.ts#L963-L975](../../../../packages/agent-claude/src/session/query.ts#L963-L975) - `sayMeta`: `session/metaChanged` when the usage keys moved"
  - "[code://packages/agent-claude/src/session/query.ts#L1031-L1034](../../../../packages/agent-claude/src/session/query.ts#L1031-L1034) - a `compact_boundary` adds a notice and asks nothing"
  - "[code://packages/agent-claude/src/session/query.ts#L1083-L1086](../../../../packages/agent-claude/src/session/query.ts#L1083-L1086) - a model reply on the main chain, read while a turn runs"
  - "[code://packages/agent-claude/src/session/query.ts#L1362-L1370](../../../../packages/agent-claude/src/session/query.ts#L1362-L1370) - the ask when a turn ends, which stays"
  - "[code://packages/agent-claude/src/session/context.ts#L386-L393](../../../../packages/agent-claude/src/session/context.ts#L386-L393) - `contextFigure` and `usageSaid` on the session's state"
  - "[code://packages/agent-claude/test/agent-claude-context.test.ts](../../../../packages/agent-claude/test/agent-claude-context.test.ts) - the mocked SDK that counts `getContextUsage` asks, where the new cases go"
  - "[code://packages/agent-claude/test/agent-claude-session-usage.test.ts](../../../../packages/agent-claude/test/agent-claude-session-usage.test.ts) - the cases on `session/metaChanged` before any turn"
---

## Goal

The context window in a client shows what a Claude session holds now, also during a long turn and after a compaction.
Today the figure changes only when the session starts and when a turn ends.

## Reconnaissance

The files read and the patterns to reuse are the `refs` in the frontmatter, each with its note.

### Searches performed

- `rg "askContext" packages/agent-claude/src` - called in `introduce` and at a turn's end, nowhere else.
- `rg "contextFigure|usageSaid" packages/agent-claude/src` - only `query.ts` and the two fields in `context.ts`.
- `rg "getContextUsage|contextAttribution" docs packages/agent-claude/README.md` - no document says when the figure is asked, so no document changes.

### Runtime path

```
CLI frame (compact_boundary, or assistant on the main chain) -> consume -> followContext -> askContext -> ctx.contextFigure -> sayMeta -> session/metaChanged -> client panel
```

### Gaps

- Nothing asks for the figure while a turn runs.
- A `compact_boundary` does not ask, so the figure from before the compaction stays until the turn ends.

## Answers

| What | Source | Task |
| --- | --- | --- |
| The figure updates during a turn, throttled: after each compaction, and at most every 30 s after a model reply | Softov chose "During the turn, throttled", 2026-11-14 | 01 |
| Only agent-claude changes | (defaulted: ahpw lays the session's `_meta` over the turn's, so a `session/metaChanged` during a turn reaches the panel) | 01 |
| The 30 s count from the last ask of any kind, the handshake's too | (defaulted: one clock for all asks is the simplest throttle, and it keeps today's count of asks for a short turn) | 01 |
| A compaction asks even within 30 s of the last ask | (defaulted: the figure before a compaction is the wrong one) | 01 |
| One mid-turn ask runs at a time. A compaction during an ask asks once more when it settles | (defaulted: an ask started before the compaction answers with the figure before it) | 01 |
| A mid-turn ask does not hold the stream, and the turn's end does not wait for it | (defaulted: `introduce` already runs beside the stream, and the turn's end has its own ask) | 01 |
| A mid-turn answer is kept only when no later figure came meanwhile | (defaulted: the same guard as `introduce`) | 01 |
| A model reply of a subagent asks nothing | (defaulted: its frames say nothing of the main context) | 01 |

## Proposed architecture

- **Data flow** - `consume` calls `followContext` on a `compact_boundary` and on a main-chain `assistant` frame while a turn runs. `followContext` calls `askContext`, keeps the answer in `ctx.contextFigure`, and calls `sayMeta`.
- **Event flow** - `session/metaChanged`, which exists. No new action.
- **State flow** - three new fields on the session's state. They hold the time of the last ask, a running mid-turn ask, and an ask a compaction owes.
- **Layer responsibilities** - agent-claude: the asks and the throttle. No change in sdk, server or clients.
- **Source-of-truth files** - [`code://packages/agent-claude/src/session/query.ts`](../../../../packages/agent-claude/src/session/query.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - the figure is asked during a turn](task-01-the-figure-is-asked-during-a-turn.md) | implemented | - |

## Risks and tradeoffs

- More `getContextUsage` requests on a long turn: at most one per 30 s, and one per compaction. Each has the 2 s wait it has now.
- The CLI may answer `getContextUsage` slowly while it streams. A late answer is logged and the last figure stays, as now.

## Resume state

- **Done so far:** task 01 implemented, 2026-11-14, uncommitted in the build worktree.
  - A compaction in a running turn asks the figure again.
  - A main-chain reply asks it again once 30 s have passed since the last ask.
  - Each answer goes to clients as `session/metaChanged`.
  - Review: the answer is dropped when the CLI was put away during the ask, as `introduce` does. The agent-claude suite passes, 672 of 672.
- **Next action:** the PR, then check and check-windows. The plan closes as `built` on Softov's word.
- **Open questions:** none.
- **Watch out for:** `agent-claude-context.test.ts` expects two asks for a short turn, and still reads two. The mid-turn cases advance `Date` 30 s because the handshake's ask starts the throttle.

## Final verification checklist

- [ ] A compaction in a running turn sends `session/metaChanged` with the new figure.
- [ ] A turn longer than 30 s asks again after a model reply, and not more often.
- [ ] A short turn asks twice, as now.
- [ ] A late or failed mid-turn answer keeps the last figure and does not hold the turn.
- [ ] The agent-claude suite passes, and check and check-windows are green.
