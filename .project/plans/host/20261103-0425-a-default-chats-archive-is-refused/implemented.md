---
title: A default chat's archive is refused - implemented
date: 2026-11-03
refs:
  - git://97f6dade - the change
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts)"
---

A `chat/isArchivedChanged` on a session's default chat is refused, archiving or restoring.
The refusal is VS Code's: "Only a known independently manageable non-default chat can be archived."
The refusal comes before anything wakes the session, so a sleeping session stays asleep.
A session's `session/isArchivedChanged` moves the session's bit alone, and says nothing on any chat.

## What was built

- [`code://packages/sdk/src/host/chatactions.ts`](../../../../packages/sdk/src/host/chatactions.ts) - the refusal ahead of the chat flag block, and `sessionFlag` with no chat's archived bit.
- [`code://docs/sdk/AHP.md`](../../../../docs/sdk/AHP.md) - the `session/isArchivedChanged` and `chat/isArchivedChanged` rows.

## Verified

- On `cde4dd6c`'s source the snapshot case fails: the default chat's archive is accepted.
- On `cde4dd6c`'s source the new sleep case fails: the archive wakes the session.
- With the change the snapshot file passes 48 of 48, and the sleep file 15 of 15.
- The catalogue file passes 73 of 73, sessions 61 of 61, merged 22 of 22, worktrees 57 of 57, and chats 62 of 62.
- `pnpm run typecheck` and `pnpm run boundary` report no errors.

## Departures from the plan

- None.
