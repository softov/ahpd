---
title: A CLI echo or a compact summary opens no turn
status: implemented
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

- **Done:** the user branch of `buildTurns` skips a frame with `isCompactSummary: true`, or whose content (a string, or the first text block) starts with one of the CLI echo tags `command-name`, `command-message`, `command-args`, `local-command-stdout`, `local-command-stderr`, `local-command-caveat` (`CLI_ECHO`, `isCliEcho` in `transcript.ts`).
- The marker list is the reference's `CLI_ECHO_MARKER_PATTERN` at 832cf23c588, read from a local checkout.
- Tool results in a skipped frame are still paired to their calls, since the skip comes after that loop.
- The SDK's `getSessionMessages` keeps `isCompactSummary: true` on the message it returns, and the raw worker transcripts carry the same field, so one check covers both readers.
- **Tests:** in `agent-claude-transcript.test.ts`: "reads a CLI echo between two rounds as no prompt", "reads every CLI echo marker as no prompt, in a string or a text block", "reads a prompt that only mentions a marker as a prompt", "reads a compact summary as no prompt".
- **Failed first:** the echo case gave 2 turns, the all-markers case 6, and the compact summary case 2, each frame opening a prompt turn. The mention case passed before and after.
- **Departures:** none.
- **Gates:** `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 1539 passed of 1539 in 108 files.
