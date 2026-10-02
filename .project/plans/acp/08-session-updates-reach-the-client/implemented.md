---
title: Usage, title, plan and mode changes reach the client - implemented
date: 2026-10-02
---

`usage_update` becomes `chat/usage` with context and cost in `_meta`, and a rebuilt turn reports what the live one did; the agent's title replaces the prompt's unless a person set one; mode and option changes are one `session/configChanged` each; a plan is one `plan` tool call per turn, its content replaced on each update and completed when the turn ends.

## What was built

- `packages/agent-acp/src/mapping.ts` - usage, the plan call; `session.ts` - `configChanged`, the title, `finish` keeping usage and recording every turn; `transcript.ts`.
- `agent-acp-usage.test.ts`, the catalog and turn tests, the plan test folded through the protocol's chat reducer.

## Verified

- `pnpm exec tsc --noEmit` clean, `pnpm boundary` clean, `pnpm test` 166 files and 2488 tests, twice, after the rebase onto main.
- Read against the plan and reviewed by one reader per plan; the defects found were fixed in the same worktree before close.

## Departures from the plan

- The plan is a tool call, not a markdown part (Softov, 2026-10-02), since a 0.9 response part only appends.
- Review fixed transcript usage and found that only a session's first turn reached the transcript.
- A value set by a client is held before the request goes out, so the server's echo is not announced again.

## Left for later

- none.
