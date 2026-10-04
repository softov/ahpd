---
title: pi tool calls carry their start and end, live and restored
status: done
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/mapping.ts#L251](../../../../packages/agent-pi/src/mapping.ts#L251) - `mapEvent(turn, event)`, which gains the time"
  - "[code://packages/agent-pi/src/mapping.ts#L87-L104](../../../../packages/agent-pi/src/mapping.ts#L87-L104) - `startCall`, which sends nothing for a call the model's stream opened already"
  - "[code://packages/agent-pi/src/mapping.ts#L327-L332](../../../../packages/agent-pi/src/mapping.ts#L327-L332) - `tool_execution_start`, with no time kept"
  - "[code://packages/agent-pi/src/mapping.ts#L348-L395](../../../../packages/agent-pi/src/mapping.ts#L348-L395) - `tool_execution_end`, with no time kept and no `_meta` on its `chat/toolCallComplete`"
  - "[code://packages/agent-pi/src/session.ts#L390-L416](../../../../packages/agent-pi/src/session.ts#L390-L416) - the `tool_call` hook's `ready`, which readies a call `not-needed` or asks about it, after `tool_execution_start`"
  - "[code://packages/agent-pi/src/session.ts#L1110-L1116](../../../../packages/agent-pi/src/session.ts#L1110-L1116) - `chat/toolCallConfirmed`, a person's answer"
  - "[code://packages/agent-pi/src/session.ts#L237-L252](../../../../packages/agent-pi/src/session.ts#L237-L252) - `releasePending`, a question cancelled as denied"
  - "[code://packages/agent-pi/src/session.ts#L880-L921](../../../../packages/agent-pi/src/session.ts#L880-L921) - `runCommand`, the shell call a person's own command runs"
  - "[code://packages/agent-pi/src/replay.ts#L62](../../../../packages/agent-pi/src/replay.ts#L62) - `raise`, how replay feeds `mapEvent`, discarding the actions"
  - "[code://packages/agent-pi/src/replay.ts#L111-L183](../../../../packages/agent-pi/src/replay.ts#L111-L183) - entry times (`entry.timestamp`) used only for the turn; tool events raised at 161 and 173"
---

## Objective

Live, the plugin stamps `Date.now()` when pi starts a call and when it ends one, and an asked call's start moves to its approval.
Restored, the entry times reach the replayed events so the live mapping stamps both paths the same way.

## Files

- `UPDATE: packages/agent-pi/src/mapping.ts:251` - `mapEvent(turn, event, at?: number)`; the time is `at ?? Date.now()`.
- `UPDATE: packages/agent-pi/src/mapping.ts:327-332` - `tool_execution_start` writes the start onto the held row's `_meta`, and sends it on `chat/toolCallStart` when it opens the row.
- `UPDATE: packages/agent-pi/src/mapping.ts:348-395` - `tool_execution_end` writes the end onto the held row unless it is `cancelled`, and its `chat/toolCallComplete` (and the ready before it, for an unreadied call) carries the row's `_meta`.
- `UPDATE: packages/agent-pi/src/session.ts:390-401` - the hook's `ready` sends the row's `_meta`.
- `UPDATE: packages/agent-pi/src/session.ts:1110-1116` - an approved `chat/toolCallConfirmed` stamps the start again and sends `_meta`; a denied one takes the times off and sends `_meta`.
- `UPDATE: packages/agent-pi/src/session.ts:237-252` - `releasePending` takes the times off a cancelled call, as a denial does.
- `UPDATE: packages/agent-pi/src/session.ts:880-921` - the shell call is stamped at its ready and its complete.
- `UPDATE: packages/agent-pi/src/session.ts:547` - the live caller passes no `at`.
- `UPDATE: packages/agent-pi/src/replay.ts:62` - `raise(turn, event, at?)` passes the entry's `timestamp` (as epoch milliseconds) for the tool events at lines 161 and 173.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the cases below.

## Steps

1. Failing first: the cases under Validation.
2. Stamp through the sdk helper from p1 (`callTimes`, `withCallTimes`, `startOf` from `@ahpd/sdk`); the keys are `ahpd.startedAt`, `ahpd.endedAt` and `ahpd.durationMs`.
3. Add the `at` parameter to `mapEvent`; the live caller passes nothing.
4. The start is written on the held row, not only on an action: replay keeps the rows and drops the actions `raise` returns.
5. An asked call is stamped again when it is approved, so the wait for a person is not counted; a denied or released call loses its times.
6. In replay, pass the time of the entry that carried the call to `tool_execution_start`, and of the entry that carried its result to `tool_execution_end`.

## Validation

- A live call readied `not-needed` carries the three `ahpd.` keys on its ready and its complete, whether the model's stream or `tool_execution_start` opened it.
- An approved call's `ahpd.startedAt` is the approval's time; a denied one has none.
- The shell call has all three.
- A replayed call carries the three keys; its start and end are its entries' times, not the replay's.
- No action or snapshot carries a bare `startedAt`, `endedAt` or `durationMs` in a tool call's `_meta`.
- `pnpm typecheck`, `pnpm boundary`, full `pnpm test`.

## Resume
