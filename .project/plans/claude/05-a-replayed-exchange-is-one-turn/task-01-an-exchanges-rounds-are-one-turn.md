---
title: An exchange's rounds are one turn, with the exchange's usage
status: todo
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
