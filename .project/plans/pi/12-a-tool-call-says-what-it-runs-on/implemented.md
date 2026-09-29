---
title: "A tool call says what it runs on, on pi, cofold and Claude live - implemented"
date: 2026-09-28
refs:
  - git://373253e
  - "[code://packages/agent-pi/src/mapping.ts](../../../../packages/agent-pi/src/mapping.ts) - `describe`"
  - "[code://packages/agent-cofold/src/tools.ts](../../../../packages/agent-cofold/src/tools.ts) - `describe`"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - `invocationMessage` from `summarize`"
---

A tool call on pi, on cofold and in a live Claude turn is drawn with what it runs on, the command, file or pattern, while it runs, once it is done and after a reload.

## What was built

- [`code://packages/agent-pi/src/mapping.ts`](../../../../packages/agent-pi/src/mapping.ts) - `describe`, used for the ready, the ask and the finished call; `PiCall.said` keeps it.
- [`code://packages/agent-cofold/src/tools.ts`](../../../../packages/agent-cofold/src/tools.ts) - `describe`, used live and by the transcript.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - a live call's `invocationMessage` is its command.

## Verified

- `agent-pi.test.ts`, `agent-cofold-store.test.ts` and `host.test.ts`; the described cases failed first with the tool name.
- `pnpm typecheck`, `pnpm boundary` clean; full `pnpm test` 1561 of 1561.

## Departures from the plan

- pi's `said` is set at `tool_execution_start`, which carries the arguments live and in replay.
- A live Claude call now shows its command as the intention and in `toolInput`, as a replayed one already did; `fixtures/wire.jsonl` changed with it.

## Left for later

- By hand: the calls in ahpapp.
