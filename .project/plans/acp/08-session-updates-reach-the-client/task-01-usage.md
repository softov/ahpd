---
title: Usage reaches the turn
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/mapping.ts#L188-L196](../../../../packages/agent-acp/src/mapping.ts#L188-L196) - dropped updates"
  - "[code://packages/agent-acp/src/transcript.ts#L60-L61](../../../../packages/agent-acp/src/transcript.ts#L60-L61) - the transcript's usage"
---

## Objective

`usage_update` becomes `chat/usage` (context size and cost in `_meta`), and the watched turn keeps it for the transcript.

## Files

- `UPDATE: packages/agent-acp/src/mapping.ts`.
- `UPDATE: packages/agent-acp/src/transcript.ts:60`.

## Steps

1. Keep the last update per turn.

## Validation

- A fixture usage update appears live and in the transcript.

## Resume
