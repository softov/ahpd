---
title: Claude shows a steer it took in
status: todo
depends: []
layer: agent-claude
refs:
  - "[code://packages/agent-claude/src/session/query.ts#L281-L287](../../../../packages/agent-claude/src/session/query.ts#L281-L287) - where a steer is handed to the CLI"
  - "[code://packages/agent-claude/src/transcript.ts#L405-L428](../../../../packages/agent-claude/src/transcript.ts#L405-L428) - the reader"
---

## Objective

A steer that Claude hands to the CLI shows as a quote in the turn it steered, live and when the transcript is read back.

## Files

- `UPDATE: packages/agent-claude/src/session/query.ts:281-287` - after the steering message leaves the queue, add the quote to the turn it steered and say it with `chat/responsePart`.
- `UPDATE: packages/agent-claude/src/transcript.ts:405-428` - an `attachment` frame of type `queued_command` inside an open turn adds the quote of its `prompt` to that turn.
- `UPDATE: packages/agent-claude/test/agent-claude-late-steer.test.ts` - a case for the live quote.
- `UPDATE: packages/agent-claude/test/` - a case for the read back, in the test file that reads transcripts.

## Steps

1. Write `quoteOf(id, text)` in agent-claude, the same shape as the bot chat's.
2. Where the steering message leaves the queue, push the quote into the turn it steered, and emit `chat/responsePart` for it.
3. In the reader, read a `queued_command` attachment frame in an open turn as a quote of its `prompt`.
4. Give that quote the id `steer:<source_uuid>`.
5. Add the live case: hand a steer to the CLI, and find the quote in the turn.
6. Add the read back case: read a transcript with a `queued_command` frame, and find the quote in its turn.

## Validation

- The two new cases fail without the change and pass with it.
- `pnpm --filter @ahpd/agent-claude test` passes, run alone.

## Resume
