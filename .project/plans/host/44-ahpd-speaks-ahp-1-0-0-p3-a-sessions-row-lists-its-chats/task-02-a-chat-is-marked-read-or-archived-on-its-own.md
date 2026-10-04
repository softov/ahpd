---
title: A chat is marked read or archived on its own
status: todo
depends: [task-01-a-sessions-row-lists-its-chats.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/host/actions.ts#L511-L528](../../../../packages/sdk/src/host/actions.ts#L511-L528) - the session's flags: compare, store, dispatch, `summaryMoved`"
  - "[code://packages/sdk/src/host/catalogue.ts#L55-L65](../../../../packages/sdk/src/host/catalogue.ts#L55-L65) - `chatSummary`'s `status`"
  - "[code://packages/sdk/src/host/catalogue.ts#L68-L76](../../../../packages/sdk/src/host/catalogue.ts#L68-L76) - `subagentSummary`'s `status`"
  - "[code://packages/sdk/src/host/snapshots.ts#L277](../../../../packages/sdk/src/host/snapshots.ts#L277) - a chat's state, built from the backend's `chatState()`"
  - "[code://packages/sdk/src/host/chatactions.ts#L1126-L1127](../../../../packages/sdk/src/host/chatactions.ts#L1126-L1127) - the refusal these actions reach today"
  - "[code://packages/sdk/src/types/sessions.ts#L136-L145](../../../../packages/sdk/src/types/sessions.ts#L136-L145) - `chatTitle` and `setChatTitle`, the shape to mirror"
  - "[code://packages/sdk/src/sessions.ts#L39](../../../../packages/sdk/src/sessions.ts#L39) - `chatTitles`, the memory store's per-chat map"
  - "[code://packages/sdk/src/sessions.ts#L194-L212](../../../../packages/sdk/src/sessions.ts#L194-L212) - `rowOf`, what the file store writes for a session"
  - "[code://packages/sdk/test/host.test.ts#L6394-L6403](../../../../packages/sdk/test/host.test.ts#L6394-L6403) - a row nobody is running keeps its read bit"
---

## Objective

A client's `chat/isReadChanged` or `chat/isArchivedChanged` sets or clears that chat's bit, which then shows in its `ChatState.status`, in `session/chatUpdated` and in the row's `chats` entry, survives a restart, and leaves the session's own flags and every other chat as they were.
`chat/isArchivedChanged` on the session's default chat is the session's archive instead: the session's `IsArchived` is set or cleared and the chat's own bit is not touched.

## Files

- `UPDATE: packages/sdk/src/types/sessions.ts` - `chatFlags(id, chatUri): number` and `setChatFlags(id, chatUri, value)`, beside `chatTitle`.
- `UPDATE: packages/sdk/src/sessions.ts` - the memory store's map, the file store's row field, both forgotten with the session.
- `UPDATE: packages/sdk/src/host/chatactions.ts` - a handler beside `actions.ts:511` for the two chat actions on a chat channel: compare, store, dispatch the action on the chat channel, `session/chatUpdated` with the new `status`, `summaryMoved`; `chat/isArchivedChanged` whose chat is the session's `defaultChat` goes through the session's path instead (`kept.flags` / `kept.setFlags` on the session's `IsArchived`, `session/isArchivedChanged` dispatched on the session channel, `summaryMoved`, and nothing on the chat channel, whose reducer would set the chat's bit), shared with the `session/isArchivedChanged` branch rather than copied; `chatSummary`, `subagentSummary`, the restored workers' rows and a chat's state OR the chat's flags into `status`.
- `UPDATE: packages/sdk/test/host.test.ts`, `packages/sdk/test/sessions.test.ts` - the cases below.
- `UPDATE: docs/AHP.md` - two rows in the chat actions table.

## Steps

1. Lift the session-flag branch at `actions.ts:511` into a function the chat handler can call for the default chat's archive.
2. Add the store methods and their persistence, with a test of the file store reading back what it wrote.
3. Handle the two actions; an unchanged bit sends nothing, as the session's handler does.
4. Fold the flags into every place a chat's status is built.

## Validation

- `packages/sdk/test/host.test.ts`: marking a peer chat read sends `chat/isReadChanged` on its channel, `session/chatUpdated` whose `status` has `IsRead`, and a `root/sessionSummaryChanged` whose entry for that chat has it, while the session's `status` and the other chat's do not; sending it twice sends nothing the second time; a worker chat can be marked read; archiving a peer chat and restoring it clears the bit; `chat/isArchivedChanged` with `isArchived: true` on the default chat sends `session/isArchivedChanged` on the session channel and a `root/sessionSummaryChanged` whose session `status` has `IsArchived`, while no `chat/isArchivedChanged` goes out on the chat channel and the default chat's `status` does not have it, and the same with `false` restores the session; a turn starting in a read chat keeps `IsRead` beside `InProgress`.
- `packages/sdk/test/sessions.test.ts`: the file store writes a chat's flags and a new store over the same directory reads them; disposing the session forgets them.
- `packages/sdk/test/conformance.test.ts` and `pnpm test` pass.

## Resume
