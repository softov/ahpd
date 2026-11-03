---
title: The comments say what answers a result
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L2123-L2138](../../../../packages/sdk/src/host/chatactions.ts#L2123-L2138) - the result's comment"
  - "[code://packages/sdk/src/host.ts#L886-L901](../../../../packages/sdk/src/host.ts#L886-L901) - `answeredBy`'s comment"
---

## Objective

Each comment says what the code does with a client's tool result.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:2123-2138` - the client's own action answers it, and the harness's later completion is dropped.
- `UPDATE: packages/sdk/src/host.ts:886-893` - what is owed is a turn begun or a message queued.

## Steps

1. Say in the result's comment that the client's own action answers it.
2. Name in `answeredBy`'s comment the dispatches a backend owes, and their key.

## Validation

- `pnpm run typecheck` is clean.
- The prose lint is clean.

## Resume

Not started.
