---
title: A late result changes nothing
status: done
depends: []
layer: "agent-claude"
refs:
  - "[code://packages/agent-claude/src/session/stream.ts#L480-L628](../../../../packages/agent-claude/src/session/stream.ts#L480-L628) - `results`, which this task changes"
  - "[code://packages/agent-claude/test/agent-claude-cancelled-turn.test.ts](../../../../packages/agent-claude/test/agent-claude-cancelled-turn.test.ts) - the cases for a stopped turn"
---

## Objective

A result for a call whose turn has ended does not change the record, and the session sends no action for it.
It still releases what the call holds, and the after side of an edit names the turn of the call.

## Files

- `UPDATE: packages/agent-claude/src/session/stream.ts:71-72` - `editing` keeps the turn of the before side beside the path.
- `UPDATE: packages/agent-claude/src/session/stream.ts:428-432` - the before side records its turn in `editing`.
- `UPDATE: packages/agent-claude/src/session/stream.ts:480-628` - `results` finds whether the turn of the call is active, and shares `edited` and `settleSpawn` between the two paths.
- `UPDATE: packages/agent-claude/test/agent-claude-cancelled-turn.test.ts` - the cases for a stopped call and its late result.
- `UPDATE: docs/sdk/CHATS.md` - "Turns" says that an ended turn takes no result.
- `UPDATE: CHANGELOG.md` - an entry under `0.14.1 - unreleased`.

## Steps

1. Keep the turn of the before side beside the path in `editing`.
2. Move the after side and the end of a worker record into `edited` and `settleSpawn`.
3. In `results`, find whether the active turn of the scope holds the part of the call.
4. For a part in an ended turn, release the sign-in wait, the row line and the answered input.
5. For a part in an ended turn, call `edited` and `settleSpawn`, and send nothing.
6. Add the cases, with the result frame as a Claude Code transcript holds it.
7. Add the sentence to `CHATS.md` and the changelog entry.

## Validation

- Test in `packages/agent-claude/test/agent-claude-cancelled-turn.test.ts` that a stopped call reads as the replayed actions say, without a late result and with one.
- Test that every chat action names a turn, and that the session says no activity after the stop.
- Test that the after side of a stopped edit names the turn of the edit.
- Run the cases on the session before this change, and see them fail.
- `pnpm boundary`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass.

## Resume

Done 2026-10-27.
`results` finds the part of the call in the active turn of its scope, or releases the call and sends nothing.
`edited` records the after side against the turn of the before side, and `settleSpawn` ends a worker record.
The two cases with a late result fail on the session before this change, and the case without one passes on both.
Before the change, the after side of a stopped edit named no turn, and the session said `Thinking` after the stop.
`pnpm boundary`, `pnpm typecheck` and `pnpm build` pass, and the agent-claude, conformance and wire suites pass, 411 of 411.
