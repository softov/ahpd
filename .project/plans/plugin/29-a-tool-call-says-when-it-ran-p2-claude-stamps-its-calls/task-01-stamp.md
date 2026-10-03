---
title: Claude tool calls carry their start and end, live and restored
status: todo
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1830-L1845](../../../../packages/agent-claude/src/session.ts#L1830-L1845) - `chat/toolCallReady` with `confirmed: 'not-needed'`, the start of a call nobody is asked about"
  - "[code://packages/agent-claude/src/session.ts#L3636-L3643](../../../../packages/agent-claude/src/session.ts#L3636-L3643) - `chat/toolCallConfirmed`, the start of a call a person approved"
  - "[code://packages/agent-claude/src/session.ts#L1950-L1957](../../../../packages/agent-claude/src/session.ts#L1950-L1957) - `chat/toolCallComplete`, which sends `_meta` only when `progressed`"
  - "[code://packages/agent-claude/src/session.ts#L3000-L3057](../../../../packages/agent-claude/src/session.ts#L3000-L3057) - the terminal call a person's own command runs"
  - "[code://packages/agent-claude/src/transcript.ts#L204-L389](../../../../packages/agent-claude/src/transcript.ts#L204-L389) - `buildTurns`: frame timestamps give only the turn's `startedAt`; tool calls get none, turns get no `duration`"
---

## Objective

Live, a call's start is when it starts running, after any approval, on the plugin's clock, and its end is when it completes. Restored, a call takes its `tool_use` frame time as start and its `tool_result` frame time as end, and each restored turn gets its `duration`.

## Files

- `UPDATE: packages/agent-claude/src/session.ts` - the start stamp at `chat/toolCallReady` (1830-1845) and at `chat/toolCallConfirmed` (3636-3643), the end stamp at `chat/toolCallComplete` (1950-1957), and the terminal call (3000-3057).
- `UPDATE: packages/agent-claude/src/transcript.ts:204-389` - restored calls and turns.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts`, `packages/agent-claude/test/agent-claude-transcript.test.ts` - the cases below.

## Steps

1. Failing first: the cases under Validation.
2. Stamp through the sdk helper from p1.
3. Live start: a call nobody is asked about is stamped when `chat/toolCallReady` with `confirmed: 'not-needed'` is sent; a call a person approves is stamped when `chat/toolCallConfirmed` with `approved` is sent.
4. Live end: `chat/toolCallComplete` always carries `_meta` (today only when `progressed`), with the times and `toolKind`.
5. A denied call gets no times.
6. The terminal call (`session.ts:3000-3057`) is stamped at its `chat/toolCallReady` and its `chat/toolCallComplete`, which then carries `_meta` with `toolKind: 'terminal'` and the times.
7. Restored: each call takes its `tool_use` frame time as start and its `tool_result` frame time as end, and each turn gets `duration`.

## Validation

- A live call with no approval and one approved both carry the three keys; every `_meta` the plugin sends after the start (`progressMessage` and the complete included) still has them.
- A denied call has none; the terminal call has all three.
- A restored turn has `duration`.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.
