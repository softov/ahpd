---
title: An ACP prompt reads a referenced file only within the limits, and a queued message keeps its attachments
domain: acp
status: planned
priority: high
created: 2026-10-06
revalidated: 2026-10-06
requires:
  - plans/host/68-an-attachments-bytes-are-a-file-the-host-wrote/plan.md
changes: []
creates: []
decisions:
  - decisions/an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file.md
  - decisions/a-pasted-image-goes-as-an-image-when-it-fits.md
  - decisions/pasted-text-is-inlined-up-to-64-kib.md
refs:
  - "[code://packages/agent-acp/src/session/turn.ts#L254-L270](../../../../packages/agent-acp/src/session/turn.ts#L254-L270) - `contentOf`, which reads a referenced file whole through the store"
  - "[code://packages/agent-acp/src/session/turn.ts#L284-L322](../../../../packages/agent-acp/src/session/turn.ts#L284-L322) - `blocksFor`"
  - "[code://packages/sdk/src/resources.ts#L208-L216](../../../../packages/sdk/src/resources.ts#L208-L216) - `read`: `readFile` of the whole file, binary as base64"
  - "[code://packages/agent-acp/src/session/queue.ts#L192](../../../../packages/agent-acp/src/session/queue.ts#L192) - \"A queued message carries no attachments\""
  - "[code://packages/agent-acp/src/session/opening.ts#L334](../../../../packages/agent-acp/src/session/opening.ts#L334) - `promptCapabilities`, what the server takes"
---

## Goal

An ACP turn never reads more of an attached file than host 68's limits allow, and never reads a FIFO or a device.
A queued message reaches the server with its attachments.

## Reconnaissance

### Searches performed

- `rg "store.read" packages/agent-acp/src` - `contentOf` and `fs/read_text_file`; only `contentOf` reads what a client named in a message.

### Runtime path

```
resource attachment (any file://, any size) -> contentOf -> store.read -> readFile whole -> base64 into the prompt
```

### Gaps

- Today a client that attaches a 2 GB file, or `/dev/zero`, to a message in an ACP session with `embeddedContext` makes the daemon read all of it into memory, and a FIFO blocks the turn.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [An attachment's bytes are written to disk and the message names the file](../../../decisions/an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file.md) | Softov, 2026-10-06 |
| 2 | [A pasted image goes as an image when it fits](../../../decisions/a-pasted-image-goes-as-an-image-when-it-fits.md) | Softov, 2026-10-06 |
| 3 | [Pasted text is inlined up to 64 KiB](../../../decisions/pasted-text-is-inlined-up-to-64-kib.md) | Softov, 2026-10-06 |

| What | Source | Task |
| --- | --- | --- |
| `blocksFor` builds on `partsOf(text, attachments, { images: takes.image })`: an image part is an image block, a text part a text block, and a reference that names a file goes as an embedded `resource` only within the 64 KiB text limit when `embeddedContext` is true | host 68 task 03; the server opts in through `promptCapabilities` | 01 |
| `contentOf` is no longer used for message attachments | the store read has no limit | 01 |
| A queued entry keeps its attachments and `startNext` passes them | host 68 task 02 | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - blocksFor reads attachments through partsOf](task-01-blocks-for-reads-through-parts-of.md) | todo | host 68 task 03 |
| [02 - A queued message keeps its attachments](task-02-a-queued-message-keeps-its-attachments.md) | todo | host 68 task 02 |

## Risks and tradeoffs

- A large file a server could have taken as an embedded resource now goes by path; an ACP agent with its own file tools reads it, one without them sees only the path.

## Resume state

- **Done so far:** nothing.
- **Next action:** host 68, then task 01.
- **Open questions:** none.
- **Watch out for:** acp 10's rule that nothing past text is sent unless the server asked for it still holds.

## Final verification checklist

- [ ] A test attaches a 6 MB file, a FIFO and `/dev/zero` and the prompt names each without reading it.
- [ ] A queued image reaches the server's prompt when its turn starts.
- [ ] `pnpm` gates green.
- [ ] `plans/index.md` updated.
