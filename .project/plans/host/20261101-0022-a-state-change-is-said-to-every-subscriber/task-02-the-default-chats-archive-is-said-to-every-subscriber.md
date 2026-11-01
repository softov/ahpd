---
title: The default chat's archive is said to every subscriber
status: planned
depends: [01]
layer: host
refs:
  - "[code://packages/sdk/src/host/chatactions.ts](../../../../packages/sdk/src/host/chatactions.ts) - `sessionFlag`, `chatFlag`, the default chat's archive"
  - "[code://packages/sdk/test/host-snapshots.test.ts](../../../../packages/sdk/test/host-snapshots.test.ts) - 'takes archiving the default chat as archiving the session'"
---

## Objective

A client's `chat/isArchivedChanged` on a session's default chat is applied to the chat for every subscriber, its sender's copy carrying the sender's origin, and archives the session; the default chat's archived bit follows the session's whichever action moves it, a client's `session/isArchivedChanged` and this host's own archive included.

## Files

- `UPDATE: packages/sdk/src/host/chatactions.ts` - the default chat's archive goes through `chatFlag` with the client's action, then `sessionFlag`; `sessionFlag` brings the default chat's archived bit along with the session's, as it brings each chat's read bit.
- `UPDATE: packages/sdk/test/host-snapshots.test.ts` - both clients of the chat hear the archive, the sender's copy with its origin; the session is archived; the chat's entry and its own state carry the bit; a client's session archive and unarchive move the default chat's bit for every subscriber.
- `UPDATE: docs/sdk/AHP.md` - the `chat/isArchivedChanged` and `session/isArchivedChanged` rows.

## Steps

1. Write the case and see it fail on `5da31824`: the second client hears no archive on the chat, and the chat's entry carries no archived bit.
2. Route the default chat's archive through `chatFlag` and bring its bit along in `sessionFlag`.

## Validation

- The case and protocol case 272 fail on `5da31824` and pass after.
- Every subscriber of the chat and of the session holds the same bits after each archive and unarchive.
