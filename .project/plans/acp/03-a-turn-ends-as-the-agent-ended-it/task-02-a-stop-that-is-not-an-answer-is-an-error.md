---
title: A stop that is not an answer is an error
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L714](../../../../packages/agent-acp/src/session.ts#L714) - the stop reason"
  - "[code://packages/agent-acp/src/session.ts#L634-L650](../../../../packages/agent-acp/src/session.ts#L634-L650) - `finish`"
---

## Objective

`max_tokens`, `max_turn_requests` and `refusal` end the turn as `chat/error` with that error type and a sentence; `end_turn` completes; `cancelled` cancels.

## Files

- `UPDATE: packages/agent-acp/src/session.ts:714`.

## Steps

1. Map each stop reason; an unknown one completes, as today.

## Validation

- One fixture case per stop reason.

## Resume
