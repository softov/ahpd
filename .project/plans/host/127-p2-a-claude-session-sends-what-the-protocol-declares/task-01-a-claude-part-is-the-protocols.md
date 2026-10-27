---
title: A Claude part is the protocol's
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/test/agent-claude-tool-input.test.ts](../../../../packages/agent-claude/test/agent-claude-tool-input.test.ts) - the cases for a tool call, live and restored"
  - "[code://packages/sdk/test/host-turn.test.ts](../../../../packages/sdk/test/host-turn.test.ts) - the cases for a Claude session through the host"
  - "[code://packages/sdk/test/wire.test.ts](../../../../packages/sdk/test/wire.test.ts) - the capture that the strict schema reads"
---

## Objective

Every tool call part of a Claude session holds `kind` and `toolCall`, however its call arrived.
A compaction notice holds `kind` and `content`.
The wire suite reads the chat after its turn, so the strict schema reads the parts a late client reads.

## Files

- `UPDATE: packages/agent-claude/src/session/stream.ts:221` - the part of a streamed call has no `id`.
- `UPDATE: packages/agent-claude/src/session/stream.ts:405` - the part of a call in an assistant message has no `id`.
- `UPDATE: packages/agent-claude/src/session/asking.ts:404` - the part of a call asked about first has no `id`.
- `UPDATE: packages/agent-claude/src/session/turns.ts:369` - the part of a shell command has no `id`.
- `UPDATE: packages/agent-claude/src/transcript.ts:424` - the part of a restored call has no `id`.
- `UPDATE: packages/agent-claude/src/session/query.ts:652-656` - the compaction notice has no `id`.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts` - a case that reaches the five places of a tool call part.
- `UPDATE: packages/sdk/test/host-turn.test.ts` - a case through the host, and the compaction case checks its frames.
- `UPDATE: packages/sdk/test/wire.test.ts:248` - the census lists `toolKind` on the call in a snapshot.
- `UPDATE: packages/sdk/test/wire.test.ts:449-452` - the suite asks for the chat again after its turn.

## Steps

1. Make the wire suite ask for the chat again after its turn.
2. Remove `id` from the five literals that make a tool call part, and from the compaction notice.
3. Add `toolKind` on the call in a snapshot to the `_meta` census.
4. Add the case for the five places, with the declared keys as the expected value.
5. Add the case through the host, and check the frames of the compaction case.

## Validation

- Test that each tool call part holds `kind` and `toolCall` only, for whole, streamed, first-asked, shell and restored calls.
- Test through the host that the protocol declares every frame, and that the late calls equal the replayed calls.
- Run the cases and the wire suite on the session before this change, and see them fail.

## Resume

