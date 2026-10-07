---
title: An attachment's bytes are a file the host wrote, and every backend reads attachments through one helper with one set of limits
domain: host
status: built
priority: medium
created: 2026-10-06
revalidated: 2026-10-07
requires: []
changes: []
creates: []
decisions:
  - decisions/an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file.md
  - decisions/a-pasted-image-goes-as-an-image-when-it-fits.md
  - decisions/pasted-text-is-inlined-up-to-64-kib.md
  - decisions/a-session-in-a-machine-gets-each-attachment-copied-into-it.md
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L345-L356](../../../../packages/sdk/src/host/chatactions.ts#L345-L356) - `chat/turnStarted`, where a message's attachments reach `beginOrRun`"
  - "[code://packages/sdk/src/host/chatactions.ts#L927-L974](../../../../packages/sdk/src/host/chatactions.ts#L927-L974) - `chat/pendingMessageSet`, queued and steering; both carry the message's attachments"
  - "[code://packages/sdk/src/host/lifecycle.ts#L901-L902](../../../../packages/sdk/src/host/lifecycle.ts#L901-L902) - `begin` and `queue` are handed the attachments"
  - "[code://packages/sdk/src/host/lifecycle.ts#L1061](../../../../packages/sdk/src/host/lifecycle.ts#L1061) - `messageAttachments`"
  - "[code://packages/sdk/src/host/tooling.ts#L373-L379](../../../../packages/sdk/src/host/tooling.ts#L373-L379) - reading a URI from the client that published it with `resourceRead`, the pattern for a client-only file"
  - "[code://packages/sdk/src/types/session.ts#L368](../../../../packages/sdk/src/types/session.ts#L368) - `steer(id, text, attachments?)`"
  - "[code://packages/sdk/src/types/session.ts#L377-L384](../../../../packages/sdk/src/types/session.ts#L377-L384) - `begin(..., attachments?)` and its doc comment"
  - "[code://packages/sdk/src/types/session.ts#L413-L420](../../../../packages/sdk/src/types/session.ts#L413-L420) - `queue(id, text, model?, from?, attachments?)`"
  - "[code://packages/sdk/src/sessions.ts#L213-L215](../../../../packages/sdk/src/sessions.ts#L213-L215) - `fileSessions`, whose `dir` the attachments folder sits under"
  - "[code://packages/sdk/src/resources.ts#L208-L216](../../../../packages/sdk/src/resources.ts#L208-L216) - `read`, whole file, no cap: the helper must not use it for attachments"
  - "[code://packages/agent-acp/src/session/turn.ts#L284-L321](../../../../packages/agent-acp/src/session/turn.ts#L284-L321) - `blocksFor`, the one backend mapping today"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentService.ts#L7548-L7600 - VS Code's host rewrite
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudePromptResolver.ts - VS Code's reference block wording, selection suffix and read-only note
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/codex/codexPromptResolver.ts - the textual types and the fenced block
---

## Goal

A pasted image, pasted text, an unsaved editor or a client-only file reaches every backend as a read-only file the host wrote. Chat state and the session file carry its path instead of its bytes.
Every backend turns a message's attachments into the same parts: a small image as an image, small text inline, everything else by path.
A queued or steering message carries its attachments as a begun one does.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above.

### Searches performed

- `rg "attachments" packages/sdk/src` - `begin` carries them; `queue` and `steer` do not; nothing rewrites them.
- `rg "maxPayload" packages/sdk/src` - none set, so `ws`'s 100 MiB default bounds an embedded attachment.
- `rg "store.read|resources.read" packages/agent-*/src` - `agent-acp`'s `contentOf` reads a referenced file whole through `read`, with no size or file-type check.

### Runtime path

```
chat/turnStarted | chat/pendingMessageSet with message.attachments
  -> snapshot (new): embeddedResource and client-only file:// written to <sessions dir>/attachments/<session>/, action rewritten
  -> applied to state, stored -> messageAttachments -> Session.begin / queue / steer
  -> backend: partsOf(text, attachments, { images }) -> its own blocks
```

### Gaps

- `Not found: attachment rewrite in packages/sdk/src - searched "attachments", "snapshot"`.
- `Session.queue` and `Session.steer` cannot carry attachments.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [An attachment's bytes are written to disk and the message names the file](../../../decisions/an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file.md) | Softov, 2026-10-06 |
| 2 | [A pasted image goes as an image when it fits](../../../decisions/a-pasted-image-goes-as-an-image-when-it-fits.md) | Softov, 2026-10-06 |
| 3 | [Pasted text is inlined up to 64 KiB](../../../decisions/pasted-text-is-inlined-up-to-64-kib.md) | Softov, 2026-10-06 |

| What | Source | Task |
| --- | --- | --- |
| `Session.queue` and `Session.steer` take an optional `attachments`, as `begin` does, and the host passes them | Softov, 2026-10-06, chose "Plan both" for attachments end to end (claude 20) | 02 |
| The helper reads a file only after `lstat` says it is a regular file within the limit, and reads at most the limit; a FIFO, device, socket or directory is named by path | the attachment is the client's to name, and `read` would block on a FIFO or fill memory on a device | 03 |
| References are one block in VS Code's wording: `The user provided the following references:`, one `- <path>` per line, `:<line>` for a selection, `(read-only snapshot, do not edit this file)` on a host-written file | upstream parity; VS Code's Claude resolver | 03 |
| A `simple` attachment is its `modelRepresentation` as text; `annotations` and `chat` are named by label | VS Code's resolvers; `blocksFor` | 03 |
| A client-only file is fetched with `resourceRead` only when its `sizeHint` is absent or at most 32 MiB; a larger one is left as sent | (defaulted: below `ws`'s 100 MiB payload, so a fetch never asks for more than a message could carry) | 01 |
| The attachments folder is removed with its session | the folder is the session's | 01 |
| A folder name that is empty, `.` or `..` after encoding is escaped to one no id produces, and a folder not strictly inside `<dir>/attachments` is refused in a line | an id is an opaque key and a folder name is not; the folder that holds every session is nobody's to remove | 01 |
| [A session in a machine gets each attachment copied into that machine at the same path](../../../decisions/a-session-in-a-machine-gets-each-attachment-copied-into-it.md) | Softov, 2026-10-07, chose "Copy into the machine" for how a machine session sees its attachments | 04 |

## Proposed architecture

- **The folder** - `SessionStore.attachmentsDir?(id)` is the one place that knows it. `fileSessions` answers `<its dir>/attachments/<name>` and removes it in `forget`. The name is the id escaped, so that no id names a folder rather than one under the root. The folder is answered only when it lies strictly inside `<dir>/attachments`. One that does not is a line in the log and nothing written or removed. A store that keeps nothing answers nothing. A session running in a machine is handed the files a message names.
The host asks the port to put them into that machine at the same path, after they are written and before the action is applied.
It asks for the folder back out when the session is removed.
- **Data flow** - `sdk/src/host/attachments.ts` (new): `snapshot(session, action, connection)` writes and rewrites; `sdk/src/attachments.ts` (new, exported): `partsOf(text, attachments, { images: boolean })` returns `Part[]`, where `Part` is `{ type: 'text', text }` or `{ type: 'image', mimeType, data }`, text first.
- **State flow** - the rewritten action is what is applied, stored and echoed; nothing else holds the bytes.
- **Layer responsibilities** - `sdk` host: the folder, the rewrite, the `Session` contract · `sdk` library: `partsOf` and its limits · each backend: its own block.
- **Source-of-truth files** - [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An embedded or client-only attachment becomes a file the host wrote](task-01-an-attachment-becomes-a-file-the-host-wrote.md) | done | - |
| [02 - A queued or steering message carries its attachments](task-02-a-queued-or-steering-message-carries-its-attachments.md) | done | - |
| [03 - partsOf turns attachments into text and image parts within the limits](task-03-parts-of-turns-attachments-into-parts.md) | done | 01 |
| [04 - A session in a machine reads its attachments at the path the host wrote](task-04-a-machine-reads-its-sessions-attachments.md) | done | 01 |

Backends take `partsOf` in their own plans: claude 20, acp 14, pi 15, plugin 36.

## Risks and tradeoffs

- A machine is handed one message's files at a time, so a machine that is not running when a message arrives is told nothing. The log has the line, and the message still goes with a path that is not a file in there.
- A session that moves to another machine leaves its attachments folder in the one it left, because only a removed session is taken back out. A machine an operator keeps outlives that.
- A rewritten chip is a `file://` resource on the host's disk; a client on another machine cannot open it, as with VS Code.
- An action that fails to snapshot is applied as sent, so a write failure still costs the bytes in state for that message.

## Resume state

- **Done so far:** all four tasks are implemented and their tests pass. The host writes an embedded or client-only attachment to `<sessions dir>/attachments/<session>/` before the action is applied. A queued or steering message carries its attachments the way a begun one does, and `partsOf` turns a message into its parts. A session running in a machine is handed the files a message names, at the same paths.
Its folder is taken back out of the machine when the session is removed.
A folder name that would name the root itself, or the folder above it, is escaped. A folder that does not lie strictly inside the root is refused rather than written into or removed.
- **Next action:** none. Reviewed and closed on 2026-10-07.
- **Open questions:** none.
- **Watch out for:** the rewrite is async, so it must finish before the action is applied, and must not reorder it on the channel.

## Final verification checklist

- [x] A host test sends a `chat/turnStarted` with a pasted PNG and reads a tagged `file://` snapshot in state, the session file and `begin`'s arguments.
- [x] A queued message and a steering message reach `queue` and `steer` with their attachments.
- [x] `partsOf` tests: small and large image, image of another type, `images: false`, small and large text, a FIFO, a directory, a selection, `simple`, `annotations`.
- [x] A session in a machine is handed the file a message names at the same path, read-only. Its folder goes out of the machine with the session.
- [x] An id of `..`, `.`, `a/../..` or nothing keeps a folder of its own inside the attachments root. A removal of it reaches nothing else, on this host and in a machine.
- [x] `pnpm` gates green.
- [x] `plans/index.md` updated.
