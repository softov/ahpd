---
title: Steering runs in the order sent
status: todo
depends: [task-01-idle-steering-runs-ahead.md]
layer: "sdk, agent-claude, agent-pi, agent-cofold, bot"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1451-L1468](../../../../packages/sdk/src/host/chatactions.ts#L1451-L1468) - the held steering message, checked for a steering set"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1398-L1414](../../../../packages/sdk/src/host/lifecycle.ts#L1398-L1414) - a command handed to `ran`"
---

## Objective

Two idle steering messages run in the order they were sent, ahead of every queued message.
A steering `!command` waits with them, said as steering, and runs as a command.
A backend's chat shows the latest steering message it was set.
A set reusing the held steering message's id while a turn runs is refused when its kind or its message differs.

## Files

- `UPDATE: packages/sdk/src/types/session.ts` - `Session.ran` takes the kind.
- `UPDATE: packages/sdk/src/host/lifecycle.ts` - `beginOrRun` hands the kind to `ran`.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - the held steering check reads the id whatever the kind.
- `UPDATE: packages/agent-claude/src/session/turns.ts` - steering goes behind steering; a steering command waits as steering.
- `UPDATE: packages/agent-claude/src/session.ts` - the chat shows the latest steering entry.
- `UPDATE: packages/agent-pi/src/session.ts` - the same for pi.
- `UPDATE: packages/agent-cofold/src/turns.ts` - the same queue for cofold.
- `UPDATE: packages/agent-cofold/src/session.ts` - the same chat state for cofold.
- `UPDATE: packages/bot/src/chat.ts` - the same for the bot.
- `UPDATE: packages/sdk/test/host-steering.test.ts` - a queued set under the held steering id is refused.
- `UPDATE: packages/agent-claude/test/agent-claude-late-steer.test.ts` - two idle steering messages, and a steering command.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - two idle steering messages.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - two idle steering messages.

## Steps

1. Insert a steering entry after the last steering entry waiting, in each backend that takes steering.
2. Show the latest steering entry as the chat's `steeringMessage`.
3. Hand `ran` the kind, and wait a steering command as steering.
4. Refuse a set under the held steering id whose kind or message differs, while a turn runs.
5. Add the cases.

## Validation

- The new cases fail on `a8eff676` and pass after.
- The touched test files pass, one at a time.
- `pnpm run typecheck` and `pnpm run boundary` are clean.

## Resume
