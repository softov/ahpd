---
title: confirm carries the option the person picked
status: done
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/session.ts#L381-L382](../../../../packages/sdk/src/types/session.ts#L381-L382) - `confirm(toolCallId, approved)`"
  - "[code://packages/sdk/src/host.ts#L8955-L8957](../../../../packages/sdk/src/host.ts#L8955-L8957) - where `selectedOptionId` is dropped"
  - "[code://packages/sdk/src/nested.ts#L476-L477](../../../../packages/sdk/src/nested.ts#L476-L477) - the nested proxy's re-dispatch"
---

## Objective

A `chat/toolCallConfirmed` that carries `selectedOptionId` reaches the backend's `confirm` as its third argument, on a lead chat, on a worker chat, and through a nested host.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:381-382` - `confirm(toolCallId: string, approved: boolean, optionId?: string): void`, the comment saying what `optionId` is.
- `UPDATE: packages/sdk/src/host.ts:8955-8957` - pass `action.selectedOptionId` when it is a string.
- `UPDATE: packages/sdk/src/nested.ts:476-477` - re-dispatch `selectedOptionId` into the nested host.
- `UPDATE: packages/sdk/test/host.test.ts`, `packages/sdk/test/nested-proxy.test.ts` - the cases below.

## Steps

1. Widen `confirm` with an optional `optionId`; no backend changes in this task.
2. The host reads `selectedOptionId` off the action and passes it, or `undefined`.
3. The nested proxy carries it into the action it dispatches inside.

## Validation

- `host.test.ts`: a fake backend's `confirm` receives `('c1', true, 'always')` for an action with `selectedOptionId: 'always'`, and `('c1', true, undefined)` without one; it fails first.
- `nested-proxy.test.ts`: the nested host's backend receives the option; it fails first.
- `pnpm typecheck`, `pnpm boundary`, `pnpm test` green.

## Resume

Built.
`Session.confirm` is `confirm(toolCallId, approved, optionId?)`, its comment saying `optionId` is the picked `ConfirmationOption`'s `id`.
The host passes `action.selectedOptionId` when it is a string, and `undefined` otherwise; a worker chat's answer reaches the lead's backend through the same switch.
The nested proxy's `confirm` re-dispatches `selectedOptionId` into the nested host when it has one.
No backend changed.

Tests:

- `packages/sdk/test/subagent-chat.test.ts`, `takes the option picked on the lead chat to its backend, and none when none was picked`: a fake backend's `confirm` receives `('c1', true, 'always')`, then `('c1', true, undefined)`.
- `packages/sdk/test/subagent-chat.test.ts`, `takes the option picked on a worker chat to the session's backend`: the same through a worker chat.
- `packages/sdk/test/nested-proxy.test.ts`, `a permission ask answered outside is seen inside`: extended so `confirm('req-1', true, 'always')` on the proxy reaches the inner backend with `always`.

Failed first: all three, the option arriving as `undefined` (the host dropped it, and the proxy dispatched `approved` only).

Departure: the lead-chat case is in `subagent-chat.test.ts` rather than `host.test.ts`, because that file already has a fake backend recording `confirm`, and `host.test.ts` runs the Claude backend.

Gates: `pnpm typecheck` clean; `pnpm boundary` clean; `pnpm test` 107 files, 1534 tests passed.
