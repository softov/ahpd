---
title: The figure is asked during a turn
status: implemented
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

Implemented 2026-11-14, uncommitted in the build worktree.

- `contextAskedAt`, `contextAsking` and `contextOwed` are three fields on the session's state, initialized in `createSession`.
- `askContext` times every ask, once the SDK build is known to have the method, so the handshake's ask starts the throttle too.
- `followContext` asks beside the stream: a compaction always, a reply only when 30 s have passed since the last ask of any kind. One ask runs at a time, and a compaction during one is owed another after it settles. The answer is kept only when no later figure came meanwhile.
- `consume` calls it on a `compact_boundary` and on a main-chain `assistant` frame while a turn runs. A subagent's `assistant` frame asks nothing.
- Seven new cases in `agent-claude-context.test.ts`; the short-turn case still reads two asks. `npx vitest run packages/agent-claude/test/agent-claude-context.test.ts` passes 14 of 14, and `pnpm exec tsc -p tsconfig.json --noEmit` in `packages/agent-claude` is clean.

What the plan did not know:

- The package's `tsconfig.json` has no `@ahpd/sdk` path mapping, so its check needs `packages/sdk/dist`. `pnpm exec tsc -p packages/sdk/tsconfig.json` was run first; `dist` is ignored by git.
- The reply cases advance the clock 30 s past the handshake's ask, because that ask starts the throttle. They fake `Date` alone with `vi.useFakeTimers({ toFake: ['Date'] })`, so `settle` and the 2 s wait keep real timers.
- A CLI build with no `getContextUsage` never records an ask time, so a reply there calls the missing method and re-says `_meta` without a request. Nothing is sent and the one-ask slot is unchanged.
