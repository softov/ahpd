---
title: A turn ends as the agent ended it - implemented
date: 2026-10-02
refs:
  - "[code://packages/agent-acp/src/session.ts](../../../../packages/agent-acp/src/session.ts)"
---

A cancelled turn answers every permission it was waiting on, and a turn the server stopped for `max_tokens`, `max_turn_requests` or `refusal` ends as an error named by that reason rather than as an answer.

## What was built

- [`code://packages/agent-acp/src/session.ts`](../../../../packages/agent-acp/src/session.ts) - `settlePermissions` before the cancel is sent; `stopReasonFor` maps each stop reason; a reason this bridge does not know completes.
- `packages/agent-acp/README.md`.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm test` 161 files and 2384 tests, `pnpm boundary` clean.
- A cancel answers the pending permission `cancelled` and removes its entry before `session/cancel`; each of the three reasons is a `chat/error` with the reason as `errorType`; `end_turn` completes.

## Departures from the plan

- none.

## Left for later

- none.
