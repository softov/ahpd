---
title: A stop holds the queue
status: doing
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L1030-L1160](../../../../packages/agent-claude/src/session/query.ts#L1030-L1160) - a stopped turn's result starts the queue"
  - "[code://packages/agent-pi/src/session.ts#L680-L727](../../../../packages/agent-pi/src/session.ts#L680-L727) - pi's `finish`"
  - "[code://packages/bot/src/chat.ts#L1053-L1066](../../../../packages/bot/src/chat.ts#L1053-L1066) - a bot's stop"
  - git://ff7f255e - the change, built for an earlier round on a branch upstream had merged
---

## Objective

A stopped turn starts nothing behind it, in Claude, pi and the bot, as in ACP, cofold and the examples.
A message queued after the stop starts the head once the stopped turn has let go.

## Files

- `UPDATE: packages/agent-claude/src/session/context.ts` - `deferred`, a start a queued message asked for while the CLI owed an answer.
- `UPDATE: packages/agent-claude/src/session.ts` - `deferred` starts false.
- `UPDATE: packages/agent-claude/src/session/turns.ts:366-417` - `startNext` marks a start the owed answer holds back.
- `UPDATE: packages/agent-claude/src/session/query.ts:1030-1160` - a stopped turn's result makes only a held-back start.
- `UPDATE: packages/agent-pi/src/session.ts:680-727` - `finish` starts the queue after a stop only for a message queued since.
- `UPDATE: packages/bot/src/chat.ts:1053-1066` - a stop ends the turn and starts nothing.
- `UPDATE: packages/agent-claude/test/agent-claude-late-steer.test.ts` - a stopped turn's queue stays until a message is queued.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the same for pi.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - the same for the bot.

## Steps

1. Apply `ff7f255e` to upstream main.
2. Compare its patch id with the original's.
3. Run the three cases on main's sources, and with the change.

## Validation

- The three cases fail on `a8eff676` and pass after.
- The patch id of the applied commit is `ff7f255e`'s.

## Resume
