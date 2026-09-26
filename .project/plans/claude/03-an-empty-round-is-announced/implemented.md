---
title: A model round that ends empty is announced - implemented
date: 2026-09-26
refs:
  - git://29136c9
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - `rounds` per `parent_tool_use_id`, and `streamed(event, parent)`"
  - "[code://test/agent-claude-round-ended.test.ts](../../../../test/agent-claude-round-ended.test.ts) - the four cases"
---

A Claude model round that runs from `message_start` to `message_stop` with no text and no tool call now ends with a `responseRoundEnded` part, so a client settles the open reasoning section instead of drawing two rounds of thinking as one.

## What was built

- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - round state kept per `parent_tool_use_id`; only a main-turn round (`parent === ''`) is announced.
- [`code://test/fixtures/claude-empty-round.jsonl`](../../../../test/fixtures/claude-empty-round.jsonl) and [`code://test/fixtures/claude-answered-round.jsonl`](../../../../test/fixtures/claude-answered-round.jsonl) - a captured empty round and a captured answered one.

## Verified

- `test/agent-claude-round-ended.test.ts`: an empty round is announced once, an answered round is not, a subagent's empty round is not announced in the main turn, and a main round with a subagent round streamed inside it stays apart. The subagent cases were mutation-checked.
- `pnpm test` 87 files / 1141 tests, `pnpm typecheck`, `pnpm boundary` green on 2026-09-26.

## Departures from the plan

- The review added per-parent round state, so a subagent's frames never end or announce the main round.

## Left for later

- A subagent's own empty round is announced on its chat in `claude/04` task 03.
- The captured empty round has no thinking text, because the CLI hid it; the fixture proves the round boundary, not the thinking content.
