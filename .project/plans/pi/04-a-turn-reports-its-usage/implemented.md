---
title: A pi turn reports what it used - implemented
date: 2026-09-28
refs:
  - git://e1c5e73
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - `usageOf` and the model on a turn's message"
  - "[code://packages/agent-pi/src/models.ts](../../../../packages/agent-pi/src/models.ts) - the context window and output limit on an offered model"
---

A finished pi turn says how many tokens it used and on which model, live and in the transcript, and each offered model carries its context window.

## What was built

- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - `usageOf` reads the last assistant message into `chat/usage` before the ending action, and leaves it out for an error that used no tokens; `begin` puts the turn's `model` on its message.
- [`code://packages/agent-pi/src/transcript.ts`](../../../../packages/agent-pi/src/transcript.ts) - the same usage in the transcript.
- [`code://packages/agent-pi/src/models.ts`](../../../../packages/agent-pi/src/models.ts) - `maxContextWindow` and `maxOutputTokens` when pi knows them.

## Verified

- `packages/agent-pi/test/agent-pi.test.ts` covers the mapped fields, their order against the ending action, the transcript, no usage for a turn with no answer, a `!command` or an error before any token, the model fields, and the model on `chat/turnStarted` and `chatState()`.
- `vitest run packages/agent-pi` 91 tests; `pnpm test`, `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-27 (tasks 01 and 02) and 2026-09-28 (tasks 03 and 04).

## Departures from the plan

- The model list reaches a client only through `offered`; pi/09 task 09 removed the undeclared `session/modelsChanged` announcement task 02 had used.
- Tasks 03 and 04 were added in review.

## Left for later

- none.
