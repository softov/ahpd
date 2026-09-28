---
title: The ask reuses the row pi already opened, and a client tool runs only after it is approved
status: done
depends: [task-01-a-call-can-wait-on-a-person.md]
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/session.ts#L316-L361](../../../../packages/agent-pi/src/session.ts#L316-L361) - `askBefore`, which opens a second row for a call pi has already started"
  - "[code://packages/agent-pi/src/mapping.ts#L127-L171](../../../../packages/agent-pi/src/mapping.ts#L127-L171) - `tool_execution_start`, which readies every call `not-needed`, and the `asked` guard that never fires"
  - "[code://packages/agent-claude/src/session.ts#L1709-L1858](../../../../packages/agent-claude/src/session.ts#L1709-L1858) - `canUseTool`: one call whichever of the two events comes first"
  - npm://@earendil-works/pi-agent-core@0.87.1 - `agent-loop.js`: `tool_execution_start` is emitted before `prepareToolCall` calls `beforeToolCall`
---

## Objective

An asked call is one row, opened by pi's `tool_execution_start` and moved to `pending-confirmation` by the `tool_call` hook, with its `contributor` when a client owns it; a client-owned call is not sent to its client until it is approved; a declined call reads the same live and after a reconnect.

## Files

- `UPDATE: packages/agent-pi/src/mapping.ts:127-171` - `tool_execution_start` opens the row and does not ready it until the hook has decided.
- `UPDATE: packages/agent-pi/src/session.ts:316-361` - `askBefore` moves the existing row and never opens a second one.
- `UPDATE: packages/agent-pi/test/agent-pi.test.ts` - the cases below, driven in pi's real order.

## Steps

1. At `tool_execution_start`, open the row and hold its ready until the hook answers: the hook always runs for a call pi executes, so the ready comes from the hook, `not-needed` when nothing asks and `pending-confirmation` with a `confirmationTitle` when something does.
2. A client-owned call carries `contributor: { kind: 'client', clientId }` on its start, its ready and its row, as agent-claude's does.
3. A declined call stays `cancelled`: the `tool_execution_end` pi sends for a blocked call does not overwrite it in the snapshot.
4. Remove the `asked` field from `PiCall` if nothing needs it after this.

## Validation

- `packages/agent-pi/test/agent-pi.test.ts`: a scripted run that sends `tool_execution_start` and then calls the hook, as pi does, produces one `chat/toolCallStart` and one ready, with `pending-confirmation` when the mode asks.
- Today it produces two starts and a `not-needed` ready before the question.
- A client-owned tool in a mode that asks: nothing marks it ready for the client before `confirm(true)`, and after it the client's `completeToolCall` settles it.
- A declined call: the live reducer's state and `chatState()` both show the call `cancelled`.
- `node_modules/.bin/vitest run packages/agent-pi` green.

## Resume

Built.
`mapping.ts`'s `tool_execution_start` opens the row and emits only `chat/toolCallStart`, because pi raises that event before its `tool_call` hook.
`session.ts`'s `askBefore` moves the row that start opened and is the only source of `chat/toolCallReady`: `not-needed` when the call runs or is refused, `pending-confirmation` with a `confirmationTitle` when a person is asked, each carrying `contributor` for a client-owned tool.
A declined call keeps `cancelled` through the failed `tool_execution_end` pi sends for the block, in the snapshot and for a client.
`PiCall.asked` is gone.

- Failed first: with the pre-fix bodies restored, `opens one row for an asked call` saw two `chat/toolCallStart`, `does not send a client tool to its client` found no `contributor` on the ready, and `keeps a declined call cancelled` read `completed` instead of `cancelled`.
- The cases drive `tool_execution_start` and then the hook, through the new `driveCall` helper.
- `node_modules/.bin/vitest run packages/agent-pi` green, 76 tests; `pnpm typecheck` green.
