---
title: An attachment's bytes are a file the host wrote, and every backend reads attachments through one helper with one set of limits
domain: host
status: planned
priority: medium
created: 2026-10-06
revalidated: 2026-10-06
requires: []
changes: []
creates: []
decisions:
  - decisions/an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file.md
  - decisions/a-pasted-image-goes-as-an-image-when-it-fits.md
  - decisions/pasted-text-is-inlined-up-to-64-kib.md
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L278-L291](../../../../packages/sdk/src/host/chatactions.ts#L278-L291) - `chat/turnStarted`, where a message's attachments reach `beginOrRun`"
  - "[code://packages/sdk/src/host/chatactions.ts#L828-L850](../../../../packages/sdk/src/host/chatactions.ts#L828-L850) - `chat/pendingMessageSet`, queued and steering; `steer` gets text only"
  - "[code://packages/sdk/src/host/lifecycle.ts#L775-L776](../../../../packages/sdk/src/host/lifecycle.ts#L775-L776) - `begin` gets the attachments, `queue` does not"
  - "[code://packages/sdk/src/host/lifecycle.ts#L901-L904](../../../../packages/sdk/src/host/lifecycle.ts#L901-L904) - `messageAttachments`"
  - "[code://packages/sdk/src/host/tooling.ts#L349-L355](../../../../packages/sdk/src/host/tooling.ts#L349-L355) - reading a URI from the client that published it with `resourceRead`, the pattern for a client-only file"
  - "[code://packages/sdk/src/types/session.ts#L364](../../../../packages/sdk/src/types/session.ts#L364) - `steer(id, text)`"
  - "[code://packages/sdk/src/types/session.ts#L374-L380](../../../../packages/sdk/src/types/session.ts#L374-L380) - `begin(..., attachments?)` and its doc comment"
  - "[code://packages/sdk/src/types/session.ts#L412](../../../../packages/sdk/src/types/session.ts#L412) - `queue(id, text, model?, from?)`"
  - "[code://packages/sdk/src/sessions.ts#L178](../../../../packages/sdk/src/sessions.ts#L178) - one file per session in the store's `dir`, which the attachments folder sits beside"
  - "[code://packages/sdk/src/resources.ts#L208-L216](../../../../packages/sdk/src/resources.ts#L208-L216) - `read`, whole file, no cap: the helper must not use it for attachments"
  - "[code://packages/agent-acp/src/session/turn.ts#L284-L322](../../../../packages/agent-acp/src/session/turn.ts#L284-L322) - `blocksFor`, the one backend mapping today"
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/agentService.ts#L7548-L7600 - VS Code's host rewrite
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudePromptResolver.ts - VS Code's reference block wording, selection suffix and read-only note
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/codex/codexPromptResolver.ts - the textual types and the fenced block
---

## Goal

A pasted image, pasted text, an unsaved editor or a file the client has and the host does not reaches any backend as a read-only file the host wrote, and the chat state and session file carry its path instead of its bytes.
Every backend turns a message's attachments into the same parts with the same limits: a small image as an image, small text inline, everything else by path.
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

## Proposed architecture

- **Data flow** - `sdk/src/host/attachments.ts` (new): `snapshot(session, action, connection)` writes and rewrites; `sdk/src/attachments.ts` (new, exported): `partsOf(text, attachments, { images: boolean })` returns `Part[]`, where `Part` is `{ type: 'text', text }` or `{ type: 'image', mimeType, data }`, text first.
- **State flow** - the rewritten action is what is applied, stored and echoed; nothing else holds the bytes.
- **Layer responsibilities** - `sdk` host: the folder, the rewrite, the `Session` contract · `sdk` library: `partsOf` and its limits · each backend: `Part` to its own block, in its own plan.
- **Source-of-truth files** - [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts), [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - An embedded or client-only attachment becomes a file the host wrote](task-01-an-attachment-becomes-a-file-the-host-wrote.md) | todo | - |
| [02 - A queued or steering message carries its attachments](task-02-a-queued-or-steering-message-carries-its-attachments.md) | todo | - |
| [03 - partsOf turns attachments into text and image parts within the limits](task-03-parts-of-turns-attachments-into-parts.md) | todo | 01 |

Backends take `partsOf` in their own plans: claude 20, acp 14, pi 15, plugin 36.

## Risks and tradeoffs

- A session in a machine reads paths inside the machine; the attachments folder must be readable there at the same path, or a machine session gets only names. See Resume state.
- A rewritten chip is a `file://` resource on the host's disk; a client on another machine cannot open it, as with VS Code.
- An action that fails to snapshot is applied as sent, so a write failure still costs the bytes in state for that message.

## Resume state

- **Done so far:** nothing.
- **Next action:** [task-01-an-attachment-becomes-a-file-the-host-wrote.md](task-01-an-attachment-becomes-a-file-the-host-wrote.md).
- **Open questions:**
  1. How does a session in a machine read the attachments folder? - proposed: the computer binds `<sessions dir>/attachments/<session>` read-only at the same path; ask before building if the computer has no per-session bind.
- **Watch out for:** the rewrite is async and must finish before the action is applied, without reordering it against the actions behind it on the same channel.

## Final verification checklist

- [ ] A host test sends a `chat/turnStarted` with a pasted PNG and reads a `file://` resource tagged as a snapshot in state, in the session file and in what `begin` got.
- [ ] A queued message and a steering message reach `queue` and `steer` with their attachments.
- [ ] `partsOf` tests: small and large image, image of another type, `images: false`, small and large text, a FIFO, a directory, a selection, `simple`, `annotations`.
- [ ] `pnpm` gates green.
- [ ] `plans/index.md` updated.
