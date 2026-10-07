---
title: A pi turn reads its message's attachments, queued and steered ones included
domain: pi
status: built
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
  - "[code://packages/agent-pi/src/session.ts#L867-L874](../../../../packages/agent-pi/src/session.ts#L867-L874) - the inner `begin`, which takes the turn's attachments as its last parameter"
  - "[code://packages/agent-pi/src/session.ts#L951](../../../../packages/agent-pi/src/session.ts#L951) - the prompt a turn's parts are built for"
  - "[code://packages/agent-pi/src/session.ts#L1114-L1127](../../../../packages/agent-pi/src/session.ts#L1114-L1127) - `begin` as the host calls it, which keeps a message's attachments"
  - "[code://packages/agent-pi/src/session.ts#L1152-L1172](../../../../packages/agent-pi/src/session.ts#L1152-L1172) - `steer`, which carries its images"
  - "[code://packages/agent-pi/src/session.ts#L1188-L1201](../../../../packages/agent-pi/src/session.ts#L1188-L1201) - `queue`, which keeps them on the entry"
  - "[code://packages/agent-pi/src/backend.ts#L41-L43](../../../../packages/agent-pi/src/backend.ts#L41-L43) - `prompt` and `steer` over pi's `AgentSession`, each taking images"
  - "[code://packages/agent-pi/src/backend.ts#L305](../../../../packages/agent-pi/src/backend.ts#L305) - `takesImages`, read off the model the session is on"
  - "[code://packages/agent-pi/src/models.ts#L20-L35](../../../../packages/agent-pi/src/models.ts#L20-L35) - `PiModel`, which carries pi's `input`"
  - npm://@earendil-works/pi-coding-agent@0.87.1 - `prompt(text, { images })` and `steer(text, images)` take `ImageContent` (`{ type: 'image', data, mimeType }`)
---

## Goal

A pi session's message reaches the model with the attachments it was sent with.
The text and the references go in the prompt text.
A small image goes as pi's `images` when the model takes one, and by its path otherwise.
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
| [01 - begin, queue and steer send their attachments to pi](task-01-begin-queue-and-steer-send-attachments.md) | done | host 68 |

## Risks and tradeoffs

- A session with no model yet takes no image, so the picture goes by its path rather than risk a turn the provider refuses.

## Resume state

- **Done so far:** built 2026-10-07; see [implemented.md](implemented.md). The three doors build their parts with `partsOf` and hand pi the joined text beside its `ImageContent`. The turn's and the queued entry's `message` keep their attachments.
- **Next action:** none. Reviewed and closed on 2026-10-07.
- **Open questions:** none.
- **Watch out for:** `startNext` (now line 965) calls the inner `begin` with the queued id as its fifth argument. A queued message's attachments go through the last parameter.

## Final verification checklist

- [x] A test reads what `prompt` and `steer` were given: a small image, a large image, pasted text and a picked file.
- [x] A model without `image` in its input gets the image by path.
- [x] `pnpm` gates green.
- [x] `plans/index.md` updated.
