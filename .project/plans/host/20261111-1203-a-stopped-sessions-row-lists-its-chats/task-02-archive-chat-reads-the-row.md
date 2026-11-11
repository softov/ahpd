---
title: archive_chat reads the row
status: implemented
depends:
  - task-01-a-stopped-row-lists-its-chats.md
layer: "sdk"
refs:
  - "[code://packages/sdk/src/tools/session.ts](../../../../packages/sdk/src/tools/session.ts) - `archive_chat`, which reads `at.chats` alone"
---

## Objective

`archive_chat` archives a nested chat of a session nothing runs, from the row's chats.

## Files

- `UPDATE: packages/sdk/src/tools/session.ts` - `archive_chat` falls back to the row's `chats` and `defaultChat`.
- `UPDATE: packages/sdk/test/sessiontools.test.ts` - the archive on the second host.

## Steps

1. Read `at.chats` for the session.
2. Use the row's chats and `defaultChat` when `at.chats` is empty.
3. Keep every refusal as it is.
4. Extend the task 01 test: archive the nested chat on the second host, and read its row again.

## Validation

- `sessiontools.test.ts`: the nested chat's status says archived, and the session's status does not.
- `pnpm typecheck` passes.
- `TMPDIR=/home/softov/tmp/ahpd-test flock /home/softov/tmp/ahpd-test/vitest.lock npx vitest run packages/sdk` passes, then `packages/server`.

## Resume

- `archive_chat` reads the row's `chats` and `defaultChat` when `at.chats` is empty.
- One test covers tasks 01 and 02: a second host on the same store lists the nested chat, archives it, and the session stays unarchived.
