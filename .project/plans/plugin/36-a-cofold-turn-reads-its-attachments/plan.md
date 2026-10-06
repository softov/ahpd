---
title: A cofold turn reads its message's attachments, and sends an image only to a model that takes images
domain: plugin
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
  - "[code://packages/agent-cofold/src/session.ts#L288](../../../../packages/agent-cofold/src/session.ts#L288) - `begin`, dropping the fifth argument"
  - "[code://packages/agent-cofold/src/session.ts#L307-L316](../../../../packages/agent-cofold/src/session.ts#L307-L316) - `steer`, text only"
  - "[code://packages/agent-cofold/src/turns.ts#L120-L127](../../../../packages/agent-cofold/src/turns.ts#L120-L127) - `run({ input: text })`"
  - "[code://packages/agent-cofold/src/turns.ts#L21](../../../../packages/agent-cofold/src/turns.ts#L21) - `queue`"
  - npm://@cofold/agents@^0.2 - `RunArgs.input` is `string | ContentPart[]`; `ImagePart` is `{ type: 'image', mimeType, data }`; `Model.features.images`
  - npm://@cofold/model-openai-compat@^0.2 - an image part to a model without `features.images` throws `image part not supported by this model`
---

## Goal

A message sent to a cofold session with attachments reaches the model: text parts and references as text, a small image as an image part when the model's `features.images` is true.
The same for a queued and a steering message.

## Reconnaissance

### Searches performed

- `rg "attachments" packages/agent-cofold/src` - nothing.
- cofold `run` input - a string or `ContentPart[]`.

### Runtime path

```
Session.begin / queue / steer (host 68) -> partsOf(text, attachments, { images: model.features.images })
  -> ContentPart[] -> run({ input }) / the run's steer
```

## Decisions locked in

| # | Decision | Rationale / source |
| --- | --- | --- |
| 1 | [An attachment's bytes are written to disk and the message names the file](../../../decisions/an-attachments-bytes-are-written-to-disk-and-the-message-names-the-file.md) | Softov, 2026-10-06 |
| 2 | [A pasted image goes as an image when it fits](../../../decisions/a-pasted-image-goes-as-an-image-when-it-fits.md) | Softov, 2026-10-06 |
| 3 | [Pasted text is inlined up to 64 KiB](../../../decisions/pasted-text-is-inlined-up-to-64-kib.md) | Softov, 2026-10-06 |

| What | Source | Task |
| --- | --- | --- |
| `images` is the turn's model's `features.images`, never assumed | an image part to a text-only model throws, and the stored message would fail every later turn of the session | 01 |
| No attachments: `input` stays the string | a message with none is sent as today | 01 |
| `queue` keeps attachments on the entry; `steer` sends its parts | host 68 task 02 | 01 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - begin, queue and steer send their attachments to the run](task-01-begin-queue-and-steer-send-attachments.md) | todo | host 68 |

## Risks and tradeoffs

- cofold's own read tool refuses binary files, so a PDF or other binary named by path is a path the model cannot open; it is named rather than dropped.

## Resume state

- **Done so far:** nothing.
- **Next action:** host 68, then task 01.
- **Open questions:** none.
- **Watch out for:** if cofold's run steer takes only a string, ask before changing `@cofold/agents`.

## Final verification checklist

- [ ] A test reads the `input` a run was started with for a small image on an images model, the same image on a text-only model, pasted text and a picked file.
- [ ] `pnpm` gates green.
- [ ] `plans/index.md` updated.
