---
title: A turn's parts come in the order the model wrote them, one part per block - implemented
date: 2026-09-28
refs:
  - git://cdf947e
  - "[code://packages/agent-pi/src/mapping.ts](../../../../packages/agent-pi/src/mapping.ts) - `blockOf`, a part per block and the held whitespace"
  - "[code://packages/agent-pi/src/replay.ts](../../../../packages/agent-pi/src/replay.ts) - replay raises the live block events"
  - "[code://packages/agent-cofold/src/mapping.ts](../../../../packages/agent-cofold/src/mapping.ts) - a part per step and kind"
  - "[code://packages/agent-cofold/src/transcript.ts](../../../../packages/agent-cofold/src/transcript.ts) - a stored whitespace-only text part is no part"
  - "[code://packages/agent-acp/src/mapping.ts](../../../../packages/agent-acp/src/mapping.ts) - `runOf`, a part per run of chunks of one kind"
---

A turn that thinks, calls a tool, thinks again and replies shows exactly that, in that order, with each thought its own part, live and after a reload, on pi, cofold and the ACP bridge.
A turn starts with no part, and text that is only whitespace opens none.

## What was built

- [`code://packages/agent-pi/src/mapping.ts`](../../../../packages/agent-pi/src/mapping.ts) - a `reasoning` or `markdown` part opens where its block starts, with id `${turnId}:${message}:${contentIndex}` kept in `PiTurn.blocks`; a tool row opens at `toolcall_start`; a text block's whitespace is held in `PiTurn.waiting` until it holds anything else.
- [`code://packages/agent-pi/src/replay.ts`](../../../../packages/agent-pi/src/replay.ts) - raises `message_start` per assistant entry and each block's events with its real index, so a replayed turn has the live parts and ids.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - a turn opens no part at start, and `finish` marks a row still `streaming` as `cancelled` with reason `skipped`.
- [`code://packages/agent-cofold/src/mapping.ts`](../../../../packages/agent-cofold/src/mapping.ts) - a step's reasoning and text parts open where the step starts writing each kind, as `${turnId}:${step}:${index}`, and the non-streaming fallback opens them in the reply's order.
- [`code://packages/agent-cofold/src/transcript.ts`](../../../../packages/agent-cofold/src/transcript.ts) - a stored text part that trims to empty is skipped, and the other ids keep their place.
- [`code://packages/agent-acp/src/mapping.ts`](../../../../packages/agent-acp/src/mapping.ts) - a chunk joins the turn's last part when it has the same kind, and otherwise opens a part `${turnId}:${position}`; a whitespace-only message run is held in `AcpTurn.waiting` and takes no position.
- [`code://packages/agent-acp/src/session.ts`](../../../../packages/agent-acp/src/session.ts) and [`code://packages/agent-acp/src/transcript.ts`](../../../../packages/agent-acp/src/transcript.ts) - a live and a watched turn start with no part.

## Verified

- [`code://packages/agent-pi/test/agent-pi.test.ts`](../../../../packages/agent-pi/test/agent-pi.test.ts) - thinking, tool, thinking, text from one message and from two, live and replayed with the same ids; a row opened at `toolcall_start` and started once; a turn that starts with no part; a streaming row skipped on cancel; a whitespace-only block opening nothing, live and replayed.
- [`code://packages/agent-cofold/test/agent-cofold-store.test.ts`](../../../../packages/agent-cofold/test/agent-cofold-store.test.ts) - the live and transcript orders agree in kinds, contents and order, and whitespace-only text opens no part, live or read back.
- [`code://packages/agent-acp/test/agent-acp-turn.test.ts`](../../../../packages/agent-acp/test/agent-acp-turn.test.ts) and [`code://packages/agent-acp/test/agent-acp-catalog.test.ts`](../../../../packages/agent-acp/test/agent-acp-catalog.test.ts) - the `ponder` and `blank` fixture scripts, live and in the transcript with the ids the live turn held.
- Softov checked in ahpapp on 2026-09-28: a pi turn on Kimi K2.6 and a cofold turn (thought, tool call, thought, reply) show in order, with no blank replies, live and after a reload.
- `pnpm typecheck` and `pnpm boundary` clean, `pnpm test` green at the close.

## Departures from the plan

- cofold's live part ids name the step (`${turnId}:${step}:${index}`) rather than the transcript's `${message.id}:${index}`, because cofold's `model.delta` names no message or block and the message id is minted after the deltas; kinds, contents and order match.
- In the ACP bridge a tool call drops held whitespace, and a thought after held whitespace opens a new reasoning part rather than joining the thought before it, as it did when the whitespace was a part.

## Left for later

- Nothing from the plan. An ACP turn was not checked by hand in ahpapp; the tests cover its order.
