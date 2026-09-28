---
title: A turn's parts come in the order the model wrote them, one part per block
domain: pi
status: active
priority: high
created: 2026-09-28
revalidated: 2026-09-28
requires:
  - plans/pi/10-pi-outlives-the-process/plan.md
changes: []
creates: []
decisions: []
refs:
  - "[code://packages/agent-pi/src/session.ts#L744](../../../../packages/agent-pi/src/session.ts#L744) - the text part opened at turn start, before pi has written anything"
  - "[code://packages/agent-pi/src/mapping.ts#L144-L169](../../../../packages/agent-pi/src/mapping.ts#L144-L169) - every text delta into that one part, and one reasoning part per turn"
  - "[code://packages/agent-pi/src/replay.ts#L121-L151](../../../../packages/agent-pi/src/replay.ts#L121-L151) - replay seeds the same single text part and feeds the same mapping"
  - "[code://packages/agent-cofold/src/session.ts#L786](../../../../packages/agent-cofold/src/session.ts#L786) - cofold announces its markdown part at turn start too"
  - "[code://packages/agent-cofold/src/mapping.ts#L188](../../../../packages/agent-cofold/src/mapping.ts#L188) - cofold's one reasoning part per turn"
  - "[code://packages/agent-cofold/src/transcript.ts#L297-L303](../../../../packages/agent-cofold/src/transcript.ts#L297-L303) - cofold's transcript, already one part per block"
  - "[code://packages/agent-claude/src/session.ts#L1379-L1390](../../../../packages/agent-claude/src/session.ts#L1379-L1390) - claude opens a part per content block when the block starts, the pattern to reuse"
  - "[code://packages/agent-claude/src/transcript.ts#L286-L292](../../../../packages/agent-claude/src/transcript.ts#L286-L292) - claude's transcript keys a part by message and block"
  - npm://@microsoft/agent-host-protocol@^0.9.0 - `Turn.responseParts`, "all response content in stream order"
  - npm://@earendil-works/pi-coding-agent@^0.87.1 - `message_start`, `thinking_start`, `text_start`, `toolcall_start` and `contentIndex` on `message_update`
---

## Goal

A turn that thinks, calls a tool, thinks again and replies shows exactly that, in that order, with each thought its own block, live and after a reload, on pi and on cofold.

## Reconnaissance

The files read and the patterns to reuse are the `refs` above, each with its note.

### Searches performed

- Diagnosed on 2026-09-28 by calling pi's `mapEvent` with thinking, tool, thinking, text: the parts came out as `[t1:text "REPLY", t1:reasoning "THINK-1THINK-2", c1]`, and `replayEntries` gave the same for pi's one-message and two-message shapes.
- ahpapp folds with the protocol's `chatReducer` and draws `responseParts` in order, so it shows what the host sends.

### Runtime path

```
pi event -> mapEvent (one text part from turn start, one reasoning part) -> chat/responsePart, chat/delta, chat/reasoning -> client reducer appends parts in arrival order
```

### Gaps

- pi and cofold live open a markdown part before anything is written and send all text into it.
- Both keep one reasoning part per turn, so separate thoughts merge.
- pi's replay reproduces the same shape; cofold's transcript does not, so cofold's live and reloaded views disagree.

## Decisions locked in

| What | Source | Task |
| --- | --- | --- |
| One part per content block, opened when the block starts and keyed by message and block, as agent-claude does, on pi live and in replay. | Softov, 2026-09-28, asked how the reasoning-order fix goes ahead: "pi and cofold, build now". | 01 |
| cofold's live mapping does the same, so its live view matches its transcript. | Same answer. | 02 |
| The ACP bridge gets the same order, a part per run of chunks of one kind. | Softov, 2026-09-28, asked what happens with the ACP bridge's text-first order: "Add a pi/11 task 03"; built after his pi check. | 03 |
| A text block holding only whitespace opens no part, on pi, cofold and ACP. | Softov, 2026-09-28, asked which fixes from the missing-tool-calls diagnosis to build: "Skip whitespace-only text". | 04 |

## Tasks

| Task | Status | Depends on |
| --- | --- | --- |
| [01 - pi opens a part per block, live and in replay](task-01-pi-opens-a-part-per-block.md) | implemented | - |
| [02 - cofold opens a part per block live](task-02-cofold-opens-a-part-per-block.md) | implemented | - |
| [03 - The ACP bridge opens a part per run of chunks, in the order they arrived](task-03-acp-opens-a-part-per-run-of-chunks.md) | implemented | - |
| [04 - A text block that is only whitespace opens no part](task-04-whitespace-only-text-opens-no-part.md) | implemented | 01, 02, 03 |

## Risks and tradeoffs

- A turn starts with no parts: every consumer of `chat/turnStarted` in the host and its tests must accept an empty turn, which the protocol allows.
- A replayed pi session changes part ids, so a client holding a reloaded session keyed by the old `:text` id sees new ids after the next reload.

## Resume state

- **Done so far:** tasks 01, 02, 03 and 04 implemented, awaiting review: pi and cofold open a part per block where it starts, the ACP bridge opens a part per run of chunks of one kind, a turn starts with no part, and text that is only whitespace opens no part, live or after a reload.
- **Next action:** Softov reviews the four tasks and checks a pi, a cofold and an ACP turn that thinks, calls a tool and thinks again in ahpapp, before and after a reload, including a Kimi K2.6 turn on pi.
- **Open questions:** cofold's live part ids name the step (`${turnId}:${step}:${index}`) rather than the transcript's `${message.id}:${index}`, because cofold mints the message id after the deltas; kinds, contents and order match.
- **Watch out for:** a tool row now opens at the model's `toolcall_start`, so a call cut off mid-arguments is in the snapshot; pi's `finish` marks it `cancelled` with reason `skipped`.

## Final verification checklist

- [ ] thinking, tool, thinking, text shows in that order with two reasoning blocks, live and after a reload, on pi and cofold.
- [ ] `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.
- [ ] `plans/index.md` updated.
