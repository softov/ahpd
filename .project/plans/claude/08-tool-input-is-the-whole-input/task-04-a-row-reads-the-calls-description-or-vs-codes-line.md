---
title: A row reads the call's description, or VS Code's line when it has none
status: implemented
depends: [task-02-a-row-line-is-never-cut-json.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/input.ts#L21-L34](../../../../packages/agent-claude/src/input.ts#L21-L34) - `summarize`, the row's subject today"
  - "[code://packages/agent-claude/src/session.ts#L1621](../../../../packages/agent-claude/src/session.ts#L1621) - live `invocationMessage`"
  - "[code://packages/agent-claude/src/session.ts#L1727-L1743](../../../../packages/agent-claude/src/session.ts#L1727-L1743) - live `pastTenseMessage`"
  - "[code://packages/agent-claude/src/transcript.ts#L246](../../../../packages/agent-claude/src/transcript.ts#L246) - replayed `pastTenseMessage`"
  - "[code://packages/agent-claude/src/transcript.ts#L347-L350](../../../../packages/agent-claude/src/transcript.ts#L347-L350) - replayed `invocationMessage` and `pastTenseMessage`"
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

Implemented 2026-09-30.
`packages/agent-claude/src/input.ts` adds `lineOf` and `pastLineOf`: the `description` of Bash, Task, Agent and Monitor; otherwise VS Code's lines from `getClaudeInvocationMessage` and `getClaudePastTenseMessage` at `ac05bdfe1e1`, as markdown where VS Code sends markdown, with its `truncate`, `appendEscapedMarkdownInlineCode`, `escapeMarkdownLinkLabel` and `URI.file` encoding hand-rolled; otherwise `summarize` or the tool's name.
`session.ts` draws the live row, the ready action and the confirmation card in `canUseTool` from `lineOf`, keeps each call's `pastLineOf` by id and completes with it, success or not. `transcript.ts` builds both lines from the input and no longer overwrites the past tense at the result.
`busyWith` stays on `summarize`.
What failed first: in `packages/agent-claude/test/agent-claude-tool-input.test.ts`, 8 of 9 cases, the three new ones (live, restored, confirmation card) and the five task 01 and 02 cases whose rows changed (TodoWrite now "Update todo list", Bash "List files", WebFetch markdown); the streaming confirmation case passed.
What the plan did not know: five cases in `packages/sdk/test/host.test.ts` asserted the old Bash lines, `ls` and the CLI's "Claude wants to run ls", and were updated, with Softov's clearance, to ``Running `ls` `` and ``Ran `ls` `` as markdown. `packages/sdk/test/wire.test.ts` rewrites `packages/sdk/test/fixtures/wire.jsonl`, whose one call, a Read, now reads ``{ markdown: 'Read [a](file:///home/softov/a)' }``; `/home/softov` is the test's fixed path, not the machine's. VS Code's streaming line for Write, Edit, MultiEdit and NotebookEdit is not mirrored, as no streaming `invocationMessage` is sent. VS Code's `getServerToolDisplay` does not apply: it covers VS Code's own server tools, which ahpd does not contribute.
Gates: `pnpm typecheck`, `pnpm boundary` and the full `pnpm test` exit 0 (121 files, 1759 tests).
