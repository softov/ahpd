---
title: An AskUserQuestion shows each question's header, and an answer shows on every client at once with its typed text reaching the tool - implemented
date: 2026-10-09
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
  - "[code://packages/sdk/src/types/session.ts](../../../../packages/sdk/src/types/session.ts)"
  - "[code://packages/sdk/src/nested.ts](../../../../packages/sdk/src/nested.ts)"
  - "[code://packages/agent-claude/src/input.ts](../../../../packages/agent-claude/src/input.ts)"
  - "[code://packages/agent-claude/src/session/asking.ts](../../../../packages/agent-claude/src/session/asking.ts)"
---

Each AskUserQuestion question now shows under its own header. An answer shows on every client of the chat as soon as the session takes it, not when the agent next moves. Words typed beside a choice reach the tool after the choice, joined with `, `.

## What was built

- [`code://packages/sdk/src/types/session.ts`](../../../../packages/sdk/src/types/session.ts) - `Session.answer` returns true when the session was waiting on the request, and false otherwise.
- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - on true, the host dispatches the `chat/inputCompleted` back to the chat the question is in; on false it says nothing.
- [`code://packages/sdk/src/nested.ts`](../../../../packages/sdk/src/nested.ts) - the nested proxy takes an answer only for a request the inner session has open. It keeps back the inner `chat/inputCompleted`, so a worker chat gets it once.
- [`code://packages/agent-claude/src/input.ts`](../../../../packages/agent-claude/src/input.ts) - each question's `title` is its `header`; the request's `message` is the default line.
- [`code://packages/agent-claude/src/session/asking.ts`](../../../../packages/agent-claude/src/session/asking.ts) - a selection's `freeformValues` are joined after its value with `, `.
- agent-acp, agent-pi, agent-cofold and the echo and notes examples return the boolean; the notes example no longer emits `chat/inputCompleted` itself.

## Verified

- The four gates on current main: typecheck, boundary, build, and vitest with 257 files and 4486 tests passed.
- New tests in `packages/sdk/test/host-input.test.ts`, `nested-proxy.test.ts`, `subagent-chat.test.ts` and `packages/agent-claude/test/agent-claude-tool-input.test.ts`.

## Departures from the plan

- None.
