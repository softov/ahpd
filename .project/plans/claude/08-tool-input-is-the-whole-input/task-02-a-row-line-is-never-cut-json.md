---
title: A row line is never cut JSON
status: done
depends: [task-01-tool-input-is-the-whole-input.md]
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/input.ts#L23-L36](../../../../packages/agent-claude/src/input.ts#L23-L36) - `summarize`, whose fallback is 400 characters of JSON"
  - "[code://packages/agent-claude/src/session.ts#L1812](../../../../packages/agent-claude/src/session.ts#L1812) - live `invocationMessage`"
  - "[code://packages/agent-claude/src/transcript.ts#L361](../../../../packages/agent-claude/src/transcript.ts#L361) - replayed `invocationMessage`"
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
