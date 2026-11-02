---
title: An answer is held to its request
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L1966-L2040](../../../../packages/sdk/src/host/chatactions.ts#L1966-L2040) - the draft answer and the completion"
---

## Objective

A `chat/inputCompleted` that accepts while a required question has no answer is refused.
A draft answer whose state needs a value, and carries none of the kind it names, is refused.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:1966-2040` - both checks, against the request the chat's held state has open.
- `UPDATE: packages/sdk/test/host-input.test.ts` - a completion missing a required answer, and a draft with no value.

## Steps

1. Read the open request's questions from the chat's held state.
2. Refuse an accepted completion that leaves a required question with no submitted answer.
3. Refuse a draft answer whose state needs a value that it does not carry.
4. Add a case for each refusal, with a control that passes.

## Validation

- `packages/sdk/test/host-input.test.ts`: both refusals fail on `89ebe4d5` and pass after.
- The sdk test files pass.
- `pnpm run typecheck` is clean.

## Resume
