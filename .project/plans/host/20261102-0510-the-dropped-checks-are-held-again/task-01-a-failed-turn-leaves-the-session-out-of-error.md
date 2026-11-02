---
title: A failed turn leaves the session out of error
status: done
depends: []
layer: "sdk test"
refs:
  - "[code://packages/sdk/test/host-turn.test.ts#L429-L478](../../../../packages/sdk/test/host-turn.test.ts#L429-L478) - the failed turn case"
---

## Objective

The failed turn case holds the session's side as well as the chat's.
The session's row for the chat and its list row follow the chat, and the session carries no error of its own.

## Files

- `UPDATE: packages/sdk/test/host-turn.test.ts:429-478` - `sessionSide` reads the session's error, its row for the chat and its list row at each step.

## Steps

1. Read the session channel's snapshot and `listSessions` after the failure, after the next turn starts, and after it ends.
2. Hold the row's and the list row's activity bits to Error, InProgress and Idle, and the error to absent.
3. Make the session's row stop following a chat in error, and run the new and main's case against it.

## Validation

- The case passes on main's host.
- With the row stuck in error, the new case fails at the next turn's start, and main's case passes.

## Resume

Done 2026-11-02 in `1e1e2492`; [implemented.md](implemented.md) says what was verified.
