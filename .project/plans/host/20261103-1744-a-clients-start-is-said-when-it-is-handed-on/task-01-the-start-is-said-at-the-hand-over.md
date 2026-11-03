---
title: The start is said at the hand-over
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - the echo, `later` and `sayUnanswered`"
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts) - `beginOrRun`"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - the start, the queued message and the stop"
---

## Objective

The host says a client's start and queued message when it hands them on, and a backend's own start of a held turn is dropped.
A stop matches at once; a backend that has not begun the turn is told and begins nothing of it.
`owed`, `owe`, `startOwed` and `ahead` go, with every comment and row that names them.

## Files

- `UPDATE: packages/sdk/src/host.ts` - `answering` through `applying` alone, `later`, `sayUnanswered`, a turn starts once, and what goes.
- `UPDATE: packages/sdk/src/host/context.ts`, `packages/sdk/src/host/state.ts` - the declarations.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - `beginOrRun` hands on as the dispatch, and says it where nothing did.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - the start and the queued message wait on the host's own checks; the stop matches at once.
- `UPDATE: packages/sdk/src/types/session.ts` - `begin` says when the start is said.
- `UPDATE: packages/agent-claude/src/session/turns.ts` - the start before the tools and the model; a stop while it prepares.
- `UPDATE: packages/agent-cofold/src/context.ts`, `packages/agent-cofold/src/session.ts`, `packages/agent-cofold/src/turns.ts` - a stop during the lookup.
- `UPDATE: docs/sdk/AHP.md` - the stop's row and the client tool's completion.
- `UPDATE:` the echo-origin cases, a Claude failed-turn case and Claude's model-refusal cases.

## Steps

1. Take `owed`, `owe`, `startOwed` and `ahead` out of the host.
2. Hand a turn on in `beginOrRun` as the client's dispatch, after the host's own checks.
3. Say the dispatch as sent where the backend neither said nor took it, filling a missing start time and origin.
4. Drop a backend's own start of a turn the chat holds.
5. Match a stop at once, and tell a backend that has not begun the turn.
6. Carry a stop of a turn a nested chat does not hold to the host inside.
7. Say Claude's start before its tools land and its model switches, and drop a turn stopped meanwhile.
8. Keep a turn stopped during cofold's lookup from beginning.
9. Rewrite the cases that held the start, and add cases for each change.

## Validation

- The new and changed cases fail on `3945964a`'s sources and pass after.
- The test files that hold them pass, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` are clean.
