---
title: The restored turn is a notice
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L326-L329](../../../../packages/agent-claude/src/transcript.ts#L326-L329) - the text of a user frame"
  - "[code://packages/agent-claude/src/transcript.ts#L436-L443](../../../../packages/agent-claude/src/transcript.ts#L436-L443) - the turn a user frame opens"
---

## Objective

A user frame that the CLI saved with `origin.kind` `task-notification` restores as a notice turn.
Its message has origin `systemNotification`, and the text of the frame's `<summary>` element.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts:436-443` - a frame with origin `task-notification` opens a turn with a `systemNotification` message.
- `UPDATE: packages/agent-claude/test/agent-claude-transcript.test.ts` - a case for the frame, and one for a frame without `<summary>`.

## Steps

1. Read `frame.origin.kind` for each user frame that opens a turn.
2. For `task-notification`, take the text between `<summary>` and `</summary>`, trimmed.
3. Use the full frame text when the frame has no `<summary>`.
4. Open the turn with that text and origin `systemNotification`.
5. Keep every other user frame as it is today.
6. Add a case with a frame as the CLI saves it, with `producer` `session-task` and a `<task-notification>` text.
7. Assert one turn with origin `systemNotification` and the summary as its text.
8. Add a case for a frame without `<summary>`.

## Validation

- `packages/agent-claude/test/agent-claude-transcript.test.ts` holds both cases, and every case passes.
- `pnpm build`, `pnpm typecheck` and `pnpm boundary` pass, and the agent-claude tests pass.

## Resume

