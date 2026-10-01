---
title: A row line is never cut JSON
status: implemented
depends: [task-01-tool-input-is-the-whole-input.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/input.ts#L18-L24](../../../../packages/agent-claude/src/input.ts#L18-L24) - `summarize`, whose fallback is 400 characters of JSON"
  - "[code://packages/agent-claude/src/session.ts#L1621](../../../../packages/agent-claude/src/session.ts#L1621) - live `invocationMessage`"
  - "[code://packages/agent-claude/src/transcript.ts#L347](../../../../packages/agent-claude/src/transcript.ts#L347) - replayed `invocationMessage`"
---

## Objective

`summarize` answers a subject for AskUserQuestion (its first question's text), WebFetch (`url`), WebSearch (`query`) and an MCP tool (its first string argument), and nothing for any other tool without a summary, so the row reads the display name; its JSON fallback is gone, live and replayed.

## Files

- `UPDATE: packages/agent-claude/src/input.ts` - the subjects, and no JSON fallback.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts` - the cases below.
- `UPDATE: packages/sdk/test/fixtures/wire.jsonl` if a recorded call changes.

## Steps

1. Tests first: AskUserQuestion's row is its first question; WebFetch's is the url; an MCP tool's is its first string argument; a tool with only numbers gives no subject and the row is the display name; nothing produces `{` JSON; a replayed call reads the same as live.
2. Implement.

## Validation

- The new cases fail first and pass after.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume

Implemented 2026-09-30.
`summarize` in `packages/agent-claude/src/input.ts` answers AskUserQuestion's first question's text, WebFetch's `url`, WebSearch's `query` and an `mcp__` tool's first string argument in key order; any other tool without a summary answers nothing, so `invocationMessage` and a restored call's `pastTenseMessage` fall back to the display name, live and replayed. The 400-character JSON fallback is gone. `busyWith`, the session's status line, reads the same summary.
`packages/agent-claude/test/agent-claude-tool-input.test.ts` adds two cases, live (snapshot and ready action) and restored, over AskUserQuestion, WebFetch, WebSearch, an MCP tool whose first key is a number and whose first string is the subject, an MCP tool with only numbers, and a long TodoWrite, each checked against its row line and against a leading `{`. The task 01 cases now use TodoWrite for the long input, since WebSearch has a subject now, and expect its display name as the row line.
What failed first: the four cases expecting a row line, each reading the cut JSON; Bash's case passed.
What the plan did not know: no recorded call in `packages/sdk/test/fixtures/wire.jsonl` changed, as its one call is a Read.
Gates: `pnpm typecheck`, `pnpm boundary` and the full `pnpm test` exit 0 (121 files, 1755 tests).
