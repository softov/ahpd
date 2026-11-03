---
title: A replaced command's end reads the mark
status: todo
depends: []
layer: host
refs:
  - "[code://packages/agent-acp/src/session/queue.ts](../../../../packages/agent-acp/src/session/queue.ts) - ACP's `runCommand`"
  - "[code://packages/agent-cofold/src/turns.ts](../../../../packages/agent-cofold/src/turns.ts) - cofold's `runCommand`"
  - "[code://packages/agent-claude/src/session/turns.ts](../../../../packages/agent-claude/src/session/turns.ts) - Claude's `runCommand`"
---

## Objective

A command turn a handed turn replaced is kept out of the history, in ACP and cofold.
ACP keeps its failure off the chat.
Claude begins the handed turn once the command is over.

## Files

- `UPDATE: packages/agent-acp/src/session/queue.ts` - the command's end reads `replaced`.
- `UPDATE: packages/agent-cofold/src/turns.ts` - the command's end reads `replaced`.
- `UPDATE: packages/agent-claude/src/session/turns.ts` - the command's end starts the handed turn.
- `UPDATE: packages/agent-acp/test/agent-acp-turn.test.ts`, `packages/agent-cofold/test/agent-cofold-turn.test.ts`, `packages/agent-claude/test/agent-claude-late-steer.test.ts` - a case each.

## Steps

1. Read and clear the replaced mark at ACP's command end, as `finish` does.
2. Keep a replaced command's failure off ACP's chat.
3. Read and clear the replaced mark at cofold's command end.
4. Start the handed turn at Claude's command end when a handed turn took its place.
5. Add a case in each backend that hands a turn while a command runs.

## Validation

- The new cases fail on `3945964a`'s sources and pass after.
- The three test files pass, one file at a time.
- `pnpm run typecheck` and `pnpm run boundary` are clean.
