---
title: pi opens a part per block, live and in replay
status: implemented
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L744](../../../../packages/agent-pi/src/session.ts#L744) - the text part opened at turn start"
  - "[code://packages/agent-pi/src/mapping.ts#L144-L169](../../../../packages/agent-pi/src/mapping.ts#L144-L169) - text and thinking deltas, each into one part per turn"
  - "[code://packages/agent-pi/src/types.ts#L110-L112](../../../../packages/agent-pi/src/types.ts#L110-L112) - `PiTurn.textPartId` and `reasoningPartId`"
  - "[code://packages/agent-pi/src/replay.ts#L121-L151](../../../../packages/agent-pi/src/replay.ts#L121-L151) - the replay's seed part and the events it raises"
  - "[code://packages/agent-claude/src/session.ts#L1379-L1390](../../../../packages/agent-claude/src/session.ts#L1379-L1390) - the pattern: a part per block when the block starts"
---

## Objective

A pi turn's `responseParts` hold one part per thinking or text block and one row per tool call, in the order pi wrote them, live and after a replay from disk.

## Files

- `UPDATE: packages/agent-pi/src/session.ts:744` - a turn starts with no part.
- `UPDATE: packages/agent-pi/src/mapping.ts` - count assistant messages on `message_start`; open a `reasoning` or `markdown` part on `thinking_start`, `text_start` or the first delta of a `contentIndex` not seen, with id `${turnId}:${message}:${contentIndex}`; send each delta to its block's part; open a tool row on `toolcall_start`.
- `UPDATE: packages/agent-pi/src/types.ts:110-112` - a map from message and block to part id replaces the two fields.
- `UPDATE: packages/agent-pi/src/replay.ts:121-151` - no seed part; raise `message_start` per assistant entry and each block's deltas with its real index.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the two cases that assert one reasoning part and merged text change, and the case below is added.

## Steps

1. Change the mapping and the turn start together, then replay.
2. Check every consumer of a pi turn's parts, `transcript.ts` included, still reads them.

## Validation

- A case: thinking, tool call, thinking, text in one turn, both as one assistant message with four blocks and as two messages, gives `[reasoning THINK-1, tool c1, reasoning THINK-2, markdown REPLY]` live; today it gives `[markdown REPLY, reasoning THINK-1THINK-2, c1]`, so it fails first.
- The same entries through `replayEntries` give the same parts and ids as live.
- By hand, for Softov: a pi turn that thinks, asks and thinks again shows its blocks in order in ahpapp, before and after a reload.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

A pi turn starts with no part; `mapping.ts` counts assistant messages on `message_start` (`PiTurn.messages`) and opens a `reasoning` or `markdown` part on `thinking_start`, `text_start` or the first delta of an unseen `contentIndex`, with id `${turnId}:${message}:${contentIndex}` kept in `PiTurn.blocks`.
Each delta goes to its block's part, as `chat/reasoning` or `chat/delta`, and the part is announced once as a copy.
A tool row opens at the model's `toolcall_start`, where every pi-ai provider already has the call id and name, or at `toolcall_delta`/`toolcall_end` for a provider that streams the id later, and `tool_execution_start` opens it only when none of those did; `chat/toolCallStart` goes out once either way.
`replay.ts` raises `message_start` per assistant entry and each block's start and delta with its real index, and a tool call's `toolcall_start` before its execution start and ready, so a replayed turn has the live parts and ids.
Thinking, tool, thinking, text now gives `[t1:1:0 reasoning THINK-1, c1, t1:1:2 reasoning THINK-2, t1:1:3 markdown REPLY]` from one message and `[t1:1:0, c1, t1:2:0, t1:2:1]` from two, live and replayed.
`session.ts` `finish` marks a row still `streaming` as `cancelled` with reason `skipped`, as the protocol reducer does, because a call the model was writing when the turn stopped is now in the snapshot and pi never runs it.
Tests in `packages/agent-pi/test/agent-pi.test.ts`, all failed first: the new order case in both shapes with replay parity, a row opened at `toolcall_start` and started once, a thought per block, a turn that starts with no part, and a streaming row skipped on cancel; the two single-part cases and the disk rebuild case were changed to the per-block ids.
The by-hand check in ahpapp before and after a reload is left for Softov.
Gates: `pnpm typecheck` and `pnpm boundary` clean, `pnpm test` 107 files and 1521 tests passed.
