---
title: Leaving a machine clears the nested record
status: done
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

- **Implemented** 2026-10-07 on `build/agents/4f2c8f8e`. Nothing is left.
- `lifecycle.ts`: the leaving block in `restart` clears the record beside the two map deletes. A comment there says what a record left behind reads as.
- The catch below that block repeats the same three calls for a session that is over. It was left alone: the config may still name that machine, and a resume finds the inner session by the record.
- `nested-proxy.test.ts`: the named case runs one backend across two daemons, which is what a machine is. Its daemon declares the key the computer plugin contributes, or the move is a refusal rather than a move.
- The case was written first and failed on the history, `expected [] to deeply equal ['hello']`. It passes with the clear.
