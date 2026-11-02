---
title: A tool call ends as VS Code draws it - implemented
date: 2026-11-02
refs:
  - git://cd69e184 - the last change
  - "[code://packages/bot/src/chat.ts](../../../../packages/bot/src/chat.ts)"
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts)"
  - "[code://packages/agent-cofold/src/pauses.ts](../../../../packages/agent-cofold/src/pauses.ts)"
---

A call its turn left unfinished ends cancelled and `skipped`, as the reducer ends it, and nothing is said of it in anybody's name.
A refusal is said as `denied`.

## What was built

- [`code://packages/bot/src/chat.ts`](../../../../packages/bot/src/chat.ts) - `finish` completes the calls only when the back session answered.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - `releasePending` says no confirmation.
- [`code://packages/agent-cofold/src/pauses.ts`](../../../../packages/agent-cofold/src/pauses.ts) - a refusal's reason is `denied`.

## Verified

- Each new or changed case fails on `89ebe4d5`'s sources and passes with the change, as each task's *Resume* names.
- The bot, agent-pi and agent-cofold test files pass, each timeout under load passing alone.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.

## Left for later

- Open, left as it is: Q21, the past tense ACP makes from a call's title.
- VS Code's chat draws a call's `pastTenseMessage`, and VS Code runs no ACP agent whose words to compare.
- Left as they are: CS10, CS16, CS17, CS19, F15, F10, Q13, Q22, X8, B1 and CS2.
- VS Code's host was not read for them in this plan.
