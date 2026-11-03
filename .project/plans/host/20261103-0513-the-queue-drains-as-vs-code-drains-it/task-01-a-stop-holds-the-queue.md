---
title: A stop holds the queue
status: done
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L1030-L1165](../../../../packages/agent-claude/src/session/query.ts#L1030-L1165) - a stopped turn's result starts only what a message queued since asked for"
  - "[code://packages/agent-pi/src/session.ts#L680-L740](../../../../packages/agent-pi/src/session.ts#L680-L740) - pi's `finish`"
  - "[code://packages/bot/src/chat.ts#L1098-L1104](../../../../packages/bot/src/chat.ts#L1098-L1104) - a bot's stop"
  - git://ff7f255e - the change, which upstream merged
---

## Objective

A stopped turn starts nothing behind it, in Claude, pi and the bot, as in ACP, cofold and the examples.
The queue stays, and a message queued after the stop starts its head once the stopped turn has let go.

## Files

- `UPDATE: packages/agent-claude/src/session/context.ts` - `deferred`, a start a queued message asked for while the CLI owed an answer.
- `UPDATE: packages/agent-claude/src/session/turns.ts` - `startNext` marks a start the owed answer holds back.
- `UPDATE: packages/agent-claude/src/session/query.ts` - a stopped turn's result makes only a held-back start.
- `UPDATE: packages/agent-pi/src/session.ts` - `finish` starts the queue after a stop only for a message queued since.
- `UPDATE: packages/bot/src/chat.ts` - a stop ends the turn and starts nothing.

## Steps

1. Read the stop's half in upstream main, which carries it.
2. Check the three cases it brought pass there.
3. Leave the code as it stands and build task 02 on it.

## Validation

- `packages/agent-claude/test/agent-claude-late-steer.test.ts`, `agent-pi.test.ts` and `bot-chat.test.ts` pass.
- Each file's stopped-turn case holds the queue.

## Resume

Nothing to build: upstream merged this change as part of `#195`.

- It was built for an earlier round as `ff7f255e`, on a branch upstream had already merged.
- Carried onto `a8eff676` as `631c1419`, which removed and added the same 143 lines.
- Upstream then merged round 2's union, so main holds it and the carry is dropped.
- Task 02 is the correction that rests on it.
