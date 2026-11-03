---
title: A stop holds the queue
status: done
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L1031-L1046](../../../../packages/agent-claude/src/session/query.ts#L1031-L1046) - a stopped turn's result starts the queue"
  - "[code://packages/agent-claude/src/session/query.ts#L1149-L1159](../../../../packages/agent-claude/src/session/query.ts#L1149-L1159) - every result starts the queue"
  - "[code://packages/agent-pi/src/session.ts#L685-L731](../../../../packages/agent-pi/src/session.ts#L685-L731) - pi's `finish`"
  - "[code://packages/bot/src/chat.ts#L1053-L1057](../../../../packages/bot/src/chat.ts#L1053-L1057) - a bot's stop"
---

## Objective

A stopped turn starts nothing behind it, in Claude, pi and the bot, as in ACP and cofold.
The queue stays, and a message queued after the stop starts its head once the stopped turn has let go.

## Files

- `UPDATE: packages/agent-claude/src/session/context.ts` - `deferred`, a start a queued message asked for while the CLI owed an answer.
- `UPDATE: packages/agent-claude/src/session/turns.ts:367-375` - `startNext` marks a start the owed answer holds back.
- `UPDATE: packages/agent-claude/src/session/query.ts:1031-1046` - a stopped turn's result makes only a held-back start.
- `UPDATE: packages/agent-claude/src/session/query.ts:1149-1159` - a stopped result starts nothing else.
- `UPDATE: packages/agent-pi/src/session.ts:685-731` - `finish` starts the queue after a stop only for a message queued since.
- `UPDATE: packages/bot/src/chat.ts:1053-1057` - a stop ends the turn and starts nothing.
- `UPDATE: packages/agent-claude/test/agent-claude-late-steer.test.ts:480-500` - a stopped turn's queue stays until a message is queued.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts:706-720` - the same for pi.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - the same for the bot.

## Steps

1. Mark a start the CLI's owed answer holds back, and make it once the answer comes.
2. Start nothing else at a stopped turn's result.
3. Start pi's queue at a stop only for a message queued while the stop was in flight.
4. End a bot's stopped turn without starting the queue.
5. Add a case per backend that stops a turn with a message queued behind it.

## Validation

- The three new cases fail on `0229216e` and pass after.
- The agent-claude, agent-pi and bot test files that queue a message pass.
- `pnpm run typecheck` is clean.

## Resume

Built 2026-11-02.

- On `0229216e`'s sources each new case fails: the queued message starts at the stop.
- The bot's `finish` comment names the stop as its one caller without `next`.
