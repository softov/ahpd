---
title: The part is emitted
status: todo
depends: [task-01-seen-on-a-real-stream.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1052-L1060](../../../../packages/agent-claude/src/session.ts#L1052-L1060) - `streamed`"
  - "[code://packages/agent-claude/src/session.ts#L2064](../../../../packages/agent-claude/src/session.ts#L2064) - the existing `systemNotification` part"
---

## Objective

A model message that ends with no text and no tool call is followed by a `systemNotification` part whose `_meta` says `responseRoundEnded`.

## Files

- `UPDATE: packages/agent-claude/src/session.ts` - track per streamed message whether a `text` or `tool_use` block started; on `message_delta` note `stop_reason`; on `message_stop` emit the part when neither started and the reason is `end_turn`.
- `CREATE: test/agent-claude-round-ended.test.ts` - replays the task 01 fixture.

## Steps

1. In `streamed`, reset a per-message flag on `message_start`, set it on a `text` or `tool_use` `content_block_start`, and record `stop_reason` from `message_delta`.
2. On `message_stop`, when the flag is unset and the reason is `end_turn`, push `{ kind: 'systemNotification', content: '', _meta: { <the reference's key>: { kind: 'responseRoundEnded' } } }` through the same path the existing notification at L2064 uses. Take the `_meta` key from `toAgentSystemNotificationMeta` in the reference, not from memory.
3. Leave the reasoning part closed so later thinking opens a new one, as the reference does.

## Validation

- The fixture replay emits exactly one `responseRoundEnded` part, after the thinking part.
- A fixture of an ordinary turn with text emits none.
- `pnpm test`, `pnpm typecheck` green; the part validates against the protocol schema with `pnpm wire`.

## Resume

