---
title: A call can wait on a person
status: implemented
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

Built.
`BackendOptions.onToolCall` is passed to `openPi`, which loads a hidden inline extension whose `tool_call` handler calls it; the extension is this host's, so it is passed whatever the project trust says.
`session.ts` has `pending` by pi's call id, `releasePending`, a `decide` that runs, asks or refuses a call (a policy handed in replaces it), and `askBefore`, which opens the call `pending-confirmation`, emits `session/inputNeededSet` and `session/statusChanged`, sets `Waiting on you: <tool>` and awaits.
`confirm` finds the call by id, removes the entry, emits `chat/toolCallConfirmed`, and settles `undefined` on approval or `{ block: true, reason: 'The person declined this action' }` on a decline.
`status` is `InputNeeded` while anything is pending, and `cancel` and `close` release what waits as declined.
`mapping.ts` gives a call opened by the ask no second `chat/toolCallReady` when pi's own execution starts.

- `test/agent-pi.test.ts` drives the hook directly with a policy forced to yes: approve, decline, two calls answered independently, release on cancel, no second ready, and the extension present under `projectTrust: deny`.
- `pnpm test` 102 files, 1376 tests; `pnpm typecheck` and `pnpm boundary` green.
