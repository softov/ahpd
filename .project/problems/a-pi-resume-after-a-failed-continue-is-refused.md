---
title: A pi turn whose continue threw is marked resumable, and its resume is refused
status: open
date: 2026-11-03
severity: minor
blocks: []
refs:
  - "[code://packages/agent-pi/src/backend.ts#L454-L462](../../packages/agent-pi/src/backend.ts#L454-L462) - `resume` writes the context edit before `continue()`"
  - "[code://packages/agent-pi/src/session.ts#L1501-L1503](../../packages/agent-pi/src/session.ts#L1501-L1503) - a throw finishes the turn as an error that is resumable"
  - git://f833fbd0 - pi/20261031-0736 added resume
  - git://77ba53f8 - main when the problem was read
---

## Symptom

Read from the code in the review of 2026-11-03, and not reproduced.
A failed pi turn is resumed, and `continue()` throws.
The turn shows a retry control.
The user selects it, and the resume is refused.

## Cause

`resume` appends a context edit, then calls `continue()`.
When `continue()` throws, the session marks the turn resumable.
The leaf entry is now the context edit, not an assistant message with `stopReason: error`, so the next `resume` returns false.

## Impact

The user sees a retry control that does nothing.

## Workaround

Send the prompt again as a new message.

## Fix

- Mark the turn resumable only when the leaf is still an error message.
- Or let `resume` look past a context edit to the error message under it.
