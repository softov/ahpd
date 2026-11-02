---
title: A client's tool call result is answered by its completion
status: done
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - `chat/toolCallComplete` from the client that runs the call"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - `owed` and `owedUnder`"
  - "[code://packages/sdk/test/host-tools.test.ts](../../../../packages/sdk/test/host-tools.test.ts) - a client's tool, called and answered"
---

## Objective

A client's `chat/toolCallComplete` for a call it runs is answered by the completion the session reports for that call, which carries the client's origin; a result the session will not take stays a refusal.

## Files

- `UPDATE: packages/sdk/src/host.ts` - the completion of a tool call is owed under the call it names, and a turn's end lets go of its calls' completions.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - a result handed to the backend is owed its completion.
- `UPDATE: packages/sdk/test/host-tools.test.ts` - the client's result is answered once, by the completion, with its origin.
- `UPDATE: docs/sdk/AHP.md` - the `chat/toolCallComplete` rows.

## Steps

1. Write the case and see it fail on `08b1d57a`: the completion goes out with no origin.
2. Owe the completion.

## Validation

- The case fails on `08b1d57a` and passes after.
- The cases for a refused result still pass.
