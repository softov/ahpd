---
title: The figure is asked during a turn
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L938-L950](../../../../packages/agent-claude/src/session/query.ts#L938-L950) - `introduce`, the guard to copy"
  - "[code://packages/agent-claude/src/session/query.ts#L1031-L1034](../../../../packages/agent-claude/src/session/query.ts#L1031-L1034) - the `compact_boundary` branch"
  - "[code://packages/agent-claude/src/session/query.ts#L1083-L1086](../../../../packages/agent-claude/src/session/query.ts#L1083-L1086) - the main-chain `assistant` branch"
---

## Objective

While a turn runs, agent-claude asks the CLI for the context after each compaction.
It also asks after a model reply when 30 s have passed since the last ask.
Each new figure goes to clients with `sayMeta`.

## Files

- `UPDATE: packages/agent-claude/src/session/context.ts:386-393` - three fields, `contextAskedAt`, `contextAsking` and `contextOwed`, and the `contextFigure` comment now says it changes during a turn.
- `UPDATE: packages/agent-claude/src/session/query.ts:860-975` - `CONTEXT_FOLLOW_MS`, `followContext`, and the time of each ask set in `askContext`.
- `UPDATE: packages/agent-claude/src/session/query.ts:1031-1034` - a `compact_boundary` in a running turn calls `followContext` with the throttle off.
- `UPDATE: packages/agent-claude/src/session/query.ts:1083-1086` - a main-chain `assistant` frame in a running turn calls `followContext`.
- `UPDATE: packages/agent-claude/test/agent-claude-context.test.ts` - the cases in *Validation*.

## Steps

1. Add `CONTEXT_FOLLOW_MS = 30_000` beside `CONTEXT_WAIT_MS`.
2. Set `ctx.contextAskedAt = Date.now()` in `askContext` before it calls `getContextUsage`.
3. Write `followContext(compacted: boolean): void` beside `introduce`, with a doc comment.
4. Make `followContext` set `ctx.contextOwed` and return when `ctx.contextAsking` is true and `compacted` is true.
5. Make `followContext` return when an ask runs, or when `compacted` is false and fewer than `CONTEXT_FOLLOW_MS` have passed.
6. Make it hold `ctx.contextFigure`, set `ctx.contextAsking`, and call `askContext` without `await`.
7. Clear `ctx.contextAsking` on the answer, and stop if the handle is another one or `ctx.disposed` is true.
8. Keep a defined answer only if `ctx.contextFigure` still equals the held figure, then call `sayMeta`.
9. If `ctx.contextOwed` is true, clear it and call `followContext(true)` again.
10. Call `followContext(true)` in the `compact_boundary` branch if a turn runs.
11. Call `followContext(false)` in the main-chain `assistant` branch if a turn runs.
12. Leave the ask at the turn's end as it is.

## Validation

- A case: a `compact_boundary` in a running turn asks once more and sends `session/metaChanged` with the new `ahpd.context`.
- A case: a model reply 30 s after the last ask asks again.
- A case: a second reply within those 30 s asks nothing. Use `vi.setSystemTime` for the clock.
- A case: a short turn asks twice, once at the handshake and once at its end. The existing case holds this.
- A case: a mid-turn ask with no answer does not hold the turn's end.
- A case: the figure stays the last one after that ask.
- A case: a compaction during a running mid-turn ask asks once more after that ask settles.
- A case: a subagent's `assistant` frame asks nothing.
- Run the new cases with `npx vitest run packages/agent-claude/test/agent-claude-context.test.ts`.
- The reviewer runs the whole agent-claude suite, as HANDOFF *Tests* says.
- Run `pnpm exec tsc -p tsconfig.json --noEmit` in `packages/agent-claude`.

## Resume
