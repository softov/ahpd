---
title: A row reads the call's description, or VS Code's line when it has none
status: done
depends: [task-02-a-row-line-is-never-cut-json.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/input.ts#L23-L36](../../../../packages/agent-claude/src/input.ts#L23-L36) - `summarize`, the row's subject today"
  - "[code://packages/agent-claude/src/session.ts#L1812](../../../../packages/agent-claude/src/session.ts#L1812) - live `invocationMessage`"
  - "[code://packages/agent-claude/src/session.ts#L1928](../../../../packages/agent-claude/src/session.ts#L1928) - live `pastTenseMessage`"
  - "[code://packages/agent-claude/src/transcript.ts#L364](../../../../packages/agent-claude/src/transcript.ts#L364) - replayed `pastTenseMessage`"
  - "[code://packages/agent-claude/src/transcript.ts#L361-L364](../../../../packages/agent-claude/src/transcript.ts#L361-L364) - replayed `invocationMessage` and `pastTenseMessage`"
  - "git://ac05bdfe1e1 - VS Code `src/vs/platform/agentHost/node/claude/claudeToolDisplay.ts`: `getClaudeInvocationMessage` and `getClaudePastTenseMessage`, the lines this task mirrors"
---

## Objective

A Claude tool call's `invocationMessage` and `pastTenseMessage`, and a confirmation card's `invocationMessage`, are the call's `description` when it is Bash, Task, Agent or Monitor and its input carries one, such as Bash's "Check scratch directory".
Without one, a tool VS Code maps reads VS Code's line, such as markdown ``Running `ls -la` `` and ``Ran `ls -la` ``: the command's first line, cut to 80 characters with `…`, as inline code with a fence longer than any backtick run in it.
Any other tool reads task 02's display name plus a subject.
`toolInput` is unchanged, the whole input, so a client can format it itself.
A failed call reads the same line; its failure is `success: false`.
Live and replayed calls read the same, and a past tense is computed from the input, never read back from a markdown `invocationMessage`.

## Files

- `UPDATE: packages/agent-claude/src/input.ts` - the row line and its past tense: description, then VS Code's per-tool lines, then `summarize`.
- `UPDATE: packages/agent-claude/src/session.ts` - live `invocationMessage` and `pastTenseMessage` from it, and the confirmation card's in `canUseTool`.
- `UPDATE: packages/agent-claude/src/transcript.ts` - replayed ones from it.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts` - the cases below.

## Steps

1. Read VS Code's `getClaudeInvocationMessage`, `getClaudePastTenseMessage`, `firstShellLine`, `truncate` and `appendEscapedMarkdownInlineCode` at `ac05bdfe1e1`, and mirror every tool they map with the same English lines, sent as markdown where VS Code sends markdown.
2. Tests first: Bash with a description reads it, live and replayed, both messages; Bash without one reads ``Running `<first line>` `` and ``Ran `<first line>` ``; a multi-line command shows its first line only; a line over 80 characters is cut with `…`; a command holding backticks gets a longer fence; Grep, WebFetch, Skill, Task and a TaskUpdate read VS Code's lines; an MCP tool with no description keeps task 02's name plus subject; `toolInput` is unchanged in every case.
3. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
- By hand in ahpapp: the Bash row from the screenshot of 2026-09-30 reads "Check scratch directory".

## Resume
