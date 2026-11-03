---
title: The default chat's archive is refused
status: todo
depends: []
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts#L246-L300](../../../../packages/sdk/src/host/chatactions.ts#L246-L300) - the chat flag block"
  - "[code://packages/sdk/src/host/chatactions.ts#L13-L70](../../../../packages/sdk/src/host/chatactions.ts#L13-L70) - `sessionFlag`"
---

## Objective

A `chat/isArchivedChanged` on a session's default chat is refused with VS Code's words, archiving or restoring, and wakes nothing.
A session's `session/isArchivedChanged` moves the session's bit alone.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts:246-300` - the refusal, ahead of the flag block, for a session running or not.
- `UPDATE: packages/sdk/src/host/chatactions.ts:13-70` - `sessionFlag` moves no chat's archived bit.
- `UPDATE: packages/sdk/test/host-snapshots.test.ts:929-997` - the case reads the refusal and a session archived alone.
- `UPDATE: packages/sdk/test/session-sleep.test.ts:365-376` - a session is archived by its own action, and a sleeping session's default chat wakes nothing.
- `UPDATE: docs/sdk/AHP.md` - the `session/isArchivedChanged` and `chat/isArchivedChanged` rows.

## Steps

1. Refuse an archive of the session's default chat before the flag block.
2. Name the default chat from the running session, its record, or its catalogue row.
3. Remove the default chat's archived bit from `sessionFlag`.
4. Change the snapshot case to read the refusal and the bits.
5. Archive the sleep case's session by its own action.
6. Add a sleep case for a sleeping session's default chat.
7. Describe both actions in their `docs/sdk/AHP.md` rows.

## Validation

- `packages/sdk/test/host-snapshots.test.ts`: the changed case fails on `cde4dd6c` and passes after.
- `packages/sdk/test/session-sleep.test.ts`: the new case fails on `cde4dd6c` and passes after.
- The snapshot, sleep, catalogue, sessions, merged, worktree and chats test files pass.
- `pnpm run typecheck` is clean.

## Resume

Not started.
