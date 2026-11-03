---
title: Only a success starts the queue
status: done
depends: [task-01-a-stop-holds-the-queue.md]
layer: "sdk, agent-claude, agent-pi, agent-acp, agent-cofold, bot, examples"
refs:
  - "[code://packages/sdk/src/sessions/catalog.ts](../../../../packages/sdk/src/sessions/catalog.ts) - the rules every backend shares"
  - "[code://packages/agent-acp/src/session/turn.ts#L153-L156](../../../../packages/agent-acp/src/session/turn.ts#L153-L156) - ACP's turn end"
  - "[code://packages/agent-cofold/src/runs.ts#L151-L154](../../../../packages/agent-cofold/src/runs.ts#L151-L154) - cofold's turn end"
---

## Objective

A failed turn starts nothing behind it in any backend, and a `!` command's turn starts the queue however it ended.
A client's removal or reorder while the chat is idle starts the head.
No backend that writes a resumable failure starts its queue while its latest turn is one.

## Files

- `UPDATE: packages/sdk/src/sessions/catalog.ts` - `holdsTheQueue`, whether a turn is a failure a client can resume.
- `UPDATE: packages/sdk/src/index.ts` - export it.
- `UPDATE: packages/agent-claude/src/session/query.ts` - a result starts the queue only for a turn that completed, or a start a client asked for.
- `UPDATE: packages/agent-claude/src/session/turns.ts` - no start after a refused turn or a failed resume; `unqueue`, `reorder` and a queued command start the head; `startNext` holds.
- `UPDATE: packages/agent-claude/src/session/logins.ts` - a turn that could not move to another login starts nothing.
- `UPDATE: packages/agent-pi/src/session.ts` - `finish` starts the queue only after a success, and a failed command's turn starts it; `unqueue` and `reorder` start the head; `startNext` holds.
- `UPDATE: packages/agent-acp/src/session/turn.ts` - a turn's end starts the queue only after a success.
- `UPDATE: packages/agent-acp/src/session/queue.ts` - `unqueue`, `reorder` and a queued command start the head.
- `UPDATE: packages/agent-cofold/src/runs.ts` - a turn's end starts the queue only after a success.
- `UPDATE: packages/agent-cofold/src/turns.ts` - `unqueue`, `reorder` and a queued command start the head; `startNext` holds.
- `UPDATE: packages/bot/src/chat.ts` - `finish` starts the queue only after a completed turn; `unqueue` and `reorder` start the head.
- `UPDATE: examples/echo/agent.ts` - `unqueue` and `reorder` start the head.
- `UPDATE: examples/notes/agent.ts` - the same.
- `UPDATE: docs/sdk/AHP.md` - the `chat/pendingMessageSet`, `chat/pendingMessageRemoved` and `chat/queuedMessagesReordered` rows.
- `UPDATE: docs/sdk/CHATS.md` - when a queued message runs.
- `UPDATE: packages/agent-claude/test/agent-claude-failed-turn.test.ts` - a failed turn holds the queue, and a resumable one holds a message queued after it.
- `UPDATE: packages/agent-claude/test/agent-claude-late-steer.test.ts` - a removal and a reorder after a stop start the head.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the same three for pi.
- `UPDATE: packages/agent-acp/test/agent-acp-turn.test.ts` - a failed turn holds the queue, and a reorder after a stop starts the head.
- `UPDATE: packages/agent-cofold/test/agent-cofold-turn.test.ts` - a resumable failure holds the queue, a removal after a stop starts the head, and a failed resume holds a queued message.
- `UPDATE: packages/bot/test/bot-chat.test.ts` - a failed turn holds the queue, and a reorder after a stop starts the head.
- `UPDATE: packages/sdk/test/echo-origin.test.ts` - a removal after a stop starts the echo example's head.

## Steps

1. Add `holdsTheQueue` to the SDK's shared rules, and export it.
2. Start each backend's queue at a turn's end only after a success or a `!` command.
3. Remove the starts that follow a refused, failed or unresumed turn.
4. Start the head from each backend's `unqueue` and `reorder`.
5. Hold `startNext` in each backend that writes a resumable failure.
6. Add a case per backend for a failed turn, and for a removal or reorder after a stop.
7. Write when a queued message runs in `AHP.md` and `CHATS.md`.

## Validation

- The new cases fail on `cde4dd6c` and pass after.
- The touched test files pass, one at a time.
- `pnpm run typecheck` and `pnpm run boundary` are clean.

## Resume

Built 2026-11-03 in `edde348e`.

- The hold sits in Claude, pi and cofold only, because ACP, the bot and the examples write no resumable failure.
- A queued `!command` set while nothing runs starts the head in Claude, ACP and cofold, as `queue` does; pi's `ran` already queued every such command.
- pi ends a `!command` that throws as an error, and starts the queue after it, as the reference host drains after every local command.
- cofold's case for a message queued during a failed resume asserted the queue moving on after the failure.
- It now holds the message until a resume completes, which starts it.
- No case here makes a cofold failure that cannot be resumed, since this harness's failures can be; its turn end is read in `runs.ts`.
