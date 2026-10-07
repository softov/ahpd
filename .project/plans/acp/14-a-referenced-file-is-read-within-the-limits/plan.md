---
title: An ACP prompt reads a referenced file only within the limits, and a queued message keeps its attachments
domain: acp
status: built
priority: high
created: 2026-10-06
revalidated: 2026-10-07
requires:
  - plans/host/68-an-attachments-bytes-are-a-file-the-host-wrote/plan.md
changes: []
creates: []
decisions:
  - decisions/an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file.md
  - decisions/a-pasted-image-goes-as-an-image-when-it-fits.md
  - decisions/pasted-text-is-inlined-up-to-64-kib.md
refs:
  - "[code://packages/sdk/src/attachments.ts#L65-L83](../../../../packages/sdk/src/attachments.ts#L65-L83) - `PartSource` and `Part`: a part names the attachment it came from, and a file's own text where it read one"
  - "[code://packages/sdk/src/attachments.ts#L99-L176](../../../../packages/sdk/src/attachments.ts#L99-L176) - `partsOf` and `partOf`: which of the three an attachment is, within which limits"
  - "[code://packages/agent-acp/src/session/turn.ts#L241-L270](../../../../packages/agent-acp/src/session/turn.ts#L241-L270) - `blocksFor`, which maps the parts to ACP blocks"
  - "[code://packages/sdk/src/resources.ts#L208-L217](../../../../packages/sdk/src/resources.ts#L208-L217) - `read`: `readFile` of the whole file, binary as base64"
  - "[code://packages/agent-acp/src/session/queue.ts#L176-L199](../../../../packages/agent-acp/src/session/queue.ts#L176-L199) - `startNext`, which passes a queued entry's attachments to `begin`"
  - "[code://packages/agent-acp/src/session/opening.ts#L372](../../../../packages/agent-acp/src/session/opening.ts#L372) - `promptCapabilities`, what the server takes"
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

- Today a 2 GB file or `/dev/zero` on a message makes an ACP session with `embeddedContext` read all of it into memory. A FIFO blocks the turn.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [An attachment's bytes are written to disk and the message names the file](../../../decisions/an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file.md) | Softov, 2026-10-06 |
| 2 | [A pasted image goes as an image when it fits](../../../decisions/a-pasted-image-goes-as-an-image-when-it-fits.md) | Softov, 2026-10-06 |
| 3 | [Pasted text is inlined up to 64 KiB](../../../decisions/pasted-text-is-inlined-up-to-64-kib.md) | Softov, 2026-10-06 |

| What | Source | Task |
| --- | --- | --- |
| `blocksFor` builds on `partsOf(text, attachments, { images: takes.image })`: an image part is an image block, a text part a text block, and a reference that names a file goes as an embedded `resource` only within the 64 KiB text limit when `embeddedContext` is true | host 68 task 03; the server opts in through `promptCapabilities` | 01 |
| A part carries the attachment it came from - the label, and the URI where it has one - so ACP names the file its `resource` block points at and the attachment its image block is | Softov, 2026-10-07, answering "the helper gives parts with no file name or URI, but ACP's embedded resource block requires a URI"; claude, pi and cofold ignore the field | 01 |
| An embedded `resource` carries the file's own text, not the helper's fenced copy of it, so the block is the file itself as a server reads one | Softov, 2026-10-07, "Fix raw text, then merge" | 01 |
| `contentOf` is no longer used for message attachments | the store read has no limit | 01 |
| A queued entry keeps its attachments and `startNext` passes them | host 68 task 02 | 02 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - blocksFor reads attachments through partsOf](task-01-blocks-for-reads-through-parts-of.md) | done | host 68 task 03 |
| [02 - A queued message keeps its attachments](task-02-a-queued-message-keeps-its-attachments.md) | done | host 68 task 02 |

## Risks and tradeoffs

- A large file a server could have taken as an embedded resource now goes by path. An ACP agent with its own file tools reads it, and one without them sees only the path.

## Resume state

- **Done so far:** both tasks are done. `blocksFor` sends what `partsOf` makes of a message. An image part is an image block, and a text part is a text block. A part from a file is an embedded `resource` carrying the file's own text when the server advertised `embeddedContext`. The bridge reads no referenced file itself, so a large file, a pipe and a device are each named by path. A queued message keeps its attachments, and the turn it becomes carries them.
- **Next action:** none. Reviewed and closed on 2026-10-07.
- **Open questions:** none.
- **Watch out for:** acp 10's rule still holds, so nothing past text goes to a server that did not ask for it. A part from an attachment with no file of its own goes as text, because a resource block needs a URI to name.

## Final verification checklist

- [x] A test attaches a 6 MB file, a FIFO and `/dev/zero` and the prompt names each without reading it.
- [x] A queued image reaches the server's prompt when its turn starts.
- [x] `pnpm` gates green.
- [x] `plans/index.md` updated.
