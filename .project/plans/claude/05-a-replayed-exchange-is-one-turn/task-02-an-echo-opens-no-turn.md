---
title: A CLI echo or a compact summary opens no turn
status: todo
depends: [task-01-an-exchanges-rounds-are-one-turn.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/transcript.ts#L205-L257](../../../../packages/agent-claude/src/transcript.ts#L205-L257) - the user branch of `buildTurns`"
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L222 - `CLI_ECHO_MARKER_PATTERN`
  - https://github.com/microsoft/vscode/blob/832cf23c588/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L644-L650 - `isCliEchoContent`
---

## Objective

A user frame that is a CLI echo, or the summary the CLI writes after compacting, is skipped, so it neither shows as a prompt nor cuts an exchange in two.

## Files

- `UPDATE: packages/agent-claude/src/transcript.ts:205-257` - skip a user frame whose text is a CLI echo by the reference's markers, or which carries `isCompactSummary`.
- `UPDATE: packages/agent-claude/test/agent-claude-transcript.test.ts` - the cases below.

## Steps

1. Take the marker list from the reference at its commit and cite it in the comment by what it matches, not by where it came from.

## Validation

- A prompt, an assistant round, a `<local-command-stdout>` frame, another assistant round gives one turn; it fails first with two.
- A compact summary frame opens no turn.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume
