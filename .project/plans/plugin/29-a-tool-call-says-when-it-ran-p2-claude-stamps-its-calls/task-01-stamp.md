---
title: Claude tool calls carry their start and end, live and restored
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session.ts#L1830-L1845](../../../../packages/agent-claude/src/session.ts#L1830-L1845) - `chat/toolCallReady` with `confirmed: 'not-needed'`, the start of a call nobody is asked about; it sends `_meta` only for a spawning call today"
  - "[code://packages/agent-claude/src/session.ts#L2144-L2152](../../../../packages/agent-claude/src/session.ts#L2144-L2152) - the ready `canUseTool` sends for a call a person is asked about, with no `_meta`"
  - "[code://packages/agent-claude/src/session.ts#L3635-L3642](../../../../packages/agent-claude/src/session.ts#L3635-L3642) - `chat/toolCallConfirmed`, the start of a call a person approved"
  - "[code://packages/agent-claude/src/session.ts#L1950-L1956](../../../../packages/agent-claude/src/session.ts#L1950-L1956) - `chat/toolCallComplete`, which sends `_meta` only when `progressed`"
  - "[code://packages/agent-claude/src/session.ts#L3000-L3057](../../../../packages/agent-claude/src/session.ts#L3000-L3057) - the terminal call a person's own command runs"
  - "[code://packages/agent-claude/src/transcript.ts#L204-L389](../../../../packages/agent-claude/src/transcript.ts#L204-L389) - `buildTurns`: frame timestamps give only the turn's `startedAt`; tool calls get none, turns get no `duration`"
---

## Objective

Live, a call's start is when it starts running, after any approval, on the plugin's clock, and its end is when it completes.
Restored, a call takes its `tool_use` frame time as start and its `tool_result` frame time as end, and each restored turn gets its `duration`.

## Files

- `UPDATE: packages/agent-claude/src/session.ts:1830-1845` - the not-needed `chat/toolCallReady` stamps the start on the held call and always sends the call's whole `_meta`.
- `UPDATE: packages/agent-claude/src/session.ts:3635-3642` - an approved `chat/toolCallConfirmed` stamps the start again and sends `_meta`; a denied one sends `_meta` with the times taken off.
- `UPDATE: packages/agent-claude/src/session.ts:1950-1956` - `chat/toolCallComplete` stamps the end and always sends `_meta`.
- `UPDATE: packages/agent-claude/src/session.ts:3000-3057` - the terminal call.
- `UPDATE: packages/agent-claude/src/transcript.ts:204-389` - restored calls and turns.
- `UPDATE: packages/agent-claude/test/agent-claude-tool-input.test.ts`, `packages/agent-claude/test/agent-claude-transcript.test.ts` - the cases below.

## Steps

1. Failing first: the cases under Validation.
2. Stamp through the sdk helper from p1 (`callTimes`, `withCallTimes`, `startOf` from `@ahpd/sdk`); the keys are `ahpd.startedAt`, `ahpd.endedAt` and `ahpd.durationMs`.
3. Live start: write the start onto the held call's `_meta` with `Date.now()` and send that whole `_meta` on the action, when `chat/toolCallReady` with `confirmed: 'not-needed'` is sent (`session.ts:1830`), or when `chat/toolCallConfirmed` with `approved` is sent (`session.ts:3635`).
4. A call that `canUseTool` asks about after its not-needed ready already stamped it is stamped again at approval, so the wait for a person is not counted.
5. Live end: `chat/toolCallComplete` always carries `_meta` (today only when `progressed`), with `toolKind`, the start, and the end and `ahpd.durationMs` from `startOf` of the held call.
6. A denied call gets no times: the denied `chat/toolCallConfirmed` sends the held `_meta` with the three keys taken off, and its completion, if any, sends none.
7. The terminal call (`session.ts:3000-3057`) is stamped at its `chat/toolCallReady` and its `chat/toolCallComplete`, which then carries `_meta` with `toolKind: 'terminal'` and the times.
8. Restored: each call takes its `tool_use` frame time as start and its `tool_result` frame time as end, and each turn gets `duration`, its last frame's time minus its `startedAt`.

## Validation

- A live call with no approval and one approved both carry the three `ahpd.` keys; every `_meta` the plugin sends after the start (`progressMessage` and the complete included) still has them.
- An approved call's `ahpd.startedAt` is the approval's time, not the earlier ready's.
- A denied call has none; the terminal call has all three.
- A restored call has all three from its frames; a restored turn has `duration`.
- No action or snapshot carries a bare `startedAt`, `endedAt` or `durationMs` in a tool call's `_meta`.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
