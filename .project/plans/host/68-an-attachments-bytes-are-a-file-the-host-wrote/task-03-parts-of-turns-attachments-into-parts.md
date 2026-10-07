---
title: partsOf turns attachments into text and image parts within the limits
status: done
depends: [task-01-an-attachment-becomes-a-file-the-host-wrote.md]
layer: "sdk"
refs:
  - "[code://packages/agent-acp/src/session/turn.ts#L284-L321](../../../../packages/agent-acp/src/session/turn.ts#L284-L321) - `blocksFor`"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudePromptResolver.ts - the reference block
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/codex/codexPromptResolver.ts - textual types, fenced block
---

## Objective

`partsOf(text, attachments, { images })` in `@ahpd/sdk` returns the message text first, then image parts and text parts, so each backend only maps a `Part` to its own block.

## Files

- `CREATE: packages/sdk/src/attachments.ts` - `partsOf`, `Part`, the limits as named constants.
- `UPDATE: packages/sdk/src/index.ts` - export them.
- `CREATE: packages/sdk/test/attachments.test.ts`.

## Steps

1. No attachments: `[{ type: 'text', text }]`, so a backend can send exactly what it sends today.
2. A `file://` resource: `lstat`; not a regular file, or over the limit, is a reference.
3. An image of jpeg, png, gif or webp, at most 5 MB, with `images: true`: read and return an image part. Take the type from the tag `contentType`, else the attachment's, else the extension.
4. A host-written textual file at most 64 KiB: read and return `<label> (lines a-b):` and a fenced block.
5. Name every other attachment that names a file in the one references block, in VS Code's wording. Use `:<line>` for a selection, and the read-only note on a snapshot.
6. `simple`: its `modelRepresentation`; `annotations` and `chat`: named by label.
7. An `embeddedResource` still present (its write failed) follows the same limits on its decoded bytes.

## Validation

- `test/attachments.test.ts` covers each step, a 6 MB PNG, an SVG, a 65 KiB text, a FIFO and a directory.

## Resume
