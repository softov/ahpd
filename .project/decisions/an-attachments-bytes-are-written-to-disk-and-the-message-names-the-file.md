---
title: An attachment's bytes are written to a file in the session's attachments folder, and the message names that file
status: accepted
date: 2026-10-06
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L278](../../packages/sdk/src/host/chatactions.ts#L278) - `chat/turnStarted`, where a message's attachments reach the host"
  - "[code://packages/sdk/src/host/chatactions.ts#L828](../../packages/sdk/src/host/chatactions.ts#L828) - `chat/pendingMessageSet`, the queued and steering half"
  - "[code://packages/sdk/src/sessions.ts#L178](../../packages/sdk/src/sessions.ts#L178) - one JSON file per session, which today holds every pasted attachment's base64"
  - "[code://packages/sdk/src/resources.ts#L208-L217](../../packages/sdk/src/resources.ts#L208-L217) - `read`, which loads a whole file and returns binary as base64"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentService.ts#L7548-L7600 - `_rewriteUserMessageAttachments`, the host rewrite this mirrors
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/common/meta/vscode/agentSnapshotAttachmentMeta.ts - `vscode.agentHost.snapshotAttachment`, the tag on a rewritten attachment
---

## Context

A message's `embeddedResource` attachment carries its bytes as base64, and the protocol bounds it only by the WebSocket payload (100 MiB by default).
Kept as sent, those bytes live in the chat state every subscriber receives and in the session's JSON file, which is rewritten on every change.
A `resource` attachment names a URI that may be a file only the sending client has.
Each backend would otherwise decide on its own how much of either to read and inline.

## Decision

When a `chat/turnStarted` or `chat/pendingMessageSet` carries attachments, the host writes each `embeddedResource`, and each `file://` resource that is not on this host (read from the sending client with `resourceRead`), to a read-only file in the session's attachments folder before the action is applied.
The attachment is rewritten to a `resource` on that file, tagged `_meta["vscode.agentHost.snapshotAttachment"] = { isSnapshot: true, contentType }`.
A resource already on this host, and a directory, are left as sent.
A write that fails leaves the attachment as sent.

Source: Softov, 2026-10-06, asked "Where should the bytes of a pasted or embedded attachment live once the host accepts the message?" and chose "Host writes to disk".

## Consequences

- Chat state and the session file carry a path, not the bytes.
- Every backend reads a file, so one helper with one set of limits serves all of them.
- The folder is the session's and goes when the session is deleted.
- A session running in a machine needs the folder readable there.
- A client sees its chip become a `file://` resource; VS Code does the same and draws it.

## Options

- Inline, capped per backend: base64 stays in the message, state and session file; every backend caps on its own. Lost: the bytes would still reach every client and every session save.
