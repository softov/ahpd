---
title: A reopened session keeps its history and shows the same notice
status: done
depends: [task-04-a-live-compaction-reads-as-a-notice.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/transcript.ts#L198-L242](../../../../packages/agent-cofold/src/transcript.ts#L198-L242) - the loop over runs and their events, where the `context.compacted` numbers are read"
  - "[code://packages/agent-cofold/src/transcript.ts#L286-L311](../../../../packages/agent-cofold/src/transcript.ts#L286-L311) - the loop over messages, where a `summary` is a notification holding its whole text"
  - npm://@cofold/agents@0.1.2 - `Message.summarizes` and `context.compacted { messageId, estimatedTokens, afterTokens }`; the originals stay on disk
---

## Objective

`turnsOf` keeps every message, covered or not, and a summary message becomes one `systemNotification` at the place it was written, whose content is `compactionNotice` with the numbers its `context.compacted` event recorded, the same sentence the live turn showed, per decision [a-compacted-session-keeps-its-history-and-shows-a-notice](../../../decisions/a-compacted-session-keeps-its-history-and-shows-a-notice.md).
The summary text, written for the model, is not shown, and a summary is never an assistant message.

## Files

- `UPDATE: packages/agent-cofold/src/transcript.ts:198-242` - the compaction numbers gathered by summary message id.
- `UPDATE: packages/agent-cofold/src/transcript.ts:286-311` - a `summary` message's notice.
- `UPDATE: packages/agent-cofold/test/agent-cofold-store.test.ts` - the cases below.

## Steps

1. Write the cases first and see them fail.
2. Where the run events are already read, keep each `context.compacted` event's `estimatedTokens` and `afterTokens` in a map keyed by its `messageId`.
3. In the harness-message branch, a message with `source: 'summary'` pushes `{ kind: 'systemNotification', content: compactionNotice(numbers) }`, with the numbers from that map when it has them and none otherwise; a cancel marker (`source: 'system'`) keeps its own text as today.
4. Nothing is skipped: `summarizes` is not read, and every message keeps its turn.

## Validation

- In `agent-cofold-store.test.ts`, over a memory store written directly, written first:
  - messages `u1`, `a1`, `u2`, then a summary `s1` with `summarizes: ['u1', 'a1']` and a run event `context.compacted { messageId: 's1', estimatedTokens: 9000, afterTokens: 2000 }`, then `a2`: the transcript has turns for `u1` and `u2`, and `u2`'s turn holds one `systemNotification` `Context compacted automatically: 9000 tokens to 2000.` before `a2`'s text. Fails today because the notification holds the summary text.
  - the same with no `context.compacted` event: the notice is `Context compacted automatically.`
  - no part anywhere holds the summary text.
  - a session with no summary reads exactly as today.
- After task 04's live case, reopening that session gives the same notice text the live turn sent.
- `pnpm exec tsc --noEmit`, `pnpm test packages/agent-cofold`.

## Resume
