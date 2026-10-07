---
title: Leaving a machine clears the nested record
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/lifecycle.ts#L545-L550](../../../../packages/sdk/src/host/lifecycle.ts#L545-L550) - a session leaves its machine"
  - "[code://packages/sdk/src/sessions.ts#L71](../../../../packages/sdk/src/sessions.ts#L71) - `setNested` removes on `undefined`"
---

## Objective

A session that leaves its machine loses its nested record, so its host history shows and the prune can remove it.

## Files

- `UPDATE: packages/sdk/src/host/lifecycle.ts:545-550` - clear the record.
- `UPDATE: packages/sdk/test/` - the case below, beside the restart tests.

## Steps

1. Where the restart drops `enteredIn` and `sessionMachines`, call `kept.setNested?.(idOf(uri), undefined)`.

## Validation

- `it('a nested session moved to this host before its first turn shows its history')`
- Run the full gates from the plan. All pass.

## Resume

