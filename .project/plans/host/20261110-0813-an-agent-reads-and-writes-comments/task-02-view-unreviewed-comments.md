---
title: viewUnreviewedComments asks first
status: todo
depends:
  - task-01-five-comment-tools.md
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/comments.ts](../../../../packages/sdk/src/tools/comments.ts) - the comment tool group of task 01"
---

## Objective

`viewUnreviewedComments` asks the person before it shows the waiting comments, as VS Code's does.

## Files

- `UPDATE: packages/sdk/src/tools/comments.ts` - the sixth tool.
- `UPDATE: packages/sdk/test` - the cases of the tool.

## Steps

1. Copy the tool's schema, text and confirmation from VS Code at 171e90619.
2. Ask the person only when a comment waits for them.
3. Show every waiting comment, since no client lets the person pick yet.

## Validation

- No waiting comment answers with no question.
- A waiting comment asks, and an answer of no shows nothing.
- `pnpm typecheck`, then the sdk suite.

## Resume

