---
title: A wait leaves the activity as it was - implemented
date: 2026-11-05
refs:
  - git://4d703f16 - the merge of #216
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - pi says no activity when a confirmation waits"
---

A session that waits on the person says so once, by its status. No agent changes its activity when a confirmation or a question waits, as in VS Code.

## What was built

- [`code://packages/agent-claude/src/session/asking.ts`](../../../../packages/agent-claude/src/session/asking.ts) - Claude says no wait text.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - pi says no wait text.
- [`code://packages/agent-acp/src/session/handlers.ts`](../../../../packages/agent-acp/src/session/handlers.ts) - ACP says no wait text.
- [`code://packages/agent-cofold/src/runs.ts`](../../../../packages/agent-cofold/src/runs.ts) - cofold sets no activity after a replay.

## Verified

- Each of the four agents has a case that reads the activity while a confirmation waits.
- CI on main after #242 passed every check.

## Departures from the plan

- Task 02, cofold names its running tool, is dropped. The merge of #241 keeps the activity for a wait before a turn only, as [the decision](../../../decisions/a-chat-activity-is-only-a-wait-before-its-turn.md) says.

## Left for later

- none
