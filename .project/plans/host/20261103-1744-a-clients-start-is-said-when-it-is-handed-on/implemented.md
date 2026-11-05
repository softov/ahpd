---
title: A client's start is said when it is handed on - implemented
date: 2026-11-03
refs:
  - git://e6c96e9b - the change
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts)"
  - "[code://packages/sdk/src/host/lifecycle.ts](../../../../packages/sdk/src/host/lifecycle.ts)"
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
---

A client's start and queued message are said with its origin when the host hands them to the backend.
A stop matches the turn it names at once, and a backend that has not begun that turn begins nothing of it.
`owed`, `owe`, `startOwed` and `ahead` are gone; `later` carries a dispatch to work it waits on.

## What was built

- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - `answering` through `applying` alone; `later`; `sayUnanswered`; a backend's own start of a held turn dropped.
- [`code://packages/sdk/src/host/lifecycle.ts`](../../../../packages/sdk/src/host/lifecycle.ts) - `beginOrRun` hands a turn on as the client's dispatch, and says it where nothing did.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the stop matches at once; a nested chat's stop of a turn it does not hold goes inside.
- [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts) - the start before the tools and the model; `stopping`; `steer` waits out a preparing turn.
- cofold's `stopping`, for a turn stopped during the lookup; `Session.begin`'s contract; AHP.md's stop row.
- The echo-origin cases that held the start rewritten, three added, and Claude's cases on the switch.

## Verified

- On `3945964a`'s sources four cases fail.
- There the start waits for the backend, the same-connection stop loses t1 to another window's t2, and a stop waits on a relayed start.
- Claude says the start only after the switch there.
- With the change, `echo-origin` passes 22 of 22, `agent-claude-failed-turn` 12 of 12 and `agent-claude-model-refusal` 3 of 3.
- So do `policy-checks` (31), `nested-proxy` (69), `agent-claude-restored-model` (6) and `agent-cofold-store` (39), one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

- The host's own echo fills a start time and an origin a client left out.
- The cases' clients send neither, and the reducer could not end a turn without them.
- Two of Claude's model-refusal cases changed with the timing: the switching turn is the chat's, and a refused one names the model it asked for.
