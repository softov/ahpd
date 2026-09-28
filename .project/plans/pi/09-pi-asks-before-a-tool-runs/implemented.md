---
title: pi asks a person before a tool runs - implemented
date: 2026-09-28
refs:
  - git://1d00d3f
  - "[code://packages/agent-pi/src/session.ts](../../../../packages/agent-pi/src/session.ts) - `pending`, `decide`, `askBefore`, `confirm`, `releasePending` and `inputNeeded` in the state"
  - "[code://packages/agent-pi/src/backend.ts](../../../../packages/agent-pi/src/backend.ts) - the inline extension whose `tool_call` handler asks"
  - "[code://packages/agent-pi/src/types.ts](../../../../packages/agent-pi/src/types.ts) - `PERMISSION_MODES` and `permissionModeProperty()`"
---

A pi session asks a person before a tool runs, as a Claude session does, under the same six-value `permissionMode`, and runs or blocks the call on the answer.

## What was built

- [`code://packages/agent-pi/src/backend.ts`](../../../../packages/agent-pi/src/backend.ts) - a hidden inline pi extension whose `tool_call` handler calls `onToolCall`, loaded whatever the project trust says.
- [`code://packages/agent-pi/src/session.ts`](../../../../packages/agent-pi/src/session.ts) - `decide` runs, asks or refuses by mode, judging pi's `edit`, `write` and `bash` by name, a host tool by its `effects` (none means it runs), and a path after pi's own resolution and symlinks; `askBefore` moves the row pi opened to `pending-confirmation`; `confirm` answers with `chat/toolCallConfirmed`; a cancel answers every waiting question with "The turn was stopped"; `sessionState` carries `inputNeeded` while a question waits.
- [`code://packages/agent-pi/src/mapping.ts`](../../../../packages/agent-pi/src/mapping.ts) - `tool_execution_start` opens the row only, and `tool_execution_end` readies a call pi failed before its hook.
- [`code://packages/agent-pi/src/types.ts`](../../../../packages/agent-pi/src/types.ts) - the six modes and the one control definition `agent.ts` and `session.ts` use.
- [`code://packages/agent-pi/README.md`](../../../../packages/agent-pi/README.md) - tool confirmation under what maps.

## Verified

- `packages/agent-pi/test/agent-pi.test.ts` drives `tool_execution_start` and the real hook through `driveCall` for every mode, approve, decline, two calls at once, cancel, client tools, paths outside the workspace and a late client reading `inputNeeded`; the fix cases failed first.
- A scripted wire capture passed `pnpm wire`: 146 frames, 151 payloads, nothing undeclared, nothing missing.
- `pnpm test` 106 files, 1492 tests; `pnpm typecheck` and `pnpm boundary` green.
- Reviewed by Softov on 2026-09-27 (tasks 01 to 09) and 2026-09-28 (tasks 10 and 11); he confirmed in the UI that a reconnected client sees the waiting question.

## Departures from the plan

- The undeclared `session/statusChanged` and `session/modelsChanged` emits were removed (task 09), and `chat/toolCallConfirmed` with `approved: false` carries `reason: 'denied'`.
- The `Asking` test seam was removed (task 07); every case goes through the real policy.
- Tasks 04 to 11 were added in review.

## Left for later

- The wire capture used a scripted backend, because no model provider key worked on the machine; no capture of a real pi model has been validated.
