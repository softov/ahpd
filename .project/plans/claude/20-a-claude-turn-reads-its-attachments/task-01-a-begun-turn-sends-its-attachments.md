---
title: A begun turn sends its attachments to the CLI
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/turns.ts#L88](../../../../packages/agent-claude/src/session/turns.ts#L88) - `beginTurn`"
  - "[code://packages/agent-claude/src/session/turns.ts#L190-L196](../../../../packages/agent-claude/src/session/turns.ts#L190-L196) - the push"
  - "[code://packages/agent-claude/src/session/turns.ts#L373](../../../../packages/agent-claude/src/session/turns.ts#L373) - `begin`"
  - "[code://packages/sdk/src/types/session.ts#L374-L380](../../../../packages/sdk/src/types/session.ts#L374-L380) - `begin` and its attachments; `partsOf` comes from host 68 task 03"
---

## Objective

`begin` passes the message's attachments to `beginTurn`, the active turn's `message` keeps them, and the prompt pushed to the CLI is a content array built by `blocksFor` whenever there are any.

## Files

- `CREATE: packages/agent-claude/src/session/attachments.ts` - `blocksFor(text, attachments)` over `partsOf`.
- `UPDATE: packages/agent-claude/src/session/turns.ts:88` - `beginTurn` takes `attachments`.
- `UPDATE: packages/agent-claude/src/session/turns.ts:155-170` - `message.attachments` on the active turn when present.
- `UPDATE: packages/agent-claude/src/session/turns.ts:190-196` - push `blocksFor(sent, attachments)`.
- `UPDATE: packages/agent-claude/src/session/turns.ts:373` - `begin` passes its fifth argument.
- `CREATE: packages/agent-claude/test/attachments.test.ts` - the mapping.

## Steps

1. No attachments: push the string, unchanged.
2. Otherwise `partsOf(text, attachments, { images: true })`: a text part is a text block, an image part a base64 image block.
3. The side-chat `carried` prefix stays in the first text block.

## Validation

- `test/attachments.test.ts`: a text part, an image part, and the empty case equal to today's string.
- A host test sends a turn with an image and reads the fake CLI's received content.

## Resume
