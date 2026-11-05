---
title: The docs say every turn without a view
status: done
depends:
  - task-02-a-snapshot-follows-the-subscribes-view.md
  - task-03-claudes-chat-state-holds-every-turn.md
layer: docs
refs:
  - "[code://docs/sdk/AHP.md#L81](../../../../docs/sdk/AHP.md#L81) - the `subscribe` row"
  - "[code://docs/sdk/AHP.md#L94](../../../../docs/sdk/AHP.md#L94) - the `fetchTurns` row, which says \"Newest 50 in the snapshot\""
  - "[code://docs/sdk/CHATS.md#L89](../../../../docs/sdk/CHATS.md#L89) - the `fetchTurns` row of the chat page"
  - "[code://UPSTREAM.md](../../../../UPSTREAM.md) - the Pass 7 box \"A chat subscription that names no `view` gets every retained turn\""
---

## Objective

The docs say that a subscribe with no view gets every turn, and that a view gets a window and a cursor.
The Pass 7 box in `UPSTREAM.md` is ticked.

## Files

- `UPDATE: docs/sdk/AHP.md:81` - the `subscribe` row says what a chat snapshot holds with and without `view`.
- `UPDATE: docs/sdk/AHP.md:94` - the `fetchTurns` row names the window of a view, and what no cursor answers.
- `UPDATE: docs/sdk/CHATS.md:89` - the `fetchTurns` row says that older turns exist only after a subscribe with a view.
- `UPDATE: UPSTREAM.md` - the Pass 7 box under "Large chats" is ticked, with the merge commit.

## Steps

1. Add one sentence to the `subscribe` row: with no `view`, a chat snapshot has every turn and no cursor.
2. Add one sentence to the same row that names the window a `view.turns` gets.
3. Replace "Newest 50 in the snapshot and a cursor for the rest" in the `fetchTurns` row with the new behaviour.
4. Say in the `fetchTurns` row what a request with no cursor answers.
5. Change the `fetchTurns` row in `CHATS.md` to match.
6. Tick the Pass 7 box in `UPSTREAM.md`, and add the merge commit after review.
7. Run `pnpm -s docs:build`, and set this task and its plan row to `implemented`.

## Validation

- `pnpm -s docs:build` passes.
- `git grep -n "Newest 50" -- docs` finds nothing.

## Resume

Done 2026-10-28. The `subscribe` row of `AHP.md` now says that a chat snapshot with no `view` holds every turn and no cursor, and what a `view.turns` gets. The `fetchTurns` rows of `AHP.md` and `CHATS.md` say that a snapshot's cursor comes only from a view. They also say that a request with no cursor answers nothing older. The Pass 7 box in `UPSTREAM.md` is ticked with "Built in `host/114` tasks 02 and 03". It names the window check of task 05 as still owed, because that reply is not in yet. `pnpm -s docs:build` passes, and `git grep -n "Newest 50" -- docs` finds nothing.
