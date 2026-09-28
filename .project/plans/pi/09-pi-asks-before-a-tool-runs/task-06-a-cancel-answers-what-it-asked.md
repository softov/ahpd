---
title: A cancel answers every question it leaves, and tells the model the turn was stopped
status: implemented
depends: [task-04-the-ask-reuses-the-row-pi-opened.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L226-L232](../../../../packages/agent-pi/src/session.ts#L226-L232) - `releasePending`, which settles the waits and sends nothing"
  - "[code://packages/agent-claude/src/session.ts#L3226-L3262](../../../../packages/agent-claude/src/session.ts#L3226-L3262) - `confirm` and the release with "The turn was stopped""
---

## Objective

A turn cancelled or closed while a question waits moves each asked row to `cancelled` with `chat/toolCallConfirmed`, removes its input entry, and gives pi the reason agent-claude gives.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:226-232` - `releasePending`.
- `UPDATE: packages/agent-pi/src/session.ts:191-198` - `releaseCalls`, same reason text.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the case below.

## Steps

1. For each pending question, emit `chat/toolCallConfirmed` with `approved: false` and `session/inputNeededRemoved`, then settle it with `{ block: true, reason: 'The turn was stopped' }`.
2. A client call released by a cancel uses the same sentence.

## Validation

- `packages/agent-pi/test/agent-pi.test.ts`: a cancel with two questions waiting sends two `chat/toolCallConfirmed` and two `session/inputNeededRemoved`, the session is no longer `InputNeeded`, and each hook resolves with "The turn was stopped".
- Today the rows stay `pending-confirmation` and the reason is "The person declined this action".
- `node_modules/.bin/vitest run packages/agent-pi` green.

## Resume

Built.
`session.ts`'s `releasePending(why)` moves each waiting row to `cancelled`, emits `chat/toolCallConfirmed` with `approved: false` and `session/inputNeededRemoved`, and settles the hook with `{ block: true, reason: why }`.
`cancel` and `close` pass `The turn was stopped`, the sentence agent-claude gives, to both `releasePending` and `releaseCalls`.

- Failed first: the two-question cancel case read `The person declined this action` and left the row `pending-confirmation`; `releases a waiting client call when the turn is cancelled` expected the old cancel sentence.
- `node_modules/.bin/vitest run packages/agent-pi` green, 80 tests; `pnpm typecheck` green.
