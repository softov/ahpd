---
title: A replaced command turn is in no history - implemented
date: 2026-11-03
refs:
  - git://6eed0b2a - the change
  - "[code://packages/agent-acp/src/session/queue.ts](../../../../packages/agent-acp/src/session/queue.ts)"
  - "[code://packages/agent-cofold/src/turns.ts](../../../../packages/agent-cofold/src/turns.ts)"
  - "[code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts)"
---

A `!` command turn that a turn sent after it took the place of ends in no history.
ACP keeps a replaced command's failure off the chat.
Claude begins the turn that took a command's place once the command is over.

## What was built

- [`code://packages/agent-acp/src/session/queue.ts`](../../../../packages/agent-acp/src/session/queue.ts) - the command's end reads and clears `replaced`.
- [`code://packages/agent-cofold/src/turns.ts`](../../../../packages/agent-cofold/src/turns.ts) - the command's end reads and clears `replaced`.
- [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts) - the command's end begins the handed turn that took its place.
- A case in each backend's test file that hands a turn while a command runs.

## Verified

- On `3945964a`'s sources the three cases fail.
- ACP and cofold hold `t1` and `t2` in the history, and Claude never sends the handed turn to its CLI.
- With the change, `agent-acp-turn` passes 42 of 42, `agent-cofold-turn` 46 of 46 and `agent-claude-late-steer` 20 of 20, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` report no errors, and the prose lint is clean.

## Departures from the plan

None.
