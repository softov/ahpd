---
title: The ACP bridge opens a part per run of chunks, in the order they arrived
status: implemented
depends: []
layer: "agent-acp"
refs:
  - "[code://packages/agent-acp/src/session.ts#L588](../../../../packages/agent-acp/src/session.ts#L588) - the text part opened at turn start"
  - "[code://packages/agent-acp/src/mapping.ts#L87-L110](../../../../packages/agent-acp/src/mapping.ts#L87-L110) - message and thought chunks, each into one part per turn"
  - "[code://packages/agent-acp/src/transcript.ts#L42-L43](../../../../packages/agent-acp/src/transcript.ts#L42-L43) - the watched record seeds the same text part"
  - "[code://packages/agent-pi/src/mapping.ts](../../../../packages/agent-pi/src/mapping.ts) - `blockOf`, the sibling's part per block"
---

## Objective

An ACP turn that thinks, calls a tool, thinks again and replies shows its parts in that order, each thought its own part.

## Files

- `UPDATE: packages/agent-acp/src/session.ts:588` - a turn starts with no part.
- `UPDATE: packages/agent-acp/src/mapping.ts:87-110` - ACP chunks carry no block index, so a new part opens when a chunk's kind differs from the last part's kind or a tool call came between; consecutive chunks of one kind append to the open part.
- `UPDATE: packages/agent-acp/src/transcript.ts:42-43` - the watched record starts with no part.
- `UPDATE: packages/agent-acp/test/` - the case below, and the cases that assume a `:text` part.

## Steps

1. Keep the part ids stable within a turn, numbered by their order in it.

## Validation

- A case with the fixture server: thought, tool call, thought, message chunks in one turn give `[reasoning, tool, reasoning, markdown]` in that order; today the text part comes first and the thoughts merge, so it fails first.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

An ACP turn starts with no part: `session.ts` `openTurn` no longer opens or announces a `${turnId}:text` part, and `transcript.ts` replays each watched turn from an empty part list.
`mapping.ts` `runOf` appends a chunk to the turn's last part when that part has the chunk's kind, and otherwise opens a `markdown` or `reasoning` part with id `${turnId}:${position}`, its index in the turn's parts, announced once with `chat/responsePart` as a copy.
A tool call pushes its row into the same list, so a chunk after a tool call opens a new part; this holds for rows the permission path in `session.ts` pushes too.
`AcpTurn` loses `textPartId` and `reasoningPartId`, which nothing outside `agent-acp` read.
Thinking, tool, thinking in two chunks, text in two chunks was `[t1:text markdown "the answer", t1:reasoning "first thoughtsecond thought", call-2]` and is now `[t1:0 reasoning "first thought", call-2, t1:2 reasoning "second thought", t1:3 markdown "the answer"]`, live and in the transcript with the same ids.
The fixture server gained a `ponder` script for that turn; `agent-acp-turn.test.ts` checks the live snapshot order, one announcement per part before its first chunk and each chunk's part id, and `agent-acp-catalog.test.ts` checks the transcript order and ids match the live turn; both failed first.
No existing test assumed a `:text` id; the ones reading `responseParts[0]` still pass because their turns begin with a message chunk.
Replay of a loaded session still lands in the running turn until acp/02 is built, and goes through the same mapping, so it gets the same order.
Gates: `pnpm typecheck` and `pnpm boundary` clean, `pnpm test` 107 files and 1519 tests passed; two earlier full runs each had one unrelated flake (a cofold tools timeout, then the known `agent-acp-ports` case), both passed alone.
