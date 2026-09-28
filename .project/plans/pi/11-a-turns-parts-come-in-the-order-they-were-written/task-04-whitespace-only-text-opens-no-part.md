---
title: A text block that is only whitespace opens no part
status: implemented
depends: [task-01-pi-opens-a-part-per-block.md, task-02-cofold-opens-a-part-per-block.md, task-03-acp-opens-a-part-per-run-of-chunks.md]
layer: "agent-pi, agent-cofold, agent-acp"
refs:
  - "[code://packages/agent-pi/src/mapping.ts](../../../../packages/agent-pi/src/mapping.ts) - `blockOf`, which opens a markdown part at `text_start`"
  - "[code://packages/agent-pi/src/replay.ts](../../../../packages/agent-pi/src/replay.ts) - replay raises the same block events"
  - "[code://packages/agent-cofold/src/mapping.ts](../../../../packages/agent-cofold/src/mapping.ts) - cofold's per-step text part"
  - "[code://packages/agent-acp/src/mapping.ts](../../../../packages/agent-acp/src/mapping.ts) - `runOf`, the ACP run of chunks"
---

## Objective

A model that writes a text block holding only whitespace before a tool call, as Kimi K2.6 writes `" "`, shows no empty reply between the thought and the call, live or after a reload.

## Files

- `UPDATE: packages/agent-pi/src/mapping.ts`, `packages/agent-pi/src/replay.ts` - a markdown part opens at the first delta of its block holding anything but whitespace, carrying the whitespace written before it.
- `UPDATE: packages/agent-pi/src/types.ts`, `packages/agent-pi/src/session.ts` - `PiTurn.waiting`, the held whitespace by block.
- `UPDATE: packages/agent-cofold/src/mapping.ts` - the same for a step's text.
- `UPDATE: packages/agent-cofold/src/transcript.ts` - a stored text part that is only whitespace becomes no part.
- `UPDATE: packages/agent-acp/src/mapping.ts`, `packages/agent-acp/src/types.ts` - the same for a run of message chunks, held in `AcpTurn.waiting`.
- `UPDATE: packages/agent-pi/test/`, `packages/agent-cofold/test/`, `packages/agent-acp/test/` - the cases below.

## Steps

1. Hold a markdown block's whitespace until a delta with other text arrives, then open the part with the held text first; a block that ends holding only whitespace opens nothing.
2. Reasoning parts are unchanged.

## Validation

- Found on 2026-09-28 in a pi session on Kimi K2.6 over OpenRouter: every assistant message is `thinking, text " ", toolCall`, and each `" "` became an empty markdown part that ahpapp draws as a blank reply.
- A case per backend: thinking, whitespace-only text, tool call, thinking, text gives `[reasoning, tool, reasoning, markdown]` live, and for pi and cofold the same after a reload; it fails first.
- A case: text that starts with whitespace and goes on keeps its leading whitespace in the one part.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

pi: `mapEvent` no longer opens a markdown part at `text_start`; a `text_delta` for a block with no part yet adds to `PiTurn.waiting` under the block's key while the held text is only whitespace, and at the first other delta opens the part and sends the held text and the delta as one `chat/delta`.
pi replay feeds the same mapping, so a whitespace-only block opens nothing after a reload either, and its `${message}:${contentIndex}` key is left unused, so live and replayed ids match.
cofold: `write` holds a step's text the same way until it holds more than whitespace, clearing it at `model.started`, and `transcript.ts` skips a stored text part whose text trims to empty, so `m1:1` names nothing and the other ids keep their place.
ACP: `chunk` holds a markdown run in `AcpTurn.waiting` while it is only whitespace, and a held run takes no position, so ids stay `${turnId}:${position}` and the transcript, which replays the same updates, agrees.
ACP, my own call: a tool call drops the held whitespace, and a thought after held whitespace opens a new reasoning part rather than joining the thought before it, as it did when the whitespace was a part.
Empty text counts as whitespace, so an empty text block opens no part on any backend either.
The existing pi test that expected a part at `text_start` now expects the part with the first delta.
Tests, all failing first: pi `opens no part for a text block that is only whitespace, live and replayed` and `keeps the whitespace a text block starts with in its one part`; cofold `opens no part for text that is only whitespace, live or read back` and `keeps the whitespace a reply starts with in its one part, live and read back`; ACP `opens no part for a message that is only whitespace, and keeps the whitespace an answer starts with` (live) and `reads back no part for a message that was only whitespace, with the ids the live turn held` (transcript), on a new `blank` fixture script.
The cofold store test's scripted model and fold moved into helpers (`scripted`, `drawn`, `played`) shared by the task 02 case and the new ones; the ACP fixture's `ponder` script uses the same new `listing`, `thought` and `message` helpers as `blank`.
Gates: `pnpm typecheck` and `pnpm boundary` clean, `pnpm test` 107 files and 1529 tests passed on the first full run, with no flake.
