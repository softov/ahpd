---
title: An exchange's rounds are one turn, with the exchange's usage
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L259-L361](../../../../packages/agent-claude/src/transcript.ts#L259-L361) - the assistant branch of `buildTurns`"
  - "[code://packages/agent-claude/src/transcript.ts#L270-L280](../../../../packages/agent-claude/src/transcript.ts#L270-L280) - one frame's usage"
  - "[code://packages/agent-claude/test/agent-claude-subagent-restore.test.ts#L88-L101](../../../../packages/agent-claude/test/agent-claude-subagent-restore.test.ts#L88-L101) - the three-round main transcript"
---

## Objective

`buildTurns` gives one turn per real prompt holding every assistant frame up to the next prompt, and that turn's usage sums each distinct `message.id` once.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts:259-361` - append an assistant frame's parts to the last turn when there is one; open an agent-origin turn only when there is none.
- `UPDATE: packages/agent-claude/src/transcript.ts:270-280` - keep usage per `message.id` on the turn, the last frame of an id winning, and set the turn's usage to the sum over its ids.
- `CREATE: packages/agent-claude/test/agent-claude-transcript.test.ts` - the cases below.

## Steps

1. Part ids stay `block.id ?? ${frame.uuid}:${index}`.
2. A frame without `message.id` counts on its own.

## Validation

- u1, a1 (tool_use), u2 (tool_result), a2 (tool_use), u3 (tool_result), a3 (text) gives one turn with both calls completed and the text last; it fails first with three turns.
- Three frames sharing one `message.id` with `output_tokens: 4` count 4; two ids with 4 and 6 count 10.
- A worker transcript that starts with an assistant frame gives one agent-origin turn.
- `agent-claude-subagent-restore.test.ts` still passes, its main-transcript expectations updated to one turn.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

- **Done:** `buildTurns` appends every assistant frame's parts to the last turn, and opens an agent-origin turn only when there is none yet.
- A turn keeps its usage per `message.id` in a map beside the builder (`spentBy`), the last frame of an id winning, and the turn's usage is `summed` over its ids: token counts added, the last model named.
- A frame with no `message.id` is keyed on its own.
- An assistant frame with no parts still adds its usage to the current turn; it opens no turn when there is none.
- **Tests:** `packages/agent-claude/test/agent-claude-transcript.test.ts` (new): "reads a prompt and every round that answered it as one turn", "counts one message's usage once however many frames repeat it", "sums the usage of an exchange's distinct messages", "counts a frame with no message id on its own", "opens an agent turn for a transcript that starts with the agent", "starts a new turn at the next prompt".
- `agent-claude-subagent-restore.test.ts` had no explicit main-transcript turn count; "lists a restored session's worker chats and serves each one read-only" now asserts the three-round main transcript is one turn.
- **Failed first:** five of the six new cases failed with 3 or 2 turns where 1 was expected, because every assistant frame after a tool result, or after a turn that already had parts, opened an agent turn of its own. "starts a new turn at the next prompt" passed before and after.
- **Departures:** none.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 1534 passed, 1 failed of 1535 in 108 files. The failure was `agent-cofold-tools.test.ts` "sends a declined edit its after before the next ask" timing out in its `when` wait under full-suite load; the file alone passed 27 of 27. The next full run (after task 02) was 1539 of 1539.
