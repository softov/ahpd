---
title: A call can wait on a person
status: todo
depends: []
layer: "agent-pi"
refs:
  - "[code://packages/agent-pi/src/backend.ts#L83-L96](../../../../packages/agent-pi/src/backend.ts#L83-L96) - `openPi`, where the inline extension is passed"
  - "[code://packages/agent-pi/src/session.ts#L557-L563](../../../../packages/agent-pi/src/session.ts#L557-L563) - `confirm`, which becomes real"
  - "[code://packages/agent-pi/src/mapping.ts#L129-L150](../../../../packages/agent-pi/src/mapping.ts#L129-L150) - `tool_execution_start`, which must not ready an asked call again"
  - "[code://packages/agent-claude/src/session.ts#L1709-L1858](../../../../packages/agent-claude/src/session.ts#L1709-L1858) - `canUseTool`, the asking to copy"
  - "[code://packages/agent-claude/src/session.ts#L3226-L3262](../../../../packages/agent-claude/src/session.ts#L3226-L3262) - `confirm`, the answering to copy"
---

## Objective

When a policy says a call needs asking, pi waits in its `tool_call` hook while the call is shown `pending-confirmation`, and a client's `confirm` runs or blocks it.

## Files

- `UPDATE: packages/agent-pi/src/backend.ts:65-96` - `BackendOptions.onToolCall?: (event) => Promise<ToolCallEventResult | undefined>`; `openPi` passes an inline extension through `resourceLoaderOptions.extensionFactories` that registers it on `tool_call`.
- `UPDATE: packages/agent-pi/src/session.ts` - a `pending` map by id; the handler that opens the call, sets the input entry and waits; `confirm`; `status` with `InputNeeded`; release on `cancel` and `close`; the header comment corrected.
- `UPDATE: packages/agent-pi/src/mapping.ts:129-150` - a call already opened and answered keeps its status and gets no second `chat/toolCallReady`.
- `UPDATE: test/agent-pi.test.ts` - the cases below.

## Steps

1. Pass the inline extension with a name, hidden from pi's startup list, and check it loads under `projectTrust: deny` too.
2. The handler asks a `needsAsking(toolName, input)` function, which answers "no" until task 02; with "no" it returns `undefined` and nothing changes.
3. With "yes": open the call as the sibling does (`chat/toolCallStart`, then `chat/toolCallReady` with `confirmationTitle` and no `confirmed`), put a `toolConfirmation` entry in `pending`, emit `session/inputNeededSet`, set the activity to `Waiting on you: <tool>`, and await.
4. `confirm(toolCallId, approved)` finds the entry by call id, removes it with `session/inputNeededRemoved`, emits `chat/toolCallConfirmed` (with `confirmed: 'user-action'` when approved), and settles: approved returns `undefined`, declined returns `{ block: true, reason: 'The person declined this action' }`.
5. `cancel` and `close` settle everything waiting as declined.
6. `status` is `InputNeeded` while `pending` is not empty.

## Validation

- `test/agent-pi.test.ts`, with `needsAsking` forced to "yes": the call is `pending-confirmation` and the session `InputNeeded`; `confirm(true)` resolves the hook with nothing; `confirm(false)` resolves it with `block`; two calls waiting are answered independently; a cancel releases both.
- The later `tool_execution_start` for an approved call does not send a second ready.
- `pnpm test`, `pnpm typecheck`, `pnpm wire` green.

## Resume
