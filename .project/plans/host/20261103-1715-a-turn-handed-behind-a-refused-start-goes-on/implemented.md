---
title: A turn handed behind a refused start goes on - implemented
date: 2026-11-03
refs:
  - git://cfed7829 - the change
  - "[code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts)"
---

A Claude turn whose start is refused fails, and the turns handed behind it go on, while the queue waits.
A turn handed while the turn ahead switched its model is said once that turn is over.
A refused turn a later one replaced is in no history, and its reason is not the chat's failure.

## What was built

- [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts) - one `refuse` for the three refusals of a start, which starts the next handed turn.
- `sayHanded` holds a handed turn only while the turn ahead still begins.
- `startNext` says any handed turn not yet said before it begins the first.
- `refuseTurn` keeps a replaced turn out of the history and its reason off the chat.
- [`code://packages/agent-claude/test/agent-claude-failed-turn.test.ts`](../../../../packages/agent-claude/test/agent-claude-failed-turn.test.ts) - a model the fake CLI refuses, and two cases.

## Verified

- On `3945964a`'s sources both new cases fail.
- There the CLI is never sent the turn behind the refused one, and the turn handed during the switch is never said.
- With the change, `agent-claude-failed-turn` passes 13 of 13.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

None.
