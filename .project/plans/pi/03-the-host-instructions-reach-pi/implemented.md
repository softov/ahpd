---
title: The host's instructions reach pi's system prompt - implemented
date: 2026-09-28
refs:
  - git://e1c5e73
  - "[code://packages/agent-pi/src/backend.ts](../../../../packages/agent-pi/src/backend.ts) - `resourceLoaderOptions.appendSystemPromptOverride`"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - the blank entries dropped before the instructions are passed"
---

What the host wants the model told reaches pi's system prompt, after pi's own prompt and after a project's or user's `APPEND_SYSTEM.md`.

## What was built

- [`code://packages/agent-pi/src/backend.ts`](../../../../packages/agent-pi/src/backend.ts) - `BackendOptions.instructions` reaches `createAgentSessionServices` through `appendSystemPromptOverride`, which adds to what pi discovered; pi joins the entries itself.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - blank entries are dropped, and nothing is passed when there are none.

## Verified

- `packages/agent-pi/test/agent-pi.test.ts` covers the instructions reaching the fake's `open` with a blank entry dropped, and a session with none passing none.
- `pnpm test` 102 files, 1366 tests; `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-28.

## Departures from the plan

- none.

## Left for later

- The by-hand run of a real pi session in a directory with `.pi/APPEND_SYSTEM.md` was left to Softov.
