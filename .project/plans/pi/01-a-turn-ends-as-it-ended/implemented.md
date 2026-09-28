---
title: A pi turn can be truncated, one that failed at the provider says so, and the configured model is used - implemented
date: 2026-09-28
refs:
  - git://e1c5e73
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - `ends`, `endPoint`, `answered`, the configured model and the handshake"
  - "[code://packages/agent-pi/src/backend.ts](../../../../packages/agent-pi/src/backend.ts) - `PiBackend.leaf()`"
---

A client can truncate a pi chat after a turn, a turn whose model call failed at the provider ends as an error with the provider's message, and a new session runs on the `model` the configuration names.

## What was built

- [`code://packages/agent-pi/src/backend.ts`](../../../../packages/agent-pi/src/backend.ts) - `leaf()`, from `sessionManager.getLeafId()`.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - `ends` by turn id, filled on `agent_settled` and answered by `endPoint`; a refused rewind fails its own turn, closes what it built, and the next turn retries the truncation; `answered`, the last assistant message, turns `stopReason: 'error'` into `finish('error', errorMessage)` and leaves a cancel `cancelled`; `options.model` is chosen for a session that neither resumes nor forks, and a turn's own model still wins; the first `build` calls `start.onHandshake` so the host learns pi's models.
- [`code://packages/agent-pi/README.md`](../../../../packages/agent-pi/README.md) - a `model` row in the options table.

## Verified

- `packages/agent-pi/test/agent-pi.test.ts` covers the end point, a refused rewind, a provider error, a retry that answered, a cancelled turn, and the configured model on a new, a resumed and a per-turn session.
- `packages/agent-pi/test/agent-pi-truncate.test.ts` drives `chat/truncated` through the host and sees the restarted session rewind to the recorded leaf.
- `vitest run packages/agent-pi` 92 tests; `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-27 (tasks 01 to 04) and 2026-09-28 (task 05).

## Departures from the plan

- Task 04 (a refused rewind fails only its turn) and task 05 (the handshake) were added in review.

## Left for later

- none.
