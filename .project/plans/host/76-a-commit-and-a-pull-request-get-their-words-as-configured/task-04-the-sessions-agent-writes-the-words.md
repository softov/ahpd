---
title: The session's agent writes the words
status: todo
depends: [task-02-forced-and-session-title-modes.md]
layer: sdk
refs:
  - "[code://packages/sdk/src/types/agent.ts](../../../../packages/sdk/src/types/agent.ts) - `Agent.chats.sideChat`"
---

## Objective

In agent mode, a side chat on the session asks its agent for the words with task 03's prompt.
The main conversation does not change.

## Files

- `UPDATE: packages/sdk/src/changes.ts` - `wordsFor` asks a side chat in agent mode.
- `UPDATE: packages/sdk/test/changewords.test.ts` - an agent with a side chat, and one without.

## Steps

1. Open a side chat on the session, send task 03's prompt, and read the answer.
2. Close the side chat after the answer.
3. Fall back to the session title when the agent has no side chat, and say so.

## Validation

- Tests cover an agent with a side chat and one without, and the main chat has no new turn.
- The gates pass.

## Resume
