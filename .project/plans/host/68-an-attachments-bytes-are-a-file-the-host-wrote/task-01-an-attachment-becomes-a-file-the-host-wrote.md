---
title: An embedded or client-only attachment becomes a file the host wrote
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L278-L291](../../../../packages/sdk/src/host/chatactions.ts#L278-L291) - `chat/turnStarted`"
  - "[code://packages/sdk/src/host/chatactions.ts#L828-L850](../../../../packages/sdk/src/host/chatactions.ts#L828-L850) - `chat/pendingMessageSet`"
  - "[code://packages/sdk/src/host/tooling.ts#L349-L355](../../../../packages/sdk/src/host/tooling.ts#L349-L355) - `resourceRead` to a client"
  - "[code://packages/sdk/src/sessions.ts#L178](../../../../packages/sdk/src/sessions.ts#L178) - the session store's files"
---

## Objective

Before a `chat/turnStarted` or `chat/pendingMessageSet` is applied, every `embeddedResource` in its message, and every `file://` resource the host has no file for, is a read-only file under `<sessions dir>/attachments/<session id>/`, and the attachment is rewritten to a `resource` on it with the snapshot tag.

## Files

- `CREATE: packages/sdk/src/host/attachments.ts` - `snapshot`.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - both actions go through `snapshot` before they are applied.
- `UPDATE: packages/sdk/src/sessions.ts` - deleting a session removes its attachments folder.
- `CREATE: packages/sdk/test/host-attachments.test.ts`.

## Steps

1. The folder is created `0700`, files `0400`; the name is a unique prefix plus the label's basename with the extension from `contentType`, never a path from the client.
2. `embeddedResource`: decode and write.
3. `resource` on `file://` that does not exist here: `resourceRead` from the sending connection, unless `sizeHint` is above 32 MiB; write it.
4. A `resource` under the attachments folder already but untagged is tagged, not rewritten; a directory or a file that exists here is left as sent.
5. The tag is `_meta["vscode.agentHost.snapshotAttachment"] = { isSnapshot: true, contentType }`, merged into the attachment's own `_meta`.
6. Any failure leaves that one attachment as sent and logs it.

## Validation

- A pasted PNG and pasted text become tagged `file://` resources in state, in the session file and in `begin`'s arguments.
- A label of `../../x` writes inside the folder.
- A deleted session leaves no folder.

## Resume
