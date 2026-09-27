---
title: Confirm carries the chosen option
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/session.ts#L382](../../../../packages/sdk/src/types/session.ts#L382) - `confirm`"
  - "[code://packages/sdk/src/host.ts#L8622](../../../../packages/sdk/src/host.ts#L8622) - the call site"
---

## Objective

`Session.confirm(toolCallId, approved, optionId?)`, and the host passes the action's `selectedOptionId`.

## Files

- `UPDATE: packages/sdk/src/types/session.ts:382`.
- `UPDATE: packages/sdk/src/host.ts:8622`.
- `UPDATE: packages/sdk/test/` the confirmation test.

## Steps

1. Optional, so other backends compile unchanged.

## Validation

- A confirmed action with `selectedOptionId` reaches a fake session's `confirm`.

## Resume
