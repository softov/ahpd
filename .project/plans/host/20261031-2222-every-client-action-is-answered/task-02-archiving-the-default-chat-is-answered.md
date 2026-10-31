---
title: Archiving the default chat is answered on the chat
status: planned
depends: [01]
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - the chat's two bits; the default chat archives its session"
  - "[code://packages/sdk/test/host-snapshots.test.ts](../../../../packages/sdk/test/host-snapshots.test.ts) - 'takes archiving the default chat as archiving the session'"
---

## Objective

A client's `chat/isArchivedChanged` on a session's default chat archives the session as before, and is answered to its sender on the chat channel with its own action and origin.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts` - the default-chat branch answers its sender with `echoTo` whether or not the session's bit moved.
- `UPDATE: packages/sdk/test/host-snapshots.test.ts` - the sender alone hears its action back on the chat, with its origin; a second client hears only the session's action.
- `UPDATE: docs/sdk/AHP.md` - the `chat/isArchivedChanged` row.

## Steps

1. Write the case and see it fail on `08b1d57a`: no envelope on the chat carries the sender's origin.
2. Answer the sender.

## Validation

- The case and protocol case 272 fail on `08b1d57a` and pass after.
- The chat's own entry still carries no archive bit, and the session's does.
