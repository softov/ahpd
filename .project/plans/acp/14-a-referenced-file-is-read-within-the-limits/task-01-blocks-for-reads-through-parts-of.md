---
title: blocksFor reads attachments through partsOf
status: todo
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session/turn.ts#L254-L322](../../../../packages/agent-acp/src/session/turn.ts#L254-L322) - `contentOf` and `blocksFor`"
---

## Objective

`blocksFor` maps `partsOf`'s parts to ACP blocks and no longer reads a referenced file through the store.

## Files

- `UPDATE: packages/agent-acp/src/session/turn.ts:254-322`.
- `UPDATE: packages/agent-acp/test/` - the attachment cases.

## Steps

1. `partsOf(text, attachments, { images: ctx.takes?.image === true })`.
2. An image part is an image block with `attachmentUri(label)`; a text part is a text block.
3. With `embeddedContext`, an inlined text part from a file is sent as a `resource` with `text` instead, as today.
4. Remove `contentOf` if nothing else uses it.

## Validation

- The cases in the plan's checklist, and acp 10's existing tests unchanged.

## Resume
