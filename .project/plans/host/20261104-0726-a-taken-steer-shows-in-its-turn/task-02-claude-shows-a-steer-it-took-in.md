---
title: Claude shows a steer it took in
status: done
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L281-L287](../../../../packages/agent-claude/src/session/query.ts#L281-L287) - where a steer is handed to the CLI"
  - "[code://packages/agent-claude/src/transcript.ts#L405-L428](../../../../packages/agent-claude/src/transcript.ts#L405-L428) - the reader"
---

## Objective

A steer that Claude hands to the CLI shows as a quote in the turn it steered, live and when the transcript is read back.

## Files

- `UPDATE: packages/agent-claude/src/session/query.ts:806-820` - when a `command_lifecycle` frame says the CLI started a steer, add the quote to the turn it steered.
- `UPDATE: packages/agent-claude/src/transcript.ts:420-433` - a message the SDK marks `isQueuedCommand` inside an open turn adds the quote of its text to that turn.
- `UPDATE: packages/sdk/src/host/localturns.ts:185-200` - `joinedTurn` quotes the message of a turn the chat never began.
- `UPDATE: packages/agent-claude/test/agent-claude-late-steer.test.ts` - the live and read back cases now hold the quote.
- `UPDATE: packages/sdk/test/host-local-turns.test.ts` - the folded turns hold the quote, and the capture of the real CLI reads back as it ran.

## Steps

1. Import `steerQuote` from `@ahpd/sdk`.
2. Add the quote to the main turn when a `command_lifecycle` frame says `started` for a steer.
3. Give it the frame's `command_uuid` as its id.
4. In the reader, read an `isQueuedCommand` message in an open turn as a quote with its `uuid`.
5. Update the late-steer cases, live and read back, to hold the quote before the answer to the steer.

## Validation

- The two new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/agent-claude test` passes, run alone.

## Resume

- **Done so far:** every step. The SDK gives the `queued_command` frame as a user message marked `isQueuedCommand`, whose `uuid` is the frame's `source_uuid`.
- **Found:** a steer the CLI ran after the turn's last answer is a turn of its own in the transcript.
  The host folds it into the turn it steered, and the fold now quotes it, so a reload matches the live turn.
