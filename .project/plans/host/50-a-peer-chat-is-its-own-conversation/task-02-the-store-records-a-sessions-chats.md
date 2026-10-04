---
title: The store records a session's chats
status: todo
depends: []
layer: "sdk"
refs:
  - "[code://packages/sdk/src/types/sessions.ts#L143-L153](../../../../packages/sdk/src/types/sessions.ts#L143-L153) - `chatTitle`, `setChatTitle`, `forget`"
  - "[code://packages/sdk/src/sessions.ts#L39-L42](../../../../packages/sdk/src/sessions.ts#L39-L42) - the memory store's per-chat map and its `forget`"
  - "[code://packages/sdk/src/sessions.ts#L194-L212](../../../../packages/sdk/src/sessions.ts#L194-L212) - `rowOf`, what the file store writes for a session"
  - "[code://packages/sdk/test/sessions.test.ts#L260-L280](../../../../packages/sdk/test/sessions.test.ts#L260-L280) - forgetting and remembering across a restart"
---

## Objective

`SessionStore.chats(id)` answers the chats a session has, each `{ uri, backendId, title?, origin?, default? }`, and `setChats(id, list)` replaces them; both stores keep the list, the file store across a restart, and `forget` drops it.

## Files

- `UPDATE: packages/sdk/src/types/sessions.ts` - `StoredChat` and the two methods beside `chatTitle`.
- `UPDATE: packages/sdk/src/sessions.ts` - the memory store's map; the file store's row field, written with the rest of the row.
- `UPDATE: packages/sdk/test/sessions.test.ts` - the cases below.

## Steps

1. Add the type and the methods; an unknown session answers `[]`.
2. The file store reads a row without the field as `[]`, so rows written before this keep loading.

## Validation

- `packages/sdk/test/sessions.test.ts`: the memory store answers what it was given; the file store writes two chats, one `default`, and a new store over the same temp directory reads them back in order; `forget` drops them; a row written without the field reads as `[]`.
- `pnpm test` passes.

## Resume
