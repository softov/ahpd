---
title: A subscribe with no view gets every turn - implemented
date: 2026-10-28
refs:
  - git://246ef35b
  - "[code://packages/sdk/src/sessions/paging.ts](../../../../packages/sdk/src/sessions/paging.ts) - `windowOf`, and the `PAGE` comment that says what it is"
  - "[code://packages/sdk/src/host/snapshots.ts](../../../../packages/sdk/src/host/snapshots.ts) - `snapshotOf` takes a view, and every chat snapshot is cut by it"
  - "[code://packages/sdk/src/host/sessionmethods.ts](../../../../packages/sdk/src/host/sessionmethods.ts) - `subscribe` reads `params.view`, and `fetchTurns` answers nothing without a cursor"
  - "[code://packages/sdk/src/host.ts](../../../../packages/sdk/src/host.ts) - the wrapper on `snapshotOf` passes the view on"
  - "[code://packages/agent-claude/src/session.ts](../../../../packages/agent-claude/src/session.ts) - `chatState()` gives every turn"
  - "[code://docs/sdk/AHP.md](../../../../docs/sdk/AHP.md) - the `subscribe` and `fetchTurns` rows"
---

A client that subscribes to a chat and names no `view` now gets every turn the host keeps, and no `turnsNextCursor`.
A client that names `view.turns` gets the newest that many, with a cursor while older turns are left.
The host cuts the window for every chat snapshot, so a live Claude chat is no longer cut twice.
`fetchTurns` with no cursor answers nothing older, because the host keeps no record of which window a client got.

## What was built

- [`code://packages/sdk/src/sessions/paging.ts`](../../../../packages/sdk/src/sessions/paging.ts) - `windowOf(turns, view)`, the one place a chat's turns are cut for a subscribe.
- [`code://packages/sdk/src/host/snapshots.ts`](../../../../packages/sdk/src/host/snapshots.ts) - the live chat path and the three chats that are not running take their turns through `windowOf`.
- [`code://packages/sdk/src/host/sessionmethods.ts`](../../../../packages/sdk/src/host/sessionmethods.ts) - `subscribe` gives `params.view` to `snapshotOf` when it is an object, and the no-cursor branch of `fetchTurns` returns `{}` and sends nothing.
- [`code://packages/sdk/src/host.ts`](../../../../packages/sdk/src/host.ts) - the wrapper on `snapshotOf` takes the view and forwards it.
- [`code://packages/agent-claude/src/session.ts`](../../../../packages/agent-claude/src/session.ts) - `chatState()` gives `turns: ctx.turns`, as the ACP, pi, cofold and bot backends do.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) and [`code://docs/sdk/CHATS.md`](../../../../docs/sdk/CHATS.md) - the docs say what a snapshot holds with and without a view, and what `fetchTurns` needs.
- [`code://UPSTREAM.md`](../../../../UPSTREAM.md) - the Pass 7 box "A chat subscription that names no `view` gets every retained turn" is ticked.

## Verified

- `packages/sdk/test/host-catalogue.test.ts` and `packages/sdk/test/sessions.test.ts` pass, 128 tests. A chat that is not running gives 120 of 120 turns with no cursor, and a live chat gives 121 of 121. A view of 20 gives 20 turns and cursor `100` or `101`.
- `packages/sdk/test/sessiontools.test.ts` and `packages/agent-claude/test` pass, 499 tests in 46 files, so `get_session_context` keeps its own `transcriptLimit` cut.
- `pnpm -s build`, `pnpm -s typecheck`, `pnpm -s boundary` and `pnpm -s docs:build` pass.
- The full suite passes with `pnpm exec vitest run --maxWorkers=2 --testTimeout=20000`: 448 files and 7445 tests.
- `git grep -n "Newest 50" -- docs` finds nothing.
- Softov ran `host-114-turn-cut-checks.md` in a VS Code window on 2026-11-04, and it passed.

## Departures from the plan

- Task 02 gained a step and a Files line for the `host.ts` wrapper on `snapshotOf`, which had three arguments and dropped the view.
- `opened()` in `host-catalogue.test.ts` takes `null` for a subscribe that names no view, because a default parameter of `{ turns: 50 }` applies when `undefined` is passed.
- The Pass 7 box is ticked without a merge commit, because this work is not merged, and it names the window check as still owed. The plan's step said to add the merge commit after review.
- The first `pnpm test` run failed four cases in `packages/computer/test/computer-plugin.test.ts` under load. The rerun with `--maxWorkers=2 --testTimeout=20000` passed.

## Left for later

- The check by hand in a VS Code 1.143 window. Task 05 asks for that reply, and it is the last unticked line of the plan's final checklist.
- A nested chat whose inner host is older still hands on the inner cut and cursor. [The problem file](../../../problems/a-nested-chat-hands-on-an-older-inner-cut.md) records it, and this plan leaves it as it is.
