---
title: A pi turn reads its message's attachments, queued and steered ones included
domain: pi
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
  - "[code://packages/agent-pi/src/session.ts#L1007-L1015](../../../../packages/agent-pi/src/session.ts#L1007-L1015) - `begin` as the host calls it, dropping the fifth argument"
  - "[code://packages/agent-pi/src/session.ts#L852](../../../../packages/agent-pi/src/session.ts#L852) - `backend.prompt(text)`"
  - "[code://packages/agent-pi/src/session.ts#L1041-L1044](../../../../packages/agent-pi/src/session.ts#L1041-L1044) - `steer`, text only"
  - "[code://packages/agent-pi/src/session.ts#L1072-L1079](../../../../packages/agent-pi/src/session.ts#L1072-L1079) - `queue`, no attachments on the entry"
  - "[code://packages/agent-pi/src/backend.ts#L268-L269](../../../../packages/agent-pi/src/backend.ts#L268-L269) - `prompt` and `steer` over pi's `AgentSession`"
  - "[code://packages/agent-pi/src/models.ts#L20-L28](../../../../packages/agent-pi/src/models.ts#L20-L28) - `PiModel`, which does not carry pi's `input` yet"
  - npm://@earendil-works/pi-coding-agent@0.87.1 - `prompt(text, { images })` and `steer(text, images)` take `ImageContent` (`{ type: 'image', data, mimeType }`)
---

## Goal

A message sent to a pi session with attachments reaches the model with them: text and references in the prompt text, a small image as pi's `images` when the model takes images.
The same for a queued and a steering message.

## Reconnaissance

### Searches performed

- `rg "attachments" packages/agent-pi/src` - nothing.
- pi's `PromptOptions` - `images?: ImageContent[]`; text is the only other input.

### Runtime path

```
Session.begin / queue / steer (host 68) -> partsOf(text, attachments, { images: model takes images })
  -> text parts joined with a blank line -> prompt(text, { images }) / steer(text, images)
```

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [An attachment's bytes are written to disk and the message names the file](../../../decisions/an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file.md) | Softov, 2026-10-06 |
| 2 | [A pasted image goes as an image when it fits](../../../decisions/a-pasted-image-goes-as-an-image-when-it-fits.md) | Softov, 2026-10-06 |
| 3 | [Pasted text is inlined up to 64 KiB](../../../decisions/pasted-text-is-inlined-up-to-64-kib.md) | Softov, 2026-10-06 |

| What | Source | Task |
| --- | --- | --- |
| pi takes one text and a list of images, so text parts are joined with a blank line and image parts become `ImageContent` | pi's `PromptOptions` | 01 |
| `images` is true only when the turn's model lists `image` in pi's `input`; otherwise images go by path | decision 2: never send what the model refuses | 01 |
| `queue` keeps attachments on the entry; `steer` passes its images | host 68 task 02 | 01 |
| The active turn's `message` keeps its attachments | the protocol: the turn's message is what was accepted | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - begin, queue and steer send their attachments to pi](task-01-begin-queue-and-steer-send-attachments.md) | todo | host 68 |

## Risks and tradeoffs

- pi resolves a model per session; if the turn's model is not known when the prompt is built, the check falls back to the session's model.

## Resume state

- **Done so far:** nothing.
- **Next action:** host 68, then task 01.
- **Open questions:** none.
- **Watch out for:** `startNext` (line 879) calls the inner `begin` with the queued id as its fifth argument; the attachments go through a new parameter, not that one.

## Final verification checklist

- [ ] A test with the scripted pi backend reads the text and images given to `prompt` and `steer` for a small image, a large image, pasted text and a picked file.
- [ ] A model without `image` in its input gets the image by path.
- [ ] `pnpm` gates green.
- [ ] `plans/index.md` updated.
