---
title: A stopped call stays stopped - implemented
date: 2026-10-27
refs:
  - git://2aa310ba
  - "[code://packages/agent-claude/src/session/stream.ts#L508-L656](../../../../packages/agent-claude/src/session/stream.ts#L508-L656)"
  - "[code://packages/agent-claude/test/agent-claude-cancelled-turn.test.ts](../../../../packages/agent-claude/test/agent-claude-cancelled-turn.test.ts)"
---

A result that the CLI writes for a call after its turn was stopped no longer changes the turn.
The call stays cancelled in the record that a later client reads, as it stays in every client that watched.
The session sends no action for the result, and it does not say `Thinking` again after the stop.
An edit that such a call made is recorded under the turn of the edit.

## What was built

- [`code://packages/agent-claude/src/session/stream.ts#L560-L566`](../../../../packages/agent-claude/src/session/stream.ts#L560-L566) - a result for a call that the active turn does not hold releases the call and changes nothing else.
- [`code://packages/agent-claude/src/session/stream.ts#L487-L506`](../../../../packages/agent-claude/src/session/stream.ts#L487-L506) - `edited`, the after side of an edit against the turn of its before side, and `settleSpawn`, the end of a worker record.
- [`code://packages/agent-claude/src/session/stream.ts#L72`](../../../../packages/agent-claude/src/session/stream.ts#L72) - `editing` keeps the turn of each before side.
- [`code://packages/agent-claude/test/agent-claude-cancelled-turn.test.ts#L146-L199`](../../../../packages/agent-claude/test/agent-claude-cancelled-turn.test.ts#L146-L199) - a stopped call without a late result and with one, and a stopped edit.
- [`code://docs/sdk/CHATS.md#L44`](../../../../docs/sdk/CHATS.md#L44) - "Turns" says that an ended turn takes no more results.

## Verified

- `agent-claude-cancelled-turn.test.ts`, 5 of 5; the two cases with a late result fail on the session before this change.
- Before this change, the after side of a stopped edit named the turn `''`, and the session said `Thinking` after the stop.
- `pnpm boundary`, `pnpm typecheck` and `pnpm build` pass.
- The agent-claude, conformance and wire suites pass, 44 files and 411 tests.

## Departures from the plan

- none.

## Left for later

- none.
