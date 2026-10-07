---
title: An embedded or client-only attachment becomes a file the host wrote
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L345-L356](../../../../packages/sdk/src/host/chatactions.ts#L345-L356) - `chat/turnStarted`"
  - "[code://packages/sdk/src/host/chatactions.ts#L927-L974](../../../../packages/sdk/src/host/chatactions.ts#L927-L974) - `chat/pendingMessageSet`"
  - "[code://packages/sdk/src/host/tooling.ts#L373-L379](../../../../packages/sdk/src/host/tooling.ts#L373-L379) - `resourceRead` to a client"
  - "[code://packages/sdk/src/sessions.ts#L213-L215](../../../../packages/sdk/src/sessions.ts#L213-L215) - `fileSessions`, whose `dir` the attachments folder sits under"
  - "[code://packages/sdk/src/types/sessions.ts#L68](../../../../packages/sdk/src/types/sessions.ts#L68) - `SessionStore`, which answers where the folder is"
---

## Objective

Before the host applies a `chat/turnStarted` or `chat/pendingMessageSet`, each of its attachments becomes a read-only file under `<sessions dir>/attachments/<session id>/`. An `embeddedResource`, or a `file://` resource the host has no file for, is written there. The attachment is rewritten to a `resource` on that file, tagged as a snapshot.

## Files

- `CREATE: packages/sdk/src/host/attachments.ts` - `snapshot`.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - both actions go through `snapshot` before they are applied.
- `UPDATE: packages/sdk/src/types/sessions.ts` - `SessionStore.attachmentsDir?`, the one place that knows the folder.
- `UPDATE: packages/sdk/src/sessions.ts` - `fileSessions` answers it and removes the folder in `forget`.
- `CREATE: packages/sdk/test/host-attachments.test.ts`.
- `UPDATE: packages/sdk/test/sessions.test.ts` - the folder's name whatever the id says, and a removal that reaches only the session's own.

## Steps

1. Create the folder `0700` and each file `0400`. Name a file a unique prefix, the label's basename and the `contentType` extension, never a path from the client.
2. `embeddedResource`: decode and write.
3. `resource` on `file://` the host has no file for: `resourceRead` from the sending connection. Skip it when `sizeHint` is above 32 MiB, else write it.
4. Tag a `resource` already under the attachments folder, rather than rewriting it. Leave a directory, or a file that exists here, as sent.
5. The tag is `_meta["vscode.agentHost.snapshotAttachment"] = { isSnapshot: true, contentType }`, merged into the attachment's own `_meta`.
6. Any failure leaves that one attachment as sent and logs it.

## Validation

- A pasted PNG and pasted text become tagged `file://` resources in state, in the session file and in `begin`'s arguments.
- A label of `../../x` writes inside the folder.
- A deleted session leaves no folder.
- An id of `..`, `.`, `a/../..` or nothing gets a folder of its own strictly inside `<dir>/attachments`. Removing such a session leaves the sessions directory and every other session's attachments in place.

## Resume

Built. `snapshot` writes an attachment under the session's own folder, the action carries the path, and a session that goes takes the folder with it.

A review finding then reached the folder's name. `attachmentsOf` was `join(dir, 'attachments', encodeURIComponent(id))`, and `encodeURIComponent` leaves `.` alone. A session whose id was `..` got the sessions directory itself, and one whose id was `.` got the folder holding every session's attachments. Removing either ran `rmSync(..., { recursive: true, force: true })` over the lot. So a name that is empty, `.` or `..` after encoding is escaped to a name no id produces. The folder is answered only when it lies strictly inside `<dir>/attachments`. A store that cannot place one there says so in a line and answers nothing. That skips the write and the removal rather than reaching the directory.

The finding also asked what `createSession` makes of a channel whose id is `.` or `..`. `named` refuses an id that is empty and accepts these two. So `ahp-session:/` comes back as not a session URI, while `ahp-session:/..` and `ahp-session:/.` open a session under those ids. Not changed here, as the finding asked: what a client may call a session is not this plan's to decide.
