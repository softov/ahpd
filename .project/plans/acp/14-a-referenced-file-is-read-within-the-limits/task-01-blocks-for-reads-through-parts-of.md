---
title: blocksFor reads attachments through partsOf
status: done
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session/turn.ts#L241-L270](../../../../packages/agent-acp/src/session/turn.ts#L241-L270) - `blocksFor`"
  - "[code://packages/sdk/src/attachments.ts#L65-L83](../../../../packages/sdk/src/attachments.ts#L65-L83) - `PartSource` and `Part`, the label, URI and file text a part carries"
---

## Objective

`blocksFor` maps `partsOf`'s parts to ACP blocks and no longer reads a referenced file through the store.

## Files

- `UPDATE: packages/sdk/src/attachments.ts` - `Part` carries the attachment it came from.
- `UPDATE: packages/sdk/src/index.ts` - `PartSource` exported beside `Part`.
- `UPDATE: packages/sdk/test/attachments.test.ts` - the shape of each part, and that it names its attachment.
- `UPDATE: packages/agent-acp/src/session/turn.ts` - `contentOf` goes, and `blocksFor` maps the parts instead.
- `UPDATE: packages/agent-acp/test/fixtures/acp-server.mjs` - the `blocks` script says a resource block's own text.
- `UPDATE: packages/agent-acp/test/agent-acp-blocks.test.ts` - the attachment cases.

## Steps

1. `partsOf(text, attachments, { images: ctx.takes?.image === true })`.
2. An image part is an image block with `attachmentUri(label)`; a text part is a text block.
3. With `embeddedContext`, send a `resource` for a text part that carries a file's own text. The block holds that text, under the URI of the file it came from.
4. Remove `contentOf` if nothing else uses it.

## Validation

- The cases in the plan's checklist, and acp 10's existing tests unchanged.

## Resume
