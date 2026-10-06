---
title: A live compaction reads as a notice, not as the model's answer
status: done
depends: [task-03-a-long-session-compacts-itself.md]
layer: "agent-cofold"
refs:
  - "[code://packages/agent-cofold/src/mapping.ts#L314-L358](../../../../packages/agent-cofold/src/mapping.ts#L314-L358) - `model.started`, the `model.completed` fallback and the silent `context.compacted`"
  - "[code://packages/agent-cofold/src/mapping.ts#L235-L246](../../../../packages/agent-cofold/src/mapping.ts#L235-L246) - `blockOf`, how a part is opened with `chat/responsePart` and pushed onto `parts`"
  - "[code://packages/agent-claude/src/session/query.ts#L345-L358](../../../../packages/agent-claude/src/session/query.ts#L345-L358) - the sibling's notice and its wording"
  - npm://@cofold/agents@0.1.2 - `writeSummary` calls `model.complete()`, never streams, emits `model.completed` and then `context.compacted { messageId, estimatedTokens, afterTokens }`
---

## Objective

When cofold compacts during a live turn, the client sees one `systemNotification` part, `Context compacted automatically: <before> tokens to <after>.`, worded as the Claude backend words it, and never the summary text written as the model's answer, per decision [a-compacted-session-keeps-its-history-and-shows-a-notice](../../../decisions/a-compacted-session-keeps-its-history-and-shows-a-notice.md).
The sentence comes from one exported function, `compactionNotice`, which task 06 uses for the transcript.

## Files

- `UPDATE: packages/agent-cofold/src/mapping.ts:314-358` - `compactionNotice`; the fallback text waits one event; `context.compacted` sends the notice.
- `UPDATE: packages/agent-cofold/test/` - the cases below, beside task 03's.

## Steps

1. Write the cases first and see them fail: today the summary step's text arrives as `chat/delta` into a markdown part.
2. Export `compactionNotice(tokens?: { before: number; after: number }): string` from `mapping.ts`: `Context compacted automatically: <before> tokens to <after>.` with the numbers, `Context compacted automatically.` without, the Claude backend's two sentences.
3. In `model.completed`, the reasoning and text the fallback would write are held instead of written; the step's `chat/usage` still goes out at once.
4. On the next event, whatever it is, the held writes are sent first, unless that event is `context.compacted`, in which case they are dropped.
5. `context.compacted` pushes a part `{ id: <turnId>:compact:<n>, kind: 'systemNotification', content: compactionNotice({ before: estimatedTokens, after: afterTokens }) }` onto `parts` and sends it as `chat/responsePart`.
6. `run.finished` and every other event that ends the mapping flush anything still held, so a non-streaming adapter's last step is never lost.

## Validation

- Written first, failing today:
  - a live turn that auto-compacts sends exactly one `systemNotification` part whose content is `compactionNotice` of the event's two numbers, and no markdown part or `chat/delta` carries the summary text.
  - `compactionNotice({ before: 9000, after: 2000 })` is `Context compacted automatically: 9000 tokens to 2000.` and `compactionNotice()` is `Context compacted automatically.`
- The existing cases for a non-streaming fake model (`stream: false`) stay green: its text still reaches the client, in the same order relative to tool calls.
- `pnpm exec tsc --noEmit`, `pnpm test packages/agent-cofold`.

## Resume
