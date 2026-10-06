---
title: A Claude turn reads its message's attachments, queued and steered ones included
domain: claude
status: planned
priority: medium
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
  - "[code://packages/agent-claude/src/session/turns.ts#L88](../../../../packages/agent-claude/src/session/turns.ts#L88) - `beginTurn`, which takes text and no attachments"
  - "[code://packages/agent-claude/src/session/turns.ts#L190-L196](../../../../packages/agent-claude/src/session/turns.ts#L190-L196) - the prompt pushed to the CLI as `content: sent`, a string"
  - "[code://packages/agent-claude/src/session/turns.ts#L373](../../../../packages/agent-claude/src/session/turns.ts#L373) - `begin`, which drops the SDK's fifth argument"
  - "[code://packages/agent-claude/src/session/turns.ts#L433](../../../../packages/agent-claude/src/session/turns.ts#L433) - `steer`, which pushes text only"
  - "[code://packages/agent-acp/src/session/turn.ts#L284-L322](../../../../packages/agent-acp/src/session/turn.ts#L284-L322) - `blocksFor`, the sibling backend's mapping of attachments to content blocks, the pattern to mirror"
  - "[code://packages/agent-acp/src/session/queue.ts#L192](../../../../packages/agent-acp/src/session/queue.ts#L192) - \"A queued message carries no attachments: `Session.queue` takes none.\""
  - "[code://packages/sdk/src/types/session.ts#L380](../../../../packages/sdk/src/types/session.ts#L380) - `begin(..., attachments?)`, already carrying them; `queue` and `steer` get them in host 68"
  - npm://@anthropic-ai/claude-agent-sdk@* - a user message's `content` takes text and image (base64 source) blocks
  - https://github.com/microsoft/vscode/blob/7516b04bc94/src/vs/platform/agentHost/node/claude/claudePromptResolver.ts - VS Code's Claude resolver: text first, references as one block
---

## Goal

A message a client sends to a Claude session with files or pasted content attached reaches the model with them, as host 68's `partsOf` gives them: a small image as an image, small text inline, everything else by path, which the CLI reads with its own tools.
The same holds for a message that waits in the queue or steers a running turn.
Today a Claude session drops every attachment, so a client that sends them (ahpapp `chat/03`) shows chips the agent never sees.

## Reconnaissance

The files read and the pattern to mirror are the `refs` above.

### Searches performed

- `rg "attachments" packages/agent-claude/src` - nothing; the backend never reads them.
- `rg "attachments" packages/sdk/src` - `begin` carries them; `queue` and `steer` do not.
- `rg "maxPayload" packages/sdk/src` - none set, so the `ws` server's default of 100 MiB applies.

### Runtime path

```
chat/turnStarted or pendingMessageSet -> host 68 writes the bytes to disk -> Session.begin / queue / steer
  -> partsOf(text, attachments, { images: true }) -> blocksFor(parts) -> waiting.push({ role: 'user', content: blocks }) -> the CLI
```

### Gaps

- `Not found: attachment handling in packages/agent-claude/src - searched "attachments"`.
- `Session.queue` and `Session.steer` cannot carry attachments; host 68 task 02 adds them.

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [An attachment's bytes are written to disk and the message names the file](../../../decisions/an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file.md) | Softov, 2026-10-06 |
| 2 | [A pasted image goes as an image when it fits](../../../decisions/a-pasted-image-goes-as-an-image-when-it-fits.md) | Softov, 2026-10-06 |
| 3 | [Pasted text is inlined up to 64 KiB](../../../decisions/pasted-text-is-inlined-up-to-64-kib.md) | Softov, 2026-10-06 |

| What | Source | Task |
| --- | --- | --- |
| The blocks are `partsOf`'s parts: a text part is a text block, an image part is `{ type: 'image', source: { type: 'base64', media_type, data } }` | host 68 task 03 | 01 |
| A PDF goes by path, not as a document block: the CLI's own read tool reads PDFs, and a document block the API refuses stays in the conversation | (defaulted: decision 2's reasoning applied to PDFs; a document block is the one thing `partsOf` does not give) | 01 |
| `queue` keeps the attachments on the entry until `startNext`; `steer` pushes `blocksFor` of its parts | Softov, 2026-10-06, chose "Plan both" for attachments end to end | 02 |
| The wire message keeps its attachments as host 68 rewrote them; only the prompt is built from them | the protocol: the turn's `message` is what was accepted | 01 |

## Proposed architecture

- **Data flow** - `agent-claude/src/session/attachments.ts` (new): `blocksFor(text, attachments)` calls `partsOf` and maps each part to a block, or returns the plain string when there are no attachments, so a message with none is sent exactly as today.
- **State flow** - `ctx.active.message` keeps `attachments` for the transcript; `ctx.queued` entries keep them until `startNext`.
- **Layer responsibilities** - `sdk` (host 68): the files, the limits and the `Session` contract · `agent-claude`: the mapping and the three pushes.
- **Source-of-truth files** - [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts), [`code://packages/agent-claude/src/session/turns.ts`](../../../../packages/agent-claude/src/session/turns.ts)

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - A begun turn sends its attachments to the CLI](task-01-a-begun-turn-sends-its-attachments.md) | todo | - |
| [02 - A queued or steering message keeps its attachments](task-02-a-queued-or-steering-message-keeps-them.md) | todo | 01, host 68 task 02 |

## Risks and tradeoffs

- An image the API refuses would stay in the CLI's conversation and fail every later turn; `partsOf` sends only the four types the API takes at 5 MB or less, and the tests hold it to that.
- A Claude session in a machine reads host 68's files only if the machine can see the attachments folder (host 68's open question).

## Resume state

- **Done so far:** nothing.
- **Next action:** host 68, then [task-01-a-begun-turn-sends-its-attachments.md](task-01-a-begun-turn-sends-its-attachments.md).
- **Open questions:** none.
- **Watch out for:** the side-chat `carried` prefix is text and must stay the first block when blocks are sent.

## Final verification checklist

- [ ] A test drives a Claude session with a fake CLI and checks the pushed `content` for a picked file, a small and a large image, small and large pasted text, a PDF and an unknown type.
- [ ] A queued message with an image starts its turn with the image block.
- [ ] A message with no attachments is pushed as the same string as before.
- [ ] `pnpm` gates green.
- [ ] `plans/index.md` updated.
