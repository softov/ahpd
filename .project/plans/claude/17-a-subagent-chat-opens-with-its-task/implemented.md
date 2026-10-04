---
title: A Claude subagent chat opens with its task's description as title and its prompt as the first message - implemented
date: 2026-10-04
refs:
  - git://7a02145
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts)"
  - "[code://packages/agent-claude/src/input.ts](../../../../packages/agent-claude/src/input.ts)"
---

A worker chat waits for the call that spawned it, so it opens titled with the task's description and with the prompt as its first message, live and after a restart.

## What was built

- [`code://packages/agent-claude/src/input.ts`](../../../../packages/agent-claude/src/input.ts) - `titleOf`, the description cut to 60 characters, else the agent type, else `Subagent`, used live and restored.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - a worker frame with no spawn record yet is held whole; the record, the call's result or a 5 second `SPAWN_GRACE` releases it, and `cancel` releases and ends any worker still held.
- [`code://packages/agent-claude/src/transcript.ts`](../../../../packages/agent-claude/src/transcript.ts) - restored workers take the same title.

## Verified

- `agent-claude-subagent.test.ts` covers a worker frame ahead of its `tool_use`, a record from `canUseTool` only, no record with the result as fallback, `titleOf`, and a held worker cancelled with its turn; the restore test covers a worker with only `agentType`.
- `pnpm exec tsc --noEmit`, `pnpm boundary`, `pnpm test` (180 files, 2797 tests) pass on `main` at `7a02145`.

## Departures from the plan

- The release on the call's result sits before the result's part lookup, because a call whose `tool_use` never arrived has no part.
- `agent-claude-usage.test.ts` gained the spawning `tool_use` its worker frames had been missing.
- Seven title assertions moved from the agent type to the task description.

## Left for later

- The two by-hand checks, a live build session's worker tabs and the same after a restart, were checked against captures only.
- The tasks stay `implemented` until Softov reviews them.
